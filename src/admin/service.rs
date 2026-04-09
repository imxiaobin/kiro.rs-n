//! Admin API 业务逻辑服务

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::http_client::build_client;
use crate::kiro::model::credentials::KiroCredentials;
use crate::kiro::token_manager::{EffectiveProxySource, MultiTokenManager};
use crate::token;

use super::error::AdminServiceError;
use super::types::{
    AddCredentialRequest, AddCredentialResponse, AddProxyPresetRequest, BalanceResponse,
    CredentialProxyConfigResponse, CredentialStatusItem, CredentialsStatusResponse,
    GlobalProxyConfigResponse, LoadBalancingModeResponse, ProxyPresetsResponse, ProxyTestResponse,
    SetLoadBalancingModeRequest, SuccessResponse, UpdateProxyPresetRequest,
};

/// 余额缓存过期时间（秒），5 分钟
const BALANCE_CACHE_TTL_SECS: i64 = 300;

/// 缓存的余额条目（含时间戳）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedBalance {
    /// 缓存时间（Unix 秒）
    cached_at: f64,
    /// 缓存的余额数据
    data: BalanceResponse,
}

/// Admin 服务
///
/// 封装所有 Admin API 的业务逻辑
pub struct AdminService {
    token_manager: Arc<MultiTokenManager>,
    balance_cache: Mutex<HashMap<u64, CachedBalance>>,
    cache_path: Option<PathBuf>,
}

impl AdminService {
    pub fn new(token_manager: Arc<MultiTokenManager>) -> Self {
        let cache_path = token_manager
            .cache_dir()
            .map(|d| d.join("kiro_balance_cache.json"));

        let balance_cache = Self::load_balance_cache_from(&cache_path);

        Self {
            token_manager,
            balance_cache: Mutex::new(balance_cache),
            cache_path,
        }
    }

    /// 获取所有凭据状态
    pub fn get_all_credentials(&self) -> CredentialsStatusResponse {
        let snapshot = self.token_manager.snapshot();
        let proxy_preset_name_lookup =
            build_proxy_preset_name_lookup(&self.token_manager.get_proxy_presets());

        let mut credentials: Vec<CredentialStatusItem> = snapshot
            .entries
            .into_iter()
            .map(|entry| {
                let credential_proxy = self
                    .token_manager
                    .get_credential_proxy_settings(entry.id)
                    .ok();
                let proxy_preset_name = credential_proxy.as_ref().and_then(
                    |(proxy_url, proxy_username, proxy_password)| {
                        resolve_proxy_preset_name(
                            &proxy_preset_name_lookup,
                            proxy_url.as_deref(),
                            proxy_username.as_deref(),
                            proxy_password.as_deref(),
                        )
                    },
                );

                CredentialStatusItem {
                    id: entry.id,
                    priority: entry.priority,
                    disabled: entry.disabled,
                    failure_count: entry.failure_count,
                    is_current: entry.id == snapshot.current_id,
                    expires_at: entry.expires_at,
                    auth_method: entry.auth_method,
                    has_profile_arn: entry.has_profile_arn,
                    refresh_token_hash: entry.refresh_token_hash,
                    email: entry.email,
                    success_count: entry.success_count,
                    last_used_at: entry.last_used_at.clone(),
                    has_proxy: entry.has_proxy,
                    proxy_url: entry.proxy_url,
                    proxy_preset_name,
                    active_requests: entry.active_requests,
                }
            })
            .collect();

        // 按优先级排序（数字越小优先级越高）
        credentials.sort_by_key(|c| c.priority);

        CredentialsStatusResponse {
            total: snapshot.total,
            available: snapshot.available,
            current_id: snapshot.current_id,
            active_rotation_group_ids: self.token_manager.current_proxy_pair_rotation_pool_ids(),
            proxy_pair_rotation_remaining_seconds: self
                .token_manager
                .proxy_pair_rotation_remaining_seconds(),
            credentials,
        }
    }

