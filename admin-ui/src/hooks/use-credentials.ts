import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCredentials,
  setCredentialDisabled,
  setCredentialPriority,
  resetCredentialFailure,
  getCredentialBalance,
  getCredentialProxyConfig,
  getGlobalProxyConfig,
  testCredentialProxy,
  addCredential,
  deleteCredential,
  setCredentialProxyConfig,
  setGlobalProxyConfig,
  getLoadBalancingMode,
  setLoadBalancingMode,
} from '@/api/credentials'
import type {
  AddCredentialRequest,
  CredentialProxyConfigResponse,
  GlobalProxyConfigResponse,
} from '@/types/api'

// 查询凭据列表
export function useCredentials() {
  return useQuery({
    queryKey: ['credentials'],
    queryFn: getCredentials,
    refetchInterval: 30000, // 每 30 秒刷新一次
  })
}

// 查询凭据余额
export function useCredentialBalance(id: number | null) {
  return useQuery({
    queryKey: ['credential-balance', id],
    queryFn: () => getCredentialBalance(id!),
    enabled: id !== null,
    retry: false, // 余额查询失败时不重试（避免重复请求被封禁的账号）
  })
}

// 检测凭据代理
export function useTestCredentialProxy() {
  return useMutation({
    mutationFn: (id: number) => testCredentialProxy(id),
  })
}

// 获取指定凭据代理配置
export function useCredentialProxyConfig(id: number | null, enabled = true) {
  return useQuery({
    queryKey: ['credentialProxyConfig', id],
    queryFn: () => getCredentialProxyConfig(id!),
    enabled: enabled && id !== null,
  })
}

// 设置指定凭据代理配置
export function useSetCredentialProxyConfig(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Partial<CredentialProxyConfigResponse>) =>
      setCredentialProxyConfig(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] })
      queryClient.invalidateQueries({ queryKey: ['credentialProxyConfig', id] })
    },
  })
}

// 获取全局代理配置
export function useGlobalProxyConfig() {
  return useQuery({
    queryKey: ['globalProxyConfig'],
    queryFn: getGlobalProxyConfig,
  })
}

// 设置全局代理配置
export function useSetGlobalProxyConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Partial<GlobalProxyConfigResponse>) => setGlobalProxyConfig(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['globalProxyConfig'] })
    },
  })
}

// 设置禁用状态
export function useSetDisabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, disabled }: { id: number; disabled: boolean }) =>
      setCredentialDisabled(id, disabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] })
    },
  })
}

// 设置优先级
export function useSetPriority() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, priority }: { id: number; priority: number }) =>
      setCredentialPriority(id, priority),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] })
    },
  })
}

// 重置失败计数
export function useResetFailure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => resetCredentialFailure(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] })
    },
  })
}

// 添加新凭据
export function useAddCredential() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: AddCredentialRequest) => addCredential(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] })
    },
  })
}

// 删除凭据
export function useDeleteCredential() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteCredential(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] })
    },
  })
}

// 获取负载均衡模式
export function useLoadBalancingMode() {
  return useQuery({
    queryKey: ['loadBalancingMode'],
    queryFn: getLoadBalancingMode,
  })
}

// 设置负载均衡模式
export function useSetLoadBalancingMode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setLoadBalancingMode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loadBalancingMode'] })
    },
  })
}
