import { useEffect, useState } from 'react'
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
import {
  useCredentialProxyConfig,
  useSetCredentialProxyConfig,
} from '@/hooks/use-credentials'
import { getProxyPresets } from '@/api/credentials'
import { extractErrorMessage } from '@/lib/utils'
import type { ProxyPreset } from '@/types/api'

interface CredentialProxyDialogProps {
  credentialId: number
  credentialLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CredentialProxyDialog({
  credentialId,
  credentialLabel,
  open,
  onOpenChange,
}: CredentialProxyDialogProps) {
  const [proxyUrl, setProxyUrl] = useState('')
  const [proxyUsername, setProxyUsername] = useState('')
  const [proxyPassword, setProxyPassword] = useState('')
  const [presets, setPresets] = useState<ProxyPreset[]>([])
  const [selectedPreset, setSelectedPreset] = useState<string>('custom')

  const { data, isLoading } = useCredentialProxyConfig(credentialId, open)
  const { mutate, isPending } = useSetCredentialProxyConfig(credentialId)

  // 加载代理预设
  useEffect(() => {
    if (open) {
      getProxyPresets()
        .then((response) => setPresets(response.presets))
        .catch((error) => {
          console.error('加载代理预设失败:', error)
        })
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    setProxyUrl(data?.proxyUrl || '')
    setProxyUsername(data?.proxyUsername || '')
    setProxyPassword(data?.proxyPassword || '')
    setSelectedPreset('custom')
  }, [data, open, credentialId])

  const trimmedProxyUrl = proxyUrl.trim()
  const isDirect = trimmedProxyUrl.toLowerCase() === 'direct'
  const disableAuthFields = isLoading || isPending || !trimmedProxyUrl || isDirect

  const handlePresetChange = (value: string) => {
    setSelectedPreset(value)

    if (value === 'custom') {
      // 自定义，不做任何改变
      return
    }

    if (value === 'global') {
      // 跟随全局
      setProxyUrl('')
      setProxyUsername('')
      setProxyPassword('')
      return
    }

    if (value === 'direct') {
      // 直连
      setProxyUrl('direct')
      setProxyUsername('')
      setProxyPassword('')
      return
    }

    // 选择预设
    const preset = presets.find((p) => p.name === value)
    if (preset) {
      setProxyUrl(preset.proxyUrl)
      setProxyUsername(preset.proxyUsername || '')
      setProxyPassword(preset.proxyPassword || '')
    }
  }

  const handleClear = () => {
    setProxyUrl('')
    setProxyUsername('')
    setProxyPassword('')
    setSelectedPreset('global')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    mutate(
      {
        proxyUrl: trimmedProxyUrl || null,
        proxyUsername: disableAuthFields ? null : (proxyUsername.trim() || null),
        proxyPassword: disableAuthFields ? null : (proxyPassword.trim() || null),
      },
      {
        onSuccess: () => {
          const successMessage = !trimmedProxyUrl
            ? '该账号已改为跟随全局代理'
            : isDirect
              ? '该账号已改为直连'
              : '该账号代理已保存并生效'

          toast.success(successMessage)
          onOpenChange(false)
        },
        onError: (error: unknown) => {
          toast.error(`保存失败: ${extractErrorMessage(error)}`)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>账号代理配置</DialogTitle>
          <DialogDescription>{credentialLabel}</DialogDescription>
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
                <label htmlFor={`credentialProxyUrl-${credentialId}`} className="text-sm font-medium">
                  代理地址
                </label>
                <Input
                  id={`credentialProxyUrl-${credentialId}`}
                  placeholder='留空跟随全局，输入 "direct" 表示直连'
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  disabled={isLoading || isPending}
                />
                <p className="text-xs text-muted-foreground">
                  支持 `http://`、`https://`、`socks5://`。留空表示使用全局代理，`direct`
                  表示该账号显式不走代理。
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label htmlFor={`credentialProxyUsername-${credentialId}`} className="text-sm font-medium">
                    账号
                  </label>
                  <Input
                    id={`credentialProxyUsername-${credentialId}`}
                    placeholder="可选"
                    value={proxyUsername}
                    onChange={(e) => setProxyUsername(e.target.value)}
                    disabled={disableAuthFields}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor={`credentialProxyPassword-${credentialId}`} className="text-sm font-medium">
                    密码
                  </label>
                  <Input
                    id={`credentialProxyPassword-${credentialId}`}
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
              {selectedPreset === 'global' && '将使用全局代理配置'}
              {selectedPreset === 'direct' && '将不使用任何代理（直连）'}
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
              onClick={handleClear}
              disabled={isLoading || isPending}
            >
              清空
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              取消
            </Button>
            <Button type="submit" disabled={isLoading || isPending}>
              {isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