    /// 设置凭据禁用状态
    pub fn set_disabled(&self, id: u64, disabled: bool) -> Result<(), AdminServiceError> {
        // 先获取当前凭据 ID，用于判断是否需要切换
        let snapshot = self.token_manager.snapshot();
        let current_id = snapshot.current_id;

        self.token_manager
            .set_disabled(id, disabled)
            .map_err(|e| self.classify_error(e, id))?;

        // 只有禁用的是当前凭据时才尝试切换到下一个
        if disabled && id == current_id {
            let _ = self.token_manager.switch_to_next();
        }
        Ok(())
    }

    /// 设置凭据优先级
    pub fn set_priority(&self, id: u64, priority: u32) -> Result<(), AdminServiceError> {
        self.token_manager
            .set_priority(id, priority)
            .map_err(|e| self.classify_error(e, id))
    }

    /// 重置失败计数并重新启用
    pub fn reset_and_enable(&self, id: u64) -> Result<(), AdminServiceError> {
        self.token_manager
            .reset_and_enable(id)
            .map_err(|e| self.classify_error(e, id))
    }

    /// 获取指定凭据的代理配置
    pub fn get_credential_proxy_config(
        &self,
        id: u64,
    ) -> Result<CredentialProxyConfigResponse, AdminServiceError> {
        let (proxy_url, proxy_username, proxy_password) = self
            .token_manager
            .get_credential_proxy_settings(id)
            .map_err(|e| self.classify_credential_proxy_error(e, id))?;

        Ok(CredentialProxyConfigResponse {
            proxy_url,
            proxy_username,
            proxy_password,
        })
    }

    /// 设置指定凭据的代理配置
    pub fn set_credential_proxy_config(
        &self,
        id: u64,
        proxy_url: Option<String>,
        proxy_username: Option<String>,
        proxy_password: Option<String>,
    ) -> Result<CredentialProxyConfigResponse, AdminServiceError> {
        self.token_manager
            .set_credential_proxy(id, proxy_url, proxy_username, proxy_password)
            .map_err(|e| self.classify_credential_proxy_error(e, id))?;

        self.get_credential_proxy_config(id)
    }

    /// 获取全局代理配置
    pub fn get_global_proxy_config(&self) -> GlobalProxyConfigResponse {
        let (proxy_url, proxy_username, proxy_password) =
            self.token_manager.get_global_proxy_settings();

        GlobalProxyConfigResponse {
            proxy_url,
            proxy_username,
            proxy_password,
        }
    }

    /// 设置全局代理配置
    pub fn set_global_proxy_config(
        &self,
        proxy_url: Option<String>,
        proxy_username: Option<String>,
        proxy_password: Option<String>,
    ) -> Result<GlobalProxyConfigResponse, AdminServiceError> {
        self.token_manager
            .set_global_proxy(proxy_url, proxy_username, proxy_password)
            .map_err(|e| self.classify_global_proxy_error(e))?;

        token::update_proxy(self.token_manager.global_proxy());

        Ok(self.get_global_proxy_config())
    }

    /// 获取凭据余额（带缓存）
    pub async fn get_balance(&self, id: u64) -> Result<BalanceResponse, AdminServiceError> {
        // 先查缓存
        {
            let cache = self.balance_cache.lock();
            if let Some(cached) = cache.get(&id) {
                let now = Utc::now().timestamp() as f64;
                if (now - cached.cached_at) < BALANCE_CACHE_TTL_SECS as f64 {
                    tracing::debug!("凭据 #{} 余额命中缓存", id);
                    return Ok(cached.data.clone());
                }
            }
        }

        // 缓存未命中或已过期，从上游获取
        let balance = self.fetch_balance(id).await?;

        // 更新缓存
        {
            let mut cache = self.balance_cache.lock();
            cache.insert(
                id,
                CachedBalance {
                    cached_at: Utc::now().timestamp() as f64,
                    data: balance.clone(),
                },
            );
        }
        self.save_balance_cache();

        Ok(balance)
    }

