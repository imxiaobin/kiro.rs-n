import { useState, useEffect, useRef } from 'react'
import { RefreshCw, LogOut, Moon, Sun, Server, Plus, Upload, FileUp, Trash2, RotateCcw, CheckCircle2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { storage } from '@/lib/storage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CredentialCard } from '@/components/credential-card'
import { BalanceDialog } from '@/components/balance-dialog'
import { AddCredentialDialog } from '@/components/add-credential-dialog'
import { BatchImportDialog } from '@/components/batch-import-dialog'
import { BatchProxyDialog } from '@/components/batch-proxy-dialog'
import { GlobalProxyDialog } from '@/components/global-proxy-dialog'
import { KamImportDialog } from '@/components/kam-import-dialog'
import { BatchVerifyDialog, type VerifyResult } from '@/components/batch-verify-dialog'
import { LoadBalancingDialog } from '@/components/load-balancing-dialog'
import { ProxyPresetsDialog } from '@/components/proxy-presets-dialog'
import { useCredentials, useDeleteCredential, useResetFailure, useLoadBalancingMode } from '@/hooks/use-credentials'
import { getCredentialBalance, getProxyPresets, setCredentialDisabled, setCredentialProxyConfig } from '@/api/credentials'
import { cn, extractErrorMessage } from '@/lib/utils'
import type { BalanceResponse, LoadBalancingMode } from '@/types/api'

interface DashboardProps {
  onLogout: () => void
}

type CredentialTab = 'enabled' | 'disabled' | 'all'

const LOAD_BALANCING_MODE_OPTIONS: Array<{ value: LoadBalancingMode; label: string }> = [
  { value: 'priority', label: '优先级模式' },
  { value: 'balanced', label: '均衡负载模式' },
  { value: 'proxy_pair_rotation', label: '代理轮换模式' },
]

function getLoadBalancingModeLabel(mode?: LoadBalancingMode): string {
  return LOAD_BALANCING_MODE_OPTIONS.find((option) => option.value === mode)?.label || '优先级模式'
}

function formatCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const secs = safeSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function getProxyGroupLabel(hasProxy: boolean, proxyPresetName?: string, proxyUrl?: string): string {
  if (!hasProxy) {
    return '未配置代理'
  }
  if (proxyPresetName?.trim()) {
    return proxyPresetName.trim()
  }
  if (!proxyUrl) {
    return '已配置代理'
  }
  if (proxyUrl.toLowerCase() === 'direct') {
    return '直连（不使用代理）'
  }
  return proxyUrl
}

export function Dashboard({ onLogout }: DashboardProps) {
  const [selectedCredentialId, setSelectedCredentialId] = useState<number | null>(null)
  const [balanceDialogOpen, setBalanceDialogOpen] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [batchImportDialogOpen, setBatchImportDialogOpen] = useState(false)
  const [batchProxyDialogOpen, setBatchProxyDialogOpen] = useState(false)
  const [globalProxyDialogOpen, setGlobalProxyDialogOpen] = useState(false)
  const [loadBalancingDialogOpen, setLoadBalancingDialogOpen] = useState(false)
  const [proxyPresetsDialogOpen, setProxyPresetsDialogOpen] = useState(false)
  const [kamImportDialogOpen, setKamImportDialogOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [activeTab, setActiveTab] = useState<CredentialTab>('enabled')
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyProgress, setVerifyProgress] = useState({ current: 0, total: 0 })
  const [verifyResults, setVerifyResults] = useState<Map<number, VerifyResult>>(new Map())
  const [balanceMap, setBalanceMap] = useState<Map<number, BalanceResponse>>(new Map())
  const [loadingBalanceIds, setLoadingBalanceIds] = useState<Set<number>>(new Set())
  const [queryingInfo, setQueryingInfo] = useState(false)
  const [queryInfoProgress, setQueryInfoProgress] = useState({ current: 0, total: 0 })
  const [checkingAllBalances, setCheckingAllBalances] = useState(false)
  const [checkAllBalanceProgress, setCheckAllBalanceProgress] = useState({ current: 0, total: 0 })
  const [autoConfiguringProxy, setAutoConfiguringProxy] = useState(false)
  const [rotationCountdownSeconds, setRotationCountdownSeconds] = useState(0)
  const cancelVerifyRef = useRef(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 12
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark')
    }
    return false
  })

  const queryClient = useQueryClient()
  const { data, isLoading, error, refetch } = useCredentials()
  const { mutate: deleteCredential } = useDeleteCredential()
  const { mutate: resetFailure } = useResetFailure()
  const { data: loadBalancingData, isLoading: isLoadingMode } = useLoadBalancingMode()

  const allCredentials = data?.credentials || []
  const activeRotationGroupIds = new Set(data?.activeRotationGroupIds || [])
  const isRotationMode = loadBalancingData?.mode === 'proxy_pair_rotation'
  const enabledCredentialCount = allCredentials.filter(credential => !credential.disabled).length
  const disabledCredentialCount = allCredentials.filter(credential => credential.disabled).length
  const filteredCredentials = allCredentials.filter(credential => {
    if (activeTab === 'enabled') {
      return !credential.disabled
    }

    if (activeTab === 'disabled') {
      return credential.disabled
    }

    return true
  })
  const proxyCountMap = new Map<string, number>()
  for (const credential of allCredentials) {
    const label = getProxyGroupLabel(credential.hasProxy, credential.proxyPresetName, credential.proxyUrl)
    proxyCountMap.set(label, (proxyCountMap.get(label) || 0) + 1)
  }
  const proxyAccountCounts = Array.from(proxyCountMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN'))

  // 计算分页
  const totalPages = Math.max(1, Math.ceil(filteredCredentials.length / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentCredentials = filteredCredentials.slice(startIndex, endIndex)
  const currentPageEnabledCount = currentCredentials.filter(credential => !credential.disabled).length
  const selectedDisabledCount = Array.from(selectedIds).filter(id => {
    const credential = allCredentials.find(c => c.id === id)
    return Boolean(credential?.disabled)
  }).length

  // 当凭据列表变化时重置到第一页
  useEffect(() => {
    setCurrentPage(1)
  }, [data?.credentials.length])

  // 当筛选结果导致当前页越界时，自动回退到最后一页
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  // 过滤变化时清理不可见选中项，避免批量操作影响隐藏内容
  useEffect(() => {
    const visibleIds = new Set(filteredCredentials.map(credential => credential.id))

    setSelectedIds(prev => {
      if (prev.size === 0) {
        return prev
      }

      const next = new Set(Array.from(prev).filter(id => visibleIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filteredCredentials])

  // 只保留当前仍存在的凭据缓存，避免删除后残留旧数据
  useEffect(() => {
    if (!data?.credentials) {
      setBalanceMap(new Map())
      setLoadingBalanceIds(new Set())
      return
    }

    const validIds = new Set(data.credentials.map(credential => credential.id))

    setBalanceMap(prev => {
      const next = new Map<number, BalanceResponse>()
      prev.forEach((value, id) => {
        if (validIds.has(id)) {
          next.set(id, value)
        }
      })
      return next.size === prev.size ? prev : next
    })

    setLoadingBalanceIds(prev => {
      if (prev.size === 0) {
        return prev
      }
      const next = new Set<number>()
      prev.forEach(id => {
        if (validIds.has(id)) {
          next.add(id)
        }
      })
      return next.size === prev.size ? prev : next
    })
  }, [data?.credentials])

  useEffect(() => {
    setRotationCountdownSeconds(data?.proxyPairRotationRemainingSeconds || 0)
  }, [data?.proxyPairRotationRemainingSeconds])

  useEffect(() => {
    if (!isRotationMode) {
      setRotationCountdownSeconds(0)
      return
    }

    const timer = window.setInterval(() => {
      setRotationCountdownSeconds((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [isRotationMode])

  const toggleDarkMode = () => {
    setDarkMode(!darkMode)
    document.documentElement.classList.toggle('dark')
  }

  const handleViewBalance = (id: number) => {
    setSelectedCredentialId(id)
    setBalanceDialogOpen(true)
  }

  const handleRefresh = () => {
    refetch()
    toast.success('已刷新凭据列表')
  }

  const handleLogout = () => {
    storage.removeApiKey()
    queryClient.clear()
    onLogout()
  }

  // 选择管理
  const toggleSelect = (id: number) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const deselectAll = () => {
    setSelectedIds(new Set())
  }

  const handleTabChange = (tab: CredentialTab) => {
    setActiveTab(tab)
    setCurrentPage(1)
    deselectAll()
  }

  // 批量删除（仅删除已禁用项）
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) {
      toast.error('请先选择要删除的凭据')
      return
    }

    const disabledIds = Array.from(selectedIds).filter(id => {
      const credential = data?.credentials.find(c => c.id === id)
      return Boolean(credential?.disabled)
    })

    if (disabledIds.length === 0) {
      toast.error('选中的凭据中没有已禁用项')
      return
    }

    const skippedCount = selectedIds.size - disabledIds.length
    const skippedText = skippedCount > 0 ? `（将跳过 ${skippedCount} 个未禁用凭据）` : ''

    if (!confirm(`确定要删除 ${disabledIds.length} 个已禁用凭据吗？此操作无法撤销。${skippedText}`)) {
      return
    }

    let successCount = 0
    let failCount = 0

    for (const id of disabledIds) {
      try {
        await new Promise<void>((resolve, reject) => {
          deleteCredential(id, {
            onSuccess: () => {
              successCount++
              resolve()
            },
            onError: (err) => {
              failCount++
              reject(err)
            }
          })
        })
      } catch (error) {
        // 错误已在 onError 中处理
      }
    }

    const skippedResultText = skippedCount > 0 ? `，已跳过 ${skippedCount} 个未禁用凭据` : ''

    if (failCount === 0) {
      toast.success(`成功删除 ${successCount} 个已禁用凭据${skippedResultText}`)
    } else {
      toast.warning(`删除已禁用凭据：成功 ${successCount} 个，失败 ${failCount} 个${skippedResultText}`)
    }

    deselectAll()
  }

  // 批量恢复异常
  const handleBatchResetFailure = async () => {
    if (selectedIds.size === 0) {
      toast.error('请先选择要恢复的凭据')
      return
    }

    const failedIds = Array.from(selectedIds).filter(id => {
      const cred = data?.credentials.find(c => c.id === id)
      return cred && cred.failureCount > 0
    })

    if (failedIds.length === 0) {
      toast.error('选中的凭据中没有失败的凭据')
      return
    }

    let successCount = 0
    let failCount = 0

    for (const id of failedIds) {
      try {
        await new Promise<void>((resolve, reject) => {
          resetFailure(id, {
            onSuccess: () => {
              successCount++
              resolve()
            },
            onError: (err) => {
              failCount++
              reject(err)
            }
          })
        })
      } catch (error) {
        // 错误已在 onError 中处理
      }
    }

    if (failCount === 0) {
      toast.success(`成功恢复 ${successCount} 个凭据`)
    } else {
      toast.warning(`成功 ${successCount} 个，失败 ${failCount} 个`)
    }

    deselectAll()
  }

  const handleAutoConfigureProxy = async () => {
    const targets = allCredentials
      .filter(credential => !credential.hasProxy)
      .sort((a, b) => (a.priority - b.priority) || (a.id - b.id))

    if (targets.length === 0) {
      toast.info('当前没有未配置代理的账号')
      return
    }

    let presets
    try {
      const response = await getProxyPresets()
      presets = response.presets || []
    } catch (error) {
      toast.error(`加载代理预设失败: ${extractErrorMessage(error)}`)
      return
    }

    if (presets.length === 0) {
      toast.error('暂无可用代理预设，请先在”代理预设”中添加')
      return
    }

    // 统计各预设现有账号数，贪心分配：每次把账号给当前数量最少的预设
    const presetCounts = new Map<string, number>(presets.map(p => [p.name, 0]))
    for (const credential of allCredentials) {
      if (credential.proxyPresetName && presetCounts.has(credential.proxyPresetName)) {
        presetCounts.set(credential.proxyPresetName, (presetCounts.get(credential.proxyPresetName) ?? 0) + 1)
      }
    }

    const assignments: Array<{ credential: typeof targets[0]; preset: typeof presets[0] }> = []
    for (const credential of targets) {
      let minIdx = 0
      let minCount = presetCounts.get(presets[0].name) ?? 0
      for (let i = 1; i < presets.length; i++) {
        const count = presetCounts.get(presets[i].name) ?? 0
        if (count < minCount) {
          minCount = count
          minIdx = i
        }
      }
      const selected = presets[minIdx]
      assignments.push({ credential, preset: selected })
      presetCounts.set(selected.name, minCount + 1)
    }

    const assignmentSummary = presets
      .map(p => {
        const added = assignments.filter(a => a.preset.name === p.name).length
        return added > 0 ? `${p.name} +${added}` : null
      })
      .filter(Boolean)
      .join('、')

    const shouldApply = confirm(
      `将为 ${targets.length} 个未配置代理的账号按各代理现有数量均匀分配（${assignmentSummary}），是否继续？`
    )
    if (!shouldApply) {
      return
    }

    setAutoConfiguringProxy(true)
    let successCount = 0
    let failCount = 0
    const failedIds: number[] = []
    let firstError = ''

    try {
      for (const { credential, preset } of assignments) {
        try {
          await setCredentialProxyConfig(credential.id, {
            proxyUrl: preset.proxyUrl,
            proxyUsername: preset.proxyUsername || null,
            proxyPassword: preset.proxyPassword || null,
          })
          successCount++
        } catch (error) {
          failCount++
          failedIds.push(credential.id)
          if (!firstError) {
            firstError = extractErrorMessage(error)
          }
        }
      }

      if (successCount > 0) {
        await queryClient.invalidateQueries({ queryKey: ['credentials'] })
      }
    } finally {
      setAutoConfiguringProxy(false)
    }

    if (failCount === 0) {
      toast.success(`自动配置完成：成功 ${successCount} 个账号`)
      return
    }

    const failedIdsPreview = failedIds.slice(0, 5).join(', ')
    const failedIdsSuffix = failedIds.length > 5 ? ' 等' : ''
    const failedIdsText = failedIds.length > 0
      ? `（失败账号 ID: ${failedIdsPreview}${failedIdsSuffix}）`
      : ''
    const firstErrorText = firstError ? `，首个错误: ${firstError}` : ''

    toast.warning(
      `自动配置完成：成功 ${successCount} 个，失败 ${failCount} 个${failedIdsText}${firstErrorText}`
    )
  }

  // 一键清除所有已禁用凭据
  const handleClearAll = async () => {
    if (!data?.credentials || data.credentials.length === 0) {
      toast.error('没有可清除的凭据')
      return
    }

    const disabledCredentials = data.credentials.filter(credential => credential.disabled)

    if (disabledCredentials.length === 0) {
      toast.error('没有可清除的已禁用凭据')
      return
    }

    if (!confirm(`确定要清除所有 ${disabledCredentials.length} 个已禁用凭据吗？此操作无法撤销。`)) {
      return
    }

    let successCount = 0
    let failCount = 0
    let firstError = ''
    const failedIds: number[] = []

    for (const credential of disabledCredentials) {
      try {
        await new Promise<void>((resolve, reject) => {
          deleteCredential(credential.id, {
            onSuccess: () => {
              successCount++
              resolve()
            },
            onError: (err) => {
              failCount++
              failedIds.push(credential.id)
              if (!firstError) {
                firstError = extractErrorMessage(err)
              }
              reject(err)
            }
          })
        })
      } catch (error) {
        // 错误已在 onError 中处理
      }
    }

    await queryClient.invalidateQueries({ queryKey: ['credentials'] })

    if (failCount === 0) {
      toast.success(`成功清除所有 ${successCount} 个已禁用凭据`)
    } else {
      const failedIdsPreview = failedIds.slice(0, 5).join(', ')
      const failedIdsSuffix = failedIds.length > 5 ? ' 等' : ''
      const failedIdsText = failedIds.length > 0
        ? `（失败账号 ID: ${failedIdsPreview}${failedIdsSuffix}）`
        : ''
      const firstErrorText = firstError ? `，首个错误: ${firstError}` : ''

      toast.warning(
        `清除已禁用凭据：成功 ${successCount} 个，失败 ${failCount} 个${failedIdsText}${firstErrorText}`
      )
    }

    deselectAll()
  }

  const handleCheckAllBalances = async () => {
    const targets = allCredentials
      .sort((a, b) => (a.priority - b.priority) || (a.id - b.id))

    if (targets.length === 0) {
      toast.info('当前没有凭据可检查')
      return
    }

    if (!confirm(`将检查 ${targets.length} 个账号余额，查询失败将自动禁用对应账号，是否继续？`)) {
      return
    }

    setCheckingAllBalances(true)
    setCheckAllBalanceProgress({ current: 0, total: targets.length })

    let balanceSuccessCount = 0
    let balanceFailCount = 0
    let disableSuccessCount = 0
    let disableFailCount = 0
    let firstBalanceError = ''
    let firstDisableError = ''
    const balanceFailedIds: number[] = []
    const disableFailedIds: number[] = []

    try {
      for (let i = 0; i < targets.length; i++) {
        const id = targets[i].id

        setLoadingBalanceIds(prev => {
          const next = new Set(prev)
          next.add(id)
          return next
        })

        try {
          const balance = await getCredentialBalance(id)
          balanceSuccessCount++
          setBalanceMap(prev => {
            const next = new Map(prev)
            next.set(id, balance)
            return next
          })
        } catch (error) {
          balanceFailCount++
          balanceFailedIds.push(id)
          if (!firstBalanceError) {
            firstBalanceError = extractErrorMessage(error)
          }

          if (!targets[i].disabled) {
            try {
              await setCredentialDisabled(id, true)
              disableSuccessCount++
            } catch (disableError) {
              disableFailCount++
              disableFailedIds.push(id)
              if (!firstDisableError) {
                firstDisableError = extractErrorMessage(disableError)
              }
            }
          }
        } finally {
          setLoadingBalanceIds(prev => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }

        setCheckAllBalanceProgress({ current: i + 1, total: targets.length })
      }

      await queryClient.invalidateQueries({ queryKey: ['credentials'] })
    } finally {
      setCheckingAllBalances(false)
    }

    if (balanceFailCount === 0) {
      toast.success(`检查完成：${balanceSuccessCount} 个账号余额查询成功`)
      return
    }

    const balanceFailedIdsPreview = balanceFailedIds.slice(0, 5).join(', ')
    const balanceFailedIdsSuffix = balanceFailedIds.length > 5 ? ' 等' : ''
    const balanceFailedIdsText = balanceFailedIds.length > 0
      ? `（查询失败账号 ID: ${balanceFailedIdsPreview}${balanceFailedIdsSuffix}）`
      : ''
    const balanceErrorText = firstBalanceError ? `，首个查询错误: ${firstBalanceError}` : ''

    if (disableFailCount === 0) {
      toast.warning(
        `检查完成：余额查询成功 ${balanceSuccessCount} 个，失败 ${balanceFailCount} 个${balanceFailedIdsText}${balanceErrorText}，已自动禁用 ${disableSuccessCount} 个账号`
      )
      return
    }

    const disableFailedIdsPreview = disableFailedIds.slice(0, 5).join(', ')
    const disableFailedIdsSuffix = disableFailedIds.length > 5 ? ' 等' : ''
    const disableFailedIdsText = disableFailedIds.length > 0
      ? `（禁用失败账号 ID: ${disableFailedIdsPreview}${disableFailedIdsSuffix}）`
      : ''
    const disableErrorText = firstDisableError ? `，首个禁用错误: ${firstDisableError}` : ''

    toast.warning(
      `检查完成：余额查询成功 ${balanceSuccessCount} 个，失败 ${balanceFailCount} 个${balanceFailedIdsText}${balanceErrorText}，自动禁用成功 ${disableSuccessCount} 个、失败 ${disableFailCount} 个${disableFailedIdsText}${disableErrorText}`
    )
  }

  // 查询当前页凭据信息（逐个查询，避免瞬时并发）
  const handleQueryCurrentPageInfo = async () => {
    if (currentCredentials.length === 0) {
      toast.error('当前页没有可查询的凭据')
      return
    }

    const ids = currentCredentials
      .filter(credential => !credential.disabled)
      .map(credential => credential.id)

    if (ids.length === 0) {
      toast.error('当前页没有可查询的启用凭据')
      return
    }

    setQueryingInfo(true)
    setQueryInfoProgress({ current: 0, total: ids.length })

    let successCount = 0
    let failCount = 0

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]

      setLoadingBalanceIds(prev => {
        const next = new Set(prev)
        next.add(id)
        return next
      })

      try {
        const balance = await getCredentialBalance(id)
        successCount++

        setBalanceMap(prev => {
          const next = new Map(prev)
          next.set(id, balance)
          return next
        })
      } catch (error) {
        failCount++
      } finally {
        setLoadingBalanceIds(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }

      setQueryInfoProgress({ current: i + 1, total: ids.length })
    }

    setQueryingInfo(false)

    if (failCount === 0) {
      toast.success(`查询完成：成功 ${successCount}/${ids.length}`)
    } else {
      toast.warning(`查询完成：成功 ${successCount} 个，失败 ${failCount} 个`)
    }
  }

  // 批量验活
  const handleBatchVerify = async () => {
    if (selectedIds.size === 0) {
      toast.error('请先选择要验活的凭据')
      return
    }

    // 初始化状态
    setVerifying(true)
    cancelVerifyRef.current = false
    const ids = Array.from(selectedIds)
    setVerifyProgress({ current: 0, total: ids.length })

    let successCount = 0

    // 初始化结果，所有凭据状态为 pending
    const initialResults = new Map<number, VerifyResult>()
    ids.forEach(id => {
      initialResults.set(id, { id, status: 'pending' })
    })
    setVerifyResults(initialResults)
    setVerifyDialogOpen(true)

    // 开始验活
    for (let i = 0; i < ids.length; i++) {
      // 检查是否取消
      if (cancelVerifyRef.current) {
        toast.info('已取消验活')
        break
      }

      const id = ids[i]

      // 更新当前凭据状态为 verifying
      setVerifyResults(prev => {
        const newResults = new Map(prev)
        newResults.set(id, { id, status: 'verifying' })
        return newResults
      })

      try {
        const balance = await getCredentialBalance(id)
        successCount++

        // 更新为成功状态
        setVerifyResults(prev => {
          const newResults = new Map(prev)
          newResults.set(id, {
            id,
            status: 'success',
            usage: `${balance.currentUsage}/${balance.usageLimit}`
          })
          return newResults
        })
      } catch (error) {
        // 更新为失败状态
        setVerifyResults(prev => {
          const newResults = new Map(prev)
          newResults.set(id, {
            id,
            status: 'failed',
            error: extractErrorMessage(error)
          })
          return newResults
        })
      }

      // 更新进度
      setVerifyProgress({ current: i + 1, total: ids.length })

      // 添加延迟防止封号（最后一个不需要延迟）
      if (i < ids.length - 1 && !cancelVerifyRef.current) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }

    setVerifying(false)

    if (!cancelVerifyRef.current) {
      toast.success(`验活完成：成功 ${successCount}/${ids.length}`)
    }
  }

  // 取消验活
  const handleCancelVerify = () => {
    cancelVerifyRef.current = true
    setVerifying(false)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="text-red-500 mb-4">加载失败</div>
            <p className="text-muted-foreground mb-4">{(error as Error).message}</p>
            <div className="space-x-2">
              <Button onClick={() => refetch()}>重试</Button>
              <Button variant="outline" onClick={handleLogout}>重新登录</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            <span className="font-semibold">Kiro Admin</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setProxyPresetsDialogOpen(true)}
              title="管理代理预设"
            >
              代理管理
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGlobalProxyDialogOpen(true)}
              title="配置全局代理"
            >
              代理设置
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLoadBalancingDialogOpen(true)}
              disabled={isLoadingMode}
              title="配置请求模式"
            >
              {isLoadingMode ? '加载中...' : getLoadBalancingModeLabel(loadBalancingData?.mode)}
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleDarkMode}>
              {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleRefresh}>
              <RefreshCw className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="container mx-auto px-4 md:px-8 py-6">
        {/* 统计卡片 */}
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                凭据总数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data?.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                可用凭据
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{data?.available || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                当前活跃
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center gap-2">
                #{data?.currentId || '-'}
                <Badge variant="success">活跃</Badge>
              </div>
              {isRotationMode && (
                <p className="text-xs text-muted-foreground mt-2">
                  下一轮切换倒计时：{formatCountdown(rotationCountdownSeconds)}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 凭据列表 */}
        <div className="space-y-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-semibold">凭据管理</h2>
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">已选择 {selectedIds.size} 个</Badge>
                    <Button onClick={deselectAll} size="sm" variant="ghost">
                      取消选择
                    </Button>
                  </div>
                )}
              </div>

              <div className="inline-flex w-fit items-center rounded-lg border bg-muted/30 p-1">
                {[
                  { key: 'enabled' as const, label: '启用', count: enabledCredentialCount },
                  { key: 'disabled' as const, label: '禁用', count: disabledCredentialCount },
                  { key: 'all' as const, label: '全部', count: allCredentials.length },
                ].map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleTabChange(tab.key)}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      activeTab === tab.key
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs',
                        activeTab === tab.key
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {allCredentials.length > 0 && (
              <div className="xl:flex-1 xl:min-w-0">
                <div className="flex flex-wrap items-center gap-2 xl:justify-start">
                  <span className="text-xs text-muted-foreground">代理账号数:</span>
                  {proxyAccountCounts.map((item) => (
                    <Badge
                      key={item.label}
                      variant="outline"
                      className="max-w-[240px] gap-1"
                      title={`${item.label}: ${item.count}`}
                    >
                      <span className="truncate">{item.label}</span>
                      <span className="text-muted-foreground">{item.count}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 xl:justify-end">
              {selectedIds.size > 0 && (
                <>
                  <Button onClick={() => setBatchProxyDialogOpen(true)} size="sm" variant="outline">
                    批量代理
                  </Button>
                  <Button onClick={handleBatchVerify} size="sm" variant="outline">
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    批量验活
                  </Button>
                  <Button onClick={handleBatchResetFailure} size="sm" variant="outline">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    恢复异常
                  </Button>
                  <Button
                    onClick={handleBatchDelete}
                    size="sm"
                    variant="destructive"
                    disabled={selectedDisabledCount === 0}
                    title={selectedDisabledCount === 0 ? '只能删除已禁用凭据' : undefined}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    批量删除
                  </Button>
                </>
              )}
              {verifying && !verifyDialogOpen && (
                <Button onClick={() => setVerifyDialogOpen(true)} size="sm" variant="secondary">
                  <CheckCircle2 className="h-4 w-4 mr-2 animate-spin" />
                  验活中... {verifyProgress.current}/{verifyProgress.total}
                </Button>
              )}
              {allCredentials.length > 0 && (
                <Button
                  onClick={handleCheckAllBalances}
                  size="sm"
                  variant="outline"
                  disabled={checkingAllBalances}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${checkingAllBalances ? 'animate-spin' : ''}`} />
                  {checkingAllBalances
                    ? `检查中... ${checkAllBalanceProgress.current}/${checkAllBalanceProgress.total}`
                    : '检查全部余额'}
                </Button>
              )}
              {allCredentials.length > 0 && (
                <Button
                  onClick={handleAutoConfigureProxy}
                  size="sm"
                  variant="outline"
                  disabled={autoConfiguringProxy || checkingAllBalances}
                >
                  {autoConfiguringProxy ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      自动配置中...
                    </>
                  ) : (
                    '自动配置代理'
                  )}
                </Button>
              )}
              {filteredCredentials.length > 0 && (
                <Button
                  onClick={handleQueryCurrentPageInfo}
                  size="sm"
                  variant="outline"
                  disabled={queryingInfo || checkingAllBalances || currentPageEnabledCount === 0}
                  title={currentPageEnabledCount === 0 ? '当前 tab 没有可查询的启用凭据' : undefined}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${queryingInfo ? 'animate-spin' : ''}`} />
                  {queryingInfo ? `查询中... ${queryInfoProgress.current}/${queryInfoProgress.total}` : '查询信息'}
                </Button>
              )}
              {allCredentials.length > 0 && (
                <Button
                  onClick={handleClearAll}
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={disabledCredentialCount === 0}
                  title={disabledCredentialCount === 0 ? '没有可清除的已禁用凭据' : undefined}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  清除已禁用
                </Button>
              )}
              <Button onClick={() => setKamImportDialogOpen(true)} size="sm" variant="outline">
                <FileUp className="h-4 w-4 mr-2" />
                Kiro Account Manager 导入
              </Button>
              <Button onClick={() => setBatchImportDialogOpen(true)} size="sm" variant="outline">
                <Upload className="h-4 w-4 mr-2" />
                批量导入
              </Button>
              <Button onClick={() => setAddDialogOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                添加凭据
              </Button>
            </div>
          </div>
          {allCredentials.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                暂无凭据
              </CardContent>
            </Card>
          ) : filteredCredentials.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {activeTab === 'enabled' ? '暂无启用凭据' : '暂无禁用凭据'}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {currentCredentials.map((credential) => (
                  <CredentialCard
                    key={credential.id}
                    credential={credential}
                    onViewBalance={handleViewBalance}
                    selected={selectedIds.has(credential.id)}
                    onToggleSelect={() => toggleSelect(credential.id)}
                    balance={balanceMap.get(credential.id) || null}
                    loadingBalance={loadingBalanceIds.has(credential.id)}
                    isInActiveRotationGroup={activeRotationGroupIds.has(credential.id)}
                  />
                ))}
              </div>

              {/* 分页控件 */}
              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-4 mt-6">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    上一页
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    第 {currentPage} / {totalPages} 页（共 {filteredCredentials.length} 个凭据）
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    下一页
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* 余额对话框 */}
      <BalanceDialog
        credentialId={selectedCredentialId}
        open={balanceDialogOpen}
        onOpenChange={setBalanceDialogOpen}
      />

      {/* 添加凭据对话框 */}
      <AddCredentialDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />

      {/* 批量导入对话框 */}
      <BatchImportDialog
        open={batchImportDialogOpen}
        onOpenChange={setBatchImportDialogOpen}
      />

      <BatchProxyDialog
        open={batchProxyDialogOpen}
        onOpenChange={setBatchProxyDialogOpen}
        credentialIds={Array.from(selectedIds)}
        onApplied={deselectAll}
      />

      {/* 全局代理配置对话框 */}
      <GlobalProxyDialog
        open={globalProxyDialogOpen}
        onOpenChange={setGlobalProxyDialogOpen}
      />

      {/* 代理预设管理对话框 */}
      <ProxyPresetsDialog
        open={proxyPresetsDialogOpen}
        onOpenChange={setProxyPresetsDialogOpen}
      />
      <LoadBalancingDialog
        open={loadBalancingDialogOpen}
        onOpenChange={setLoadBalancingDialogOpen}
      />

      {/* KAM 账号导入对话框 */}
      <KamImportDialog
        open={kamImportDialogOpen}
        onOpenChange={setKamImportDialogOpen}
      />

      {/* 批量验活对话框 */}
      <BatchVerifyDialog
        open={verifyDialogOpen}
        onOpenChange={setVerifyDialogOpen}
        verifying={verifying}
        progress={verifyProgress}
        results={verifyResults}
        onCancel={handleCancelVerify}
      />
    </div>
  )
}
