// 凭据状态响应
export interface CredentialsStatusResponse {
  total: number
  available: number
  currentId: number
  activeRotationGroupIds: number[]
  proxyPairRotationRemainingSeconds: number
  credentials: CredentialStatusItem[]
}

// 单个凭据状态
export interface CredentialStatusItem {
  id: number
  priority: number
  disabled: boolean
  failureCount: number
  isCurrent: boolean
  expiresAt: string | null
  authMethod: string | null
  hasProfileArn: boolean
  email?: string
  refreshTokenHash?: string
  successCount: number
  lastUsedAt: string | null
  hasProxy: boolean
  proxyUrl?: string
  proxyPresetName?: string
  activeRequests: number
}

// 余额响应
export interface BalanceResponse {
  id: number
  subscriptionTitle: string | null
  currentUsage: number
  usageLimit: number
  remaining: number
  usagePercentage: number
  nextResetAt: number | null
}

// 代理检测响应
export interface ProxyTestResponse {
  credentialId: number
  usingProxy: boolean
  proxySource: 'credential' | 'global' | 'direct'
  proxyUrl?: string
  exitIp: string
  latencyMs: number
  message: string
}

// 代理配置
export interface ProxyConfigValue {
  proxyUrl: string | null
  proxyUsername: string | null
  proxyPassword: string | null
}

export type LoadBalancingMode =
  | 'priority'
  | 'balanced'
  | 'proxy_pair_rotation'

export interface LoadBalancingConfigResponse {
  mode: LoadBalancingMode
  proxyPairRotationIntervalMinutes: number
  proxyPairRotationGroupSize: number
  proxyPairRotationProxyRounds: string[][]
}

export interface SetLoadBalancingConfigRequest {
  mode: LoadBalancingMode
  proxyPairRotationIntervalMinutes?: number
  proxyPairRotationGroupSize?: number
  proxyPairRotationProxyRounds?: string[][]
}

// 单个凭据代理配置
export interface CredentialProxyConfigResponse extends ProxyConfigValue {}

// 全局代理配置
export interface GlobalProxyConfigResponse extends ProxyConfigValue {}

// 成功响应
export interface SuccessResponse {
  success: boolean
  message: string
}

// 错误响应
export interface AdminErrorResponse {
  error: {
    type: string
    message: string
  }
}

// 请求类型
export interface SetDisabledRequest {
  disabled: boolean
}

export interface SetPriorityRequest {
  priority: number
}

// 添加凭据请求
export interface AddCredentialRequest {
  refreshToken: string
  authMethod?: 'social' | 'idc'
  clientId?: string
  clientSecret?: string
  priority?: number
  authRegion?: string
  apiRegion?: string
  machineId?: string
  proxyUrl?: string
  proxyUsername?: string
  proxyPassword?: string
}

// 添加凭据响应
export interface AddCredentialResponse {
  success: boolean
  message: string
  credentialId: number
  email?: string
}

// 代理预设
export interface ProxyPreset {
  name: string
  proxyUrl: string
  proxyUsername?: string
  proxyPassword?: string
}

// 代理预设列表响应
export interface ProxyPresetsResponse {
  presets: ProxyPreset[]
}