    /// 从上游获取余额（无缓存）
    async fn fetch_balance(&self, id: u64) -> Result<BalanceResponse, AdminServiceError> {
        let usage = self
            .token_manager
            .get_usage_limits_for(id)
            .await
            .map_err(|e| self.classify_balance_error(e, id))?;

        let current_usage = usage.current_usage();
        let usage_limit = usage.usage_limit();
        let remaining = (usage_limit - current_usage).max(0.0);
        let usage_percentage = if usage_limit > 0.0 {
            (current_usage / usage_limit * 100.0).min(100.0)
        } else {
            0.0
        };

        Ok(BalanceResponse {
            id,
            subscription_title: usage.subscription_title().map(|s| s.to_string()),
            current_usage,
            usage_limit,
            remaining,
            usage_percentage,
            next_reset_at: usage.next_date_reset,
        })
    }

    /// 检测指定凭据的生效代理是否连通
    pub async fn test_proxy(&self, id: u64) -> Result<ProxyTestResponse, AdminServiceError> {
        let proxy_info = self
            .token_manager
            .get_effective_proxy_info_for(id)
            .map_err(|e| self.classify_proxy_test_error(e, id))?;

        let client = build_client(
            proxy_info.proxy.as_ref(),
            10,
            self.token_manager.tls_backend(),
        )
        .map_err(|e| self.classify_proxy_test_error(e, id))?;

        let started_at = Instant::now();
        let exit_ip = fetch_exit_ip(&client)
            .await
            .map_err(|e| self.classify_proxy_test_error(e, id))?;

        let latency_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;
        let using_proxy = proxy_info.proxy.is_some();
        let proxy_url = proxy_info
            .proxy
            .as_ref()
            .map(|proxy| redact_proxy_url(&proxy.url));
        let message = match proxy_info.source {
            EffectiveProxySource::Credential => {
                format!("已通过凭据级代理连通，出口 IP: {}", exit_ip)
            }
            EffectiveProxySource::Global => {
                format!("已通过全局代理连通，出口 IP: {}", exit_ip)
            }
            EffectiveProxySource::Direct => {
                format!("当前为直连，出口 IP: {}", exit_ip)
            }
        };

        Ok(ProxyTestResponse {
            credential_id: id,
            using_proxy,
            proxy_source: proxy_info.source.as_str().to_string(),
            proxy_url,
            exit_ip,
            latency_ms,
            message,
        })
    }

    /// 添加新凭据
    pub async fn add_credential(
        &self,
        req: AddCredentialRequest,
    ) -> Result<AddCredentialResponse, AdminServiceError> {
        // 构建凭据对象
        let email = req.email.clone();
        let new_cred = KiroCredentials {
            id: None,
            access_token: None,
            refresh_token: Some(req.refresh_token),
            profile_arn: None,
            expires_at: None,
            auth_method: Some(req.auth_method),
            client_id: req.client_id,
            client_secret: req.client_secret,
            priority: req.priority,
            region: req.region,
            auth_region: req.auth_region,
            api_region: req.api_region,
            machine_id: req.machine_id,
            email: req.email,
            subscription_title: None, // 将在首次获取使用额度时自动更新
            proxy_url: req.proxy_url,
            proxy_username: req.proxy_username,
            proxy_password: req.proxy_password,
            disabled: false, // 新添加的凭据默认启用
        };

        // 调用 token_manager 添加凭据
        let credential_id = self
            .token_manager
            .add_credential(new_cred)
            .await
            .map_err(|e| self.classify_add_error(e))?;

        // 主动获取订阅等级，避免首次请求时 Free 账号绕过 Opus 模型过滤
        if let Err(e) = self.token_manager.get_usage_limits_for(credential_id).await {
            tracing::warn!("添加凭据后获取订阅等级失败（不影响凭据添加）: {}", e);
        }

        Ok(AddCredentialResponse {
            success: true,
            message: format!("凭据添加成功，ID: {}", credential_id),
            credential_id,
            email,
        })
    }

    /// 删除凭据
    pub fn delete_credential(&self, id: u64) -> Result<(), AdminServiceError> {
        self.token_manager
            .delete_credential(id)
            .map_err(|e| self.classify_delete_error(e, id))?;

        // 清理已删除凭据的余额缓存
        {
            let mut cache = self.balance_cache.lock();
            cache.remove(&id);
        }
        self.save_balance_cache();

        Ok(())
    }

