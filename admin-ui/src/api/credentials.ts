import axios from 'axios'
import { storage } from '@/lib/storage'
import type {
  CredentialsStatusResponse,
  BalanceResponse,
  CredentialProxyConfigResponse,
  GlobalProxyConfigResponse,
  LoadBalancingConfigResponse,
  ProxyTestResponse,
  SetLoadBalancingConfigRequest,
  SuccessResponse,
  SetDisabledRequest,
  SetPriorityRequest,
  AddCredentialRequest,
  AddCredentialResponse,
  ProxyPresetsResponse,
  ProxyPreset,
} from '@/types/api'

// 创建 axios 实例
const api = axios.create({
  baseURL: '/api/admin',
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器添加 API Key
api.interceptors.request.use((config) => {
  const apiKey = storage.getApiKey()
  if (apiKey) {
    config.headers['x-api-key'] = apiKey
  }
  return config
})

// 获取所有凭据状态
export async function getCredentials(): Promise<CredentialsStatusResponse> {
  const { data } = await api.get<CredentialsStatusResponse>('/credentials')
  return data
}

// 设置凭据禁用状态
export async function setCredentialDisabled(
  id: number,
  disabled: boolean
): Promise<SuccessResponse> {
  const { data } = await api.post<SuccessResponse>(
    `/credentials/${id}/disabled`,
    { disabled } as SetDisabledRequest
  )
  return data
}

// 设置凭据优先级
export async function setCredentialPriority(
  id: number,
  priority: number
): Promise<SuccessResponse> {
  const { data } = await api.post<SuccessResponse>(
    `/credentials/${id}/priority`,
    { priority } as SetPriorityRequest
  )
  return data
}

// 重置失败计数
export async function resetCredentialFailure(
  id: number
): Promise<SuccessResponse> {
  const { data } = await api.post<SuccessResponse>(`/credentials/${id}/reset`)
  return data
}

// 获取凭据余额
export async function getCredentialBalance(id: number): Promise<BalanceResponse> {
  const { data } = await api.get<BalanceResponse>(`/credentials/${id}/balance`)
  return data
}

// 检测凭据代理
export async function testCredentialProxy(id: number): Promise<ProxyTestResponse> {
  const { data } = await api.get<ProxyTestResponse>(`/credentials/${id}/proxy-test`)
  return data
}

// 获取指定凭据代理配置
export async function getCredentialProxyConfig(id: number): Promise<CredentialProxyConfigResponse> {
  const { data } = await api.get<CredentialProxyConfigResponse>(`/credentials/${id}/proxy`)
  return data
}

// 设置指定凭据代理配置
export async function setCredentialProxyConfig(
  id: number,
  payload: Partial<CredentialProxyConfigResponse>
): Promise<CredentialProxyConfigResponse> {
  const { data } = await api.put<CredentialProxyConfigResponse>(`/credentials/${id}/proxy`, payload)
  return data
}

// 获取全局代理配置
export async function getGlobalProxyConfig(): Promise<GlobalProxyConfigResponse> {
  const { data } = await api.get<GlobalProxyConfigResponse>('/config/proxy')
  return data
}

// 设置全局代理配置
export async function setGlobalProxyConfig(
  payload: Partial<GlobalProxyConfigResponse>
): Promise<GlobalProxyConfigResponse> {
  const { data } = await api.put<GlobalProxyConfigResponse>('/config/proxy', payload)
  return data
}

// 添加新凭据
export async function addCredential(
  req: AddCredentialRequest
): Promise<AddCredentialResponse> {
  const { data } = await api.post<AddCredentialResponse>('/credentials', req)
  return data
}

// 删除凭据
export async function deleteCredential(id: number): Promise<SuccessResponse> {
  const { data } = await api.delete<SuccessResponse>(`/credentials/${id}`)
  return data
}

// 获取负载均衡模式
export async function getLoadBalancingMode(): Promise<LoadBalancingConfigResponse> {
  const { data } = await api.get<LoadBalancingConfigResponse>('/config/load-balancing')
  return data
}

// 设置负载均衡模式
export async function setLoadBalancingMode(
  payload: SetLoadBalancingConfigRequest
): Promise<LoadBalancingConfigResponse> {
  const { data } = await api.put<LoadBalancingConfigResponse>('/config/load-balancing', payload)
  return data
}

// ============ 代理预设管理 ============

// 获取所有代理预设
export async function getProxyPresets(): Promise<ProxyPresetsResponse> {
  const { data } = await api.get<ProxyPresetsResponse>('/proxy-presets')
  return data
}

// 添加代理预设
export async function addProxyPreset(preset: Omit<ProxyPreset, 'id'>): Promise<SuccessResponse> {
  const { data } = await api.post<SuccessResponse>('/proxy-presets', preset)
  return data
}

// 更新代理预设
export async function updateProxyPreset(oldName: string, preset: Omit<ProxyPreset, 'id'>): Promise<SuccessResponse> {
  const { data } = await api.put<SuccessResponse>(`/proxy-presets/${encodeURIComponent(oldName)}`, preset)
  return data
}

// 删除代理预设
export async function deleteProxyPreset(name: string): Promise<SuccessResponse> {
  const { data } = await api.delete<SuccessResponse>(`/proxy-presets/${encodeURIComponent(name)}`)
  return data
}
