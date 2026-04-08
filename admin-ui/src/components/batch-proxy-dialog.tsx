import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getProxyPresets, setCredentialProxyConfig } from '@/api/credentials'
import { extractErrorMessage } from '@/lib/utils'
import type { CredentialProxyConfigResponse, ProxyPreset } from '@/types/api'

interface BatchProxyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  credentialIds: number[]
  onApplied?: () => void
}

export function BatchProxyDialog({
  open,
  onOpenChange,
  credentialIds,
  onApplied,
}: BatchProxyDialogProps) {
  const queryClient = useQueryClient()
  const [proxyUrl, setProxyUrl] = useState('')
  const [proxyUsername, setProxyUsername] = useState('')
  const [proxyPassword, setProxyPassword] = useState('')
  const [presets, setPresets] = useState<ProxyPreset[]>([])
  const [selectedPreset, setSelectedPreset] = useState<string>('custom')
  const [isApplying, setIsApplying] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    getProxyPresets()
      .then((response) => setPresets(response.presets))
      .catch((error) => {
        console.error('加载代理预设失败:', error)
      })
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    setSelectedPreset('custom')
    setProxyUrl('')
    setProxyUsername('')
    setProxyPassword('')
  }, [open])

  const trimmedProxyUrl = proxyUrl.trim()
  const isDirect = trimmedProxyUrl.toLowerCase() === 'direct'
  const disableAuthFields = isApplying || !trimmedProxyUrl || isDirect

  const handlePresetChange = (value: string) => {
    setSelectedPreset(value)

    if (value === 'custom') {
      return
    }

    if (value === 'global') {
      setProxyUrl('')
      setProxyUsername('')
      setProxyPassword('')
      return
    }

    if (value === 'direct') {
      setProxyUrl('direct')
      setProxyUsername('')
      setProxyPassword('')
      return
    }

    const preset = presets.find((item) => item.name === value)
    if (preset) {
      setProxyUrl(preset.proxyUrl)
      setProxyUsername(preset.proxyUsername || '')
      setProxyPassword(preset.proxyPassword || '')
    }
  }

  const getPayload = (): Partial<CredentialProxyConfigResponse> => {
    if (selectedPreset === 'global') {
      return {
        proxyUrl: null,
        proxyUsername: null,
        proxyPassword: null,
      }
    }

    if (selectedPreset === 'direct' || isDirect) {
      return {
        proxyUrl: 'direct',
        proxyUsername: null,
        proxyPassword: null,
      }
    }

    return {
      proxyUrl: trimmedProxyUrl,
      proxyUsername: disableAuthFields ? null : (proxyUsername.trim() || null),
      proxyPassword: disableAuthFields ? null : (proxyPassword.trim() || null),
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (credentialIds.length === 0) {
      toast.error('请先选择要设置代理的账号')
      return
    }

    if (selectedPreset === 'custom' && !trimmedProxyUrl) {
      toast.error('请输入代理地址，或选择“跟随全局代理”')
      return
    }

    const payload = getPayload()
    let successCount = 0
    let failCount = 0
    let firstError = ''
    const failedIds: number[] = []

    setIsApplying(true)

    for (const id of credentialIds) {
      try {
        await setCredentialProxyConfig(id, payload)
        successCount++
      } catch (error) {
        failCount++
        failedIds.push(id)
        if (!firstError) {
          firstError = extractErrorMessage(error)
        }
      }
    }

    if (successCount > 0) {
      await queryClient.invalidateQueries({ queryKey: ['credentials'] })
    }

    setIsApplying(false)

    if (failCount === 0) {
      toast.success(`已成功为 ${successCount} 个账号更新代理`)
      onApplied?.()
      onOpenChange(false)
      return
    }

    const failedIdsPreview = failedIds.slice(0, 5).join(', ')
    const failedIdsSuffix = failedIds.length > 5 ? ' 等' : ''
    const failedIdsText = failedIds.length > 0
      ? `（失败账号 ID: ${failedIdsPreview}${failedIdsSuffix}）`
      : ''
    const firstErrorText = firstError ? `，首个错误: ${firstError}` : ''

    toast.warning(
      `批量代理设置完成：成功 ${successCount} 个，失败 ${failCount} 个${failedIdsText}${firstErrorText}`
    )
  }

  const selectedCount = credentialIds.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>批量代理配置</DialogTitle>
          <DialogDescription>
            将代理设置应用到已选择的 {selectedCount} 个账号
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              选择代理
            </label>
            <Select value={selectedPreset} onValueChange={handlePresetChange}>
              <SelectTrigger>
                <SelectValue placeholder="选择代理预设" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">跟随全局代理</SelectItem>
                <SelectItem value="direct">直连（不使用代理）</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
                {presets.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      代理预设
                    </div>
                    {presets.map((preset) => (
                      <SelectItem key={preset.name} value={preset.name}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {selectedPreset === 'custom' && (
            <>
              <div className="space-y-2">
                <label htmlFor="batchProxyUrl" className="text-sm font-medium">
                  代理地址
                </label>
                <Input
                  id="batchProxyUrl"
                  placeholder='输入代理地址，或改为“跟随全局代理”'
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  disabled={isApplying}
                />
                <p className="text-xs text-muted-foreground">
                  支持 `http://`、`https://`、`socks5://`。输入 `direct` 表示直连。
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label htmlFor="batchProxyUsername" className="text-sm font-medium">
                    账号
                  </label>
                  <Input
                    id="batchProxyUsername"
                    placeholder="可选"
                    value={proxyUsername}
                    onChange={(e) => setProxyUsername(e.target.value)}
                    disabled={disableAuthFields}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="batchProxyPassword" className="text-sm font-medium">
                    密码
                  </label>
                  <Input
                    id="batchProxyPassword"
                    type="password"
                    placeholder="可选"
                    value={proxyPassword}
                    onChange={(e) => setProxyPassword(e.target.value)}
                    disabled={disableAuthFields}
                  />
                </div>
              </div>
            </>
          )}

          {selectedPreset !== 'custom' && (
            <div className="rounded-md bg-muted p-3 text-sm">
              {selectedPreset === 'global' && '将统一改为跟随全局代理'}
              {selectedPreset === 'direct' && '将统一改为直连（不使用代理）'}
              {selectedPreset !== 'global' && selectedPreset !== 'direct' && (
                <div>
                  <div className="font-medium mb-1">已选择预设：{selectedPreset}</div>
                  <div className="text-xs text-muted-foreground">
                    {proxyUrl}
                    {proxyUsername && ` (用户名: ${proxyUsername})`}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isApplying}
            >
              取消
            </Button>
            <Button type="submit" disabled={isApplying || selectedCount === 0}>
              {isApplying ? `应用中... ${selectedCount}` : `应用到 ${selectedCount} 个账号`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