    /// 获取负载均衡模式
    pub fn get_load_balancing_mode(&self) -> LoadBalancingModeResponse {
        LoadBalancingModeResponse {
            mode: self.token_manager.get_load_balancing_mode(),
            proxy_pair_rotation_interval_minutes: self
                .token_manager
                .get_proxy_pair_rotation_interval_minutes(),
            proxy_pair_rotation_group_size: self
                .token_manager
                .get_proxy_pair_rotation_group_size(),
            max_global_concurrency: self.token_manager.get_max_global_concurrency(),
            max_concurrency_queue_size: self.token_manager.get_max_concurrency_queue_size(),
            concurrency_queue_timeout_ms: self.token_manager.get_concurrency_queue_timeout_ms(),
            proxy_pair_rotation_proxy_rounds: self
                .token_manager
                .get_proxy_pair_rotation_proxy_rounds(),
        }
    }

    /// 设置负载均衡模式
    pub fn set_load_balancing_mode(
        &self,
        req: SetLoadBalancingModeRequest,
    ) -> Result<LoadBalancingModeResponse, AdminServiceError> {
        // 验证模式值
        if req.mode != "priority"
            && req.mode != "balanced"
            && req.mode != "proxy_pair_rotation"
        {
            return Err(AdminServiceError::InvalidCredential(
                "mode 必须是 'priority'、'balanced' 或 'proxy_pair_rotation'".to_string(),
            ));
        }

        self.token_manager
            .set_load_balancing_settings(
                req.mode.clone(),
                req.proxy_pair_rotation_interval_minutes.unwrap_or_else(|| {
                    self.token_manager.get_proxy_pair_rotation_interval_minutes()
                }),
                req.proxy_pair_rotation_group_size
                    .unwrap_or_else(|| self.token_manager.get_proxy_pair_rotation_group_size()),
                req.max_global_concurrency
                    .unwrap_or_else(|| self.token_manager.get_max_global_concurrency()),
                req.max_concurrency_queue_size
                    .unwrap_or_else(|| self.token_manager.get_max_concurrency_queue_size()),
                req.concurrency_queue_timeout_ms
                    .unwrap_or_else(|| self.token_manager.get_concurrency_queue_timeout_ms()),
                req.proxy_pair_rotation_proxy_rounds.unwrap_or_else(|| {
                    self.token_manager.get_proxy_pair_rotation_proxy_rounds()
                }),
            )
            .map_err(|e| AdminServiceError::InternalError(e.to_string()))?;

        Ok(self.get_load_balancing_mode())
    }

    // ============ 代理预设管理 ============

    /// 获取所有代理预设
    pub fn get_proxy_presets(&self) -> ProxyPresetsResponse {
        let presets = self.token_manager.get_proxy_presets();
        ProxyPresetsResponse { presets }
    }

    /// 添加代理预设
    pub fn add_proxy_preset(
        &self,
        req: AddProxyPresetRequest,
    ) -> Result<SuccessResponse, AdminServiceError> {
        // 验证名称不为空
        if req.name.trim().is_empty() {
            return Err(AdminServiceError::InvalidCredential(
                "代理预设名称不能为空".to_string(),
            ));
        }

        // 验证 URL 格式
        if req.proxy_url.trim().is_empty() {
            return Err(AdminServiceError::InvalidCredential(
                "代理 URL 不能为空".to_string(),
            ));
        }

        self.token_manager
            .add_proxy_preset(req.name.clone(), req.proxy_url, req.proxy_username, req.proxy_password)
            .map_err(|e| AdminServiceError::InternalError(e.to_string()))?;

        Ok(SuccessResponse::new(format!(
            "代理预设 '{}' 已添加",
            req.name
        )))
    }

