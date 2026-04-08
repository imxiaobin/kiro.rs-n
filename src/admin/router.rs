//! Admin API 路由配置

use axum::{
    Router, middleware,
    routing::{delete, get, post},
};

use super::{
    handlers::{
        add_credential, add_proxy_preset, delete_credential, delete_proxy_preset,
        get_all_credentials, get_credential_balance, get_credential_proxy_config,
        get_global_proxy_config, get_load_balancing_mode, get_proxy_presets,
        reset_failure_count, set_credential_disabled, set_credential_priority,
        set_credential_proxy_config, set_global_proxy_config, set_load_balancing_mode,
        test_credential_proxy, update_proxy_preset,
    },
    middleware::{AdminState, admin_auth_middleware},
};

/// 创建 Admin API 路由
///
/// # 端点
/// - `GET /credentials` - 获取所有凭据状态
/// - `POST /credentials` - 添加新凭据
/// - `DELETE /credentials/:id` - 删除凭据
/// - `POST /credentials/:id/disabled` - 设置凭据禁用状态
/// - `POST /credentials/:id/priority` - 设置凭据优先级
/// - `POST /credentials/:id/reset` - 重置失败计数
/// - `GET /credentials/:id/balance` - 获取凭据余额
/// - `GET /credentials/:id/proxy` - 获取凭据代理配置
/// - `PUT /credentials/:id/proxy` - 设置凭据代理配置
/// - `GET /config/proxy` - 获取全局代理配置
/// - `PUT /config/proxy` - 设置全局代理配置
/// - `GET /config/load-balancing` - 获取负载均衡模式
/// - `PUT /config/load-balancing` - 设置负载均衡模式
/// - `GET /proxy-presets` - 获取所有代理预设
/// - `POST /proxy-presets` - 添加代理预设
/// - `PUT /proxy-presets/:name` - 更新代理预设
/// - `DELETE /proxy-presets/:name` - 删除代理预设
///
/// # 认证
/// 需要 Admin API Key 认证，支持：
/// - `x-api-key` header
/// - `Authorization: Bearer <token>` header
pub fn create_admin_router(state: AdminState) -> Router {
    Router::new()
        .route(
            "/credentials",
            get(get_all_credentials).post(add_credential),
        )
        .route("/credentials/{id}", delete(delete_credential))
        .route("/credentials/{id}/disabled", post(set_credential_disabled))
        .route("/credentials/{id}/priority", post(set_credential_priority))
        .route("/credentials/{id}/reset", post(reset_failure_count))
        .route("/credentials/{id}/balance", get(get_credential_balance))
        .route("/credentials/{id}/proxy-test", get(test_credential_proxy))
        .route(
            "/credentials/{id}/proxy",
            get(get_credential_proxy_config).put(set_credential_proxy_config),
        )
        .route(
            "/config/proxy",
            get(get_global_proxy_config).put(set_global_proxy_config),
        )
        .route(
            "/config/load-balancing",
            get(get_load_balancing_mode).put(set_load_balancing_mode),
        )
        .route(
            "/proxy-presets",
            get(get_proxy_presets).post(add_proxy_preset),
        )
        .route(
            "/proxy-presets/{name}",
            axum::routing::put(update_proxy_preset).delete(delete_proxy_preset),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            admin_auth_middleware,
        ))
        .with_state(state)
}