    /// 更新代理预设
    pub fn update_proxy_preset(
        &self,
        old_name: String,
        req: UpdateProxyPresetRequest,
    ) -> Result<SuccessResponse, AdminServiceError> {
        // 验证名称不为空
        if req.name.trim().is_empty() {
            return Err(AdminServiceError::InvalidCredential(
                "代理预设名称不能为空".to_string(),
            ));
        }

        // 验证 URL 格式
        if req.proxy_url.trim().is_empty() {
            return Err(AdminServiceError::InvalidCredential(
                "代理 URL 不能为空".to_string(),
            ));
        }

        self.token_manager
            .update_proxy_preset(old_name.clone(), req.name.clone(), req.proxy_url, req.proxy_username, req.proxy_password)
            .map_err(|e| {
                if e.to_string().contains("不存在") {
                    AdminServiceError::NotFound { id: 0 }
                } else {
                    AdminServiceError::InternalError(e.to_string())
                }
            })?;

        Ok(SuccessResponse::new(format!(
            "代理预设 '{}' 已更新",
            req.name
        )))
    }

    /// 删除代理预设
    pub fn delete_proxy_preset(&self, name: String) -> Result<SuccessResponse, AdminServiceError> {
        self.token_manager
            .delete_proxy_preset(name.clone())
            .map_err(|e| {
                if e.to_string().contains("不存在") {
                    AdminServiceError::NotFound { id: 0 }
                } else {
                    AdminServiceError::InternalError(e.to_string())
                }
            })?;

        Ok(SuccessResponse::new(format!(
            "代理预设 '{}' 已删除",
            name
        )))
    }

    // ============ 余额缓存持久化 ============

    fn load_balance_cache_from(cache_path: &Option<PathBuf>) -> HashMap<u64, CachedBalance> {
        let path = match cache_path {
            Some(p) => p,
            None => return HashMap::new(),
        };

        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return HashMap::new(),
        };

        // 文件中使用字符串 key 以兼容 JSON 格式
        let map: HashMap<String, CachedBalance> = match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("解析余额缓存失败，将忽略: {}", e);
                return HashMap::new();
            }
        };

        let now = Utc::now().timestamp() as f64;
        map.into_iter()
            .filter_map(|(k, v)| {
                let id = k.parse::<u64>().ok()?;
                // 丢弃超过 TTL 的条目
                if (now - v.cached_at) < BALANCE_CACHE_TTL_SECS as f64 {
                    Some((id, v))
                } else {
                    None
                }
            })
            .collect()
    }

    fn save_balance_cache(&self) {
        let path = match &self.cache_path {
            Some(p) => p,
            None => return,
        };

        // 持有锁期间完成序列化和写入，防止并发损坏
        let cache = self.balance_cache.lock();
        let map: HashMap<String, &CachedBalance> =
            cache.iter().map(|(k, v)| (k.to_string(), v)).collect();

        match serde_json::to_string_pretty(&map) {
            Ok(json) => {
                if let Err(e) = std::fs::write(path, json) {
                    tracing::warn!("保存余额缓存失败: {}", e);
                }
            }
            Err(e) => tracing::warn!("序列化余额缓存失败: {}", e),
        }
    }

    // ============ 错误分类 ============

    /// 分类简单操作错误（set_disabled, set_priority, reset_and_enable）
    fn classify_error(&self, e: anyhow::Error, id: u64) -> AdminServiceError {
        let msg = e.to_string();
        if msg.contains("不存在") {
            AdminServiceError::NotFound { id }
        } else {
            AdminServiceError::InternalError(msg)
        }
    }

    /// 分类余额查询错误（可能涉及上游 API 调用）
    fn classify_balance_error(&self, e: anyhow::Error, id: u64) -> AdminServiceError {
        let msg = e.to_string();

        // 1. 凭据不存在
        if msg.contains("不存在") {
            return AdminServiceError::NotFound { id };
        }

        // 2. 上游服务错误特征：HTTP 响应错误或网络错误
        let is_upstream_error =
            // HTTP 响应错误（来自 refresh_*_token 的错误消息）
            msg.contains("凭证已过期或无效") ||
            msg.contains("权限不足") ||
            msg.contains("已被限流") ||
            msg.contains("服务器错误") ||
            msg.contains("Token 刷新失败") ||
            msg.contains("暂时不可用") ||
            // 网络错误（reqwest 错误）
            msg.contains("error trying to connect") ||
            msg.contains("connection") ||
            msg.contains("timeout") ||
            msg.contains("timed out");

        if is_upstream_error {
            AdminServiceError::UpstreamError(msg)
        } else {
            // 3. 默认归类为内部错误（本地验证失败、配置错误等）
            // 包括：缺少 refreshToken、refreshToken 已被截断、无法生成 machineId 等
            AdminServiceError::InternalError(msg)
        }
    }

    /// 分类代理检测错误
    fn classify_proxy_test_error(&self, e: anyhow::Error, id: u64) -> AdminServiceError {
        let msg = e.to_string();

        if msg.contains("不存在") {
            return AdminServiceError::NotFound { id };
        }

        let is_upstream_error = msg.contains("error trying to connect")
            || msg.contains("connection")
            || msg.contains("timeout")
            || msg.contains("timed out")
            || msg.contains("proxy")
            || msg.contains("dns error")
            || msg.contains("403")
            || msg.contains("407")
            || msg.contains("502")
            || msg.contains("503")
            || msg.contains("504");

        if is_upstream_error {
            AdminServiceError::UpstreamError(msg)
        } else {
            AdminServiceError::InternalError(msg)
        }
    }

    /// 分类凭据代理配置错误
    fn classify_credential_proxy_error(&self, e: anyhow::Error, id: u64) -> AdminServiceError {
        let msg = e.to_string();

        if msg.contains("不存在") {
            return AdminServiceError::NotFound { id };
        }

        let is_invalid_proxy = msg.contains("builder error")
            || msg.contains("relative URL without a base")
            || msg.contains("unknown proxy scheme")
            || msg.contains("invalid port")
            || msg.contains("proxy");

        if is_invalid_proxy {
            AdminServiceError::InvalidCredential(msg)
        } else {
            AdminServiceError::InternalError(msg)
        }
    }

    /// 分类全局代理配置错误
    fn classify_global_proxy_error(&self, e: anyhow::Error) -> AdminServiceError {
        let msg = e.to_string();

        let is_invalid_proxy = msg.contains("builder error")
            || msg.contains("relative URL without a base")
            || msg.contains("unknown proxy scheme")
            || msg.contains("invalid port")
            || msg.contains("proxy");

        if is_invalid_proxy {
            AdminServiceError::InvalidCredential(msg)
        } else {
            AdminServiceError::InternalError(msg)
        }
    }

    /// 分类添加凭据错误
    fn classify_add_error(&self, e: anyhow::Error) -> AdminServiceError {
        let msg = e.to_string();

        // 凭据验证失败（refreshToken 无效、格式错误等）
        let is_invalid_credential = msg.contains("缺少 refreshToken")
            || msg.contains("refreshToken 为空")
            || msg.contains("refreshToken 已被截断")
            || msg.contains("凭据已存在")
            || msg.contains("refreshToken 重复")
            || msg.contains("凭证已过期或无效")
            || msg.contains("权限不足")
            || msg.contains("已被限流");

        if is_invalid_credential {
            AdminServiceError::InvalidCredential(msg)
        } else if msg.contains("error trying to connect")
            || msg.contains("connection")
            || msg.contains("timeout")
        {
            AdminServiceError::UpstreamError(msg)
        } else {
            AdminServiceError::InternalError(msg)
        }
    }

    /// 分类删除凭据错误
    fn classify_delete_error(&self, e: anyhow::Error, id: u64) -> AdminServiceError {
        let msg = e.to_string();
        if msg.contains("不存在") {
            AdminServiceError::NotFound { id }
        } else if msg.contains("只能删除已禁用的凭据") || msg.contains("请先禁用凭据") {
            AdminServiceError::InvalidCredential(msg)
        } else {
            AdminServiceError::InternalError(msg)
        }
    }
}

fn redact_proxy_url(url: &str) -> String {
    let Ok(mut parsed) = reqwest::Url::parse(url) else {
        return url.to_string();
    };

    if !parsed.username().is_empty() {
        let _ = parsed.set_username("***");
    }

    let _ = parsed.set_password(None);
    parsed.to_string()
}

#[derive(Debug, Default)]
struct ProxyPresetNameLookup {
    exact: HashMap<String, Option<String>>,
    by_url_and_username: HashMap<String, Option<String>>,
    by_url: HashMap<String, Option<String>>,
}

fn normalize_proxy_url(url: &str) -> String {
    let trimmed = url.trim();
    let without_trailing_slash = trimmed.trim_end_matches('/');
    let normalized = if without_trailing_slash.is_empty() {
        trimmed
    } else {
        without_trailing_slash
    };

    normalized.to_lowercase()
}

fn normalize_proxy_auth_value(value: Option<&str>) -> String {
    value.unwrap_or("").trim().to_string()
}

fn proxy_signature(url: &str, username: Option<&str>, password: Option<&str>) -> String {
    format!(
        "{}|{}|{}",
        normalize_proxy_url(url),
        normalize_proxy_auth_value(username),
        normalize_proxy_auth_value(password)
    )
}

fn proxy_url_and_username_key(url: &str, username: Option<&str>) -> String {
    format!(
        "{}|{}",
        normalize_proxy_url(url),
        normalize_proxy_auth_value(username)
    )
}

fn record_unique_name(map: &mut HashMap<String, Option<String>>, key: String, name: &str) {
    match map.get_mut(&key) {
        Some(existing) => {
            if existing.as_deref() != Some(name) {
                *existing = None;
            }
        }
        None => {
            map.insert(key, Some(name.to_string()));
        }
    }
}

fn resolve_unique_name(map: &HashMap<String, Option<String>>, key: &str) -> Option<String> {
    map.get(key).and_then(|value| value.clone())
}

fn build_proxy_preset_name_lookup(presets: &[crate::model::config::ProxyPreset]) -> ProxyPresetNameLookup {
    let mut lookup = ProxyPresetNameLookup::default();

    for preset in presets {
        record_unique_name(
            &mut lookup.exact,
            proxy_signature(
                &preset.proxy_url,
                preset.proxy_username.as_deref(),
                preset.proxy_password.as_deref(),
            ),
            &preset.name,
        );

        record_unique_name(
            &mut lookup.by_url_and_username,
            proxy_url_and_username_key(&preset.proxy_url, preset.proxy_username.as_deref()),
            &preset.name,
        );

        record_unique_name(
            &mut lookup.by_url,
            normalize_proxy_url(&preset.proxy_url),
            &preset.name,
        );
    }

    lookup
}

fn resolve_proxy_preset_name(
    lookup: &ProxyPresetNameLookup,
    proxy_url: Option<&str>,
    proxy_username: Option<&str>,
    proxy_password: Option<&str>,
) -> Option<String> {
    let Some(url) = proxy_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return None;
    };

    if url.eq_ignore_ascii_case(KiroCredentials::PROXY_DIRECT) {
        return None;
    }

    let exact_key = proxy_signature(url, proxy_username, proxy_password);
    if let Some(name) = resolve_unique_name(&lookup.exact, &exact_key) {
        return Some(name);
    }

    let url_and_username_key = proxy_url_and_username_key(url, proxy_username);
    if let Some(name) = resolve_unique_name(&lookup.by_url_and_username, &url_and_username_key) {
        return Some(name);
    }

    let url_key = normalize_proxy_url(url);
    resolve_unique_name(&lookup.by_url, &url_key)
}

async fn fetch_exit_ip(client: &reqwest::Client) -> anyhow::Result<String> {
    const TEST_URLS: &[&str] = &[
        "https://api.ipify.org?format=json",
        "https://httpbin.org/ip",
    ];

    let mut last_error: Option<anyhow::Error> = None;

    for url in TEST_URLS {
        match client
            .get(*url)
            .header("User-Agent", "kiro-rs-admin-proxy-test/1.0")
            .send()
            .await
        {
            Ok(response) => {
                let response = match response.error_for_status() {
                    Ok(response) => response,
                    Err(error) => {
                        last_error = Some(error.into());
                        continue;
                    }
                };

                let payload = match response.json::<serde_json::Value>().await {
                    Ok(payload) => payload,
                    Err(error) => {
                        last_error = Some(error.into());
                        continue;
                    }
                };

                if let Some(ip) = payload.get("ip").and_then(|value| value.as_str()) {
                    return Ok(ip.to_string());
                }

                if let Some(ip) = payload.get("origin").and_then(|value| value.as_str()) {
                    return Ok(ip.to_string());
                }

                last_error = Some(anyhow::anyhow!(
                    "代理检测接口返回了无法识别的 IP 字段: {}",
                    url
                ));
            }
            Err(error) => {
                last_error = Some(error.into());
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("代理检测失败")))
}

#[cfg(test)]
mod tests {
    use super::{
        build_proxy_preset_name_lookup, normalize_proxy_url, resolve_proxy_preset_name,
    };
    use crate::model::config::ProxyPreset;

    fn preset(name: &str, url: &str, username: Option<&str>, password: Option<&str>) -> ProxyPreset {
        ProxyPreset {
            name: name.to_string(),
            proxy_url: url.to_string(),
            proxy_username: username.map(str::to_string),
            proxy_password: password.map(str::to_string),
        }
    }

    #[test]
    fn resolve_proxy_preset_name_prefers_exact_match() {
        let lookup = build_proxy_preset_name_lookup(&[
            preset("A", "proxy.example.com:8080", Some("u1"), Some("p1")),
            preset("B", "proxy.example.com:8080", Some("u2"), Some("p2")),
        ]);

        let resolved = resolve_proxy_preset_name(
            &lookup,
            Some("proxy.example.com:8080"),
            Some("u2"),
            Some("p2"),
        );
        assert_eq!(resolved.as_deref(), Some("B"));
    }

    #[test]
    fn resolve_proxy_preset_name_falls_back_to_url_and_username_when_password_missing() {
        let lookup = build_proxy_preset_name_lookup(&[
            preset("A", "proxy.example.com:8080", Some("u1"), Some("p1")),
            preset("B", "proxy.example.com:8080", Some("u2"), Some("p2")),
        ]);

        let resolved =
            resolve_proxy_preset_name(&lookup, Some("proxy.example.com:8080"), Some("u1"), None);
        assert_eq!(resolved.as_deref(), Some("A"));
    }

    #[test]
    fn resolve_proxy_preset_name_falls_back_to_unique_url_when_auth_not_available() {
        let lookup = build_proxy_preset_name_lookup(&[preset(
            "OnlyOne",
            "proxy.example.com:8080",
            Some("u1"),
            Some("p1"),
        )]);

        let resolved = resolve_proxy_preset_name(&lookup, Some("proxy.example.com:8080"), None, None);
        assert_eq!(resolved.as_deref(), Some("OnlyOne"));
    }

    #[test]
    fn resolve_proxy_preset_name_returns_none_when_url_match_is_ambiguous() {
        let lookup = build_proxy_preset_name_lookup(&[
            preset("A", "proxy.example.com:8080", Some("u1"), Some("p1")),
            preset("B", "proxy.example.com:8080", Some("u2"), Some("p2")),
        ]);

        let resolved = resolve_proxy_preset_name(&lookup, Some("proxy.example.com:8080"), None, None);
        assert_eq!(resolved, None);
    }

    #[test]
    fn normalize_proxy_url_ignores_trailing_slash_and_case() {
        assert_eq!(
            normalize_proxy_url("HTTP://Proxy.Example.Com:8080/"),
            "http://proxy.example.com:8080"
        );
    }

    #[test]
    fn resolve_proxy_preset_name_returns_none_for_direct_proxy() {
        let lookup = build_proxy_preset_name_lookup(&[preset(
            "Any",
            "proxy.example.com:8080",
            Some("u1"),
            Some("p1"),
        )]);

        let resolved = resolve_proxy_preset_name(&lookup, Some("direct"), Some("u1"), Some("p1"));
        assert_eq!(resolved, None);
    }
}
