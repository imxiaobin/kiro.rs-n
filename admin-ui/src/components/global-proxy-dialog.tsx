import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useGlobalProxyConfig, useSetGlobalProxyConfig } from '@/hooks/use-credentials'
import { extractErrorMessage } from '@/lib/utils'

interface GlobalProxyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GlobalProxyDialog({ open, onOpenChange }: GlobalProxyDialogProps) {
  const [proxyUrl, setProxyUrl] = useState('')
  const [proxyUsername, setProxyUsername] = useState('')
  const [proxyPassword, setProxyPassword] = useState('')

  const { data, isLoading } = useGlobalProxyConfig()
  const { mutate, isPending } = useSetGlobalProxyConfig()

  useEffect(() => {
    if (!open) {
      return
    }

    setProxyUrl(data?.proxyUrl || '')
    setProxyUsername(data?.proxyUsername || '')
    setProxyPassword(data?.proxyPassword || '')
  }, [data, open])

  const handleClear = () => {
    setProxyUrl('')
    setProxyUsername('')
    setProxyPassword('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    mutate(
      {
        proxyUrl: proxyUrl.trim() || null,
        proxyUsername: proxyUrl.trim() ? (proxyUsername.trim() || null) : null,
        proxyPassword: proxyUrl.trim() ? (proxyPassword.trim() || null) : null,
      },
      {
        onSuccess: () => {
          toast.success(proxyUrl.trim() ? '全局代理已保存并生效' : '全局代理已关闭')
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
          <DialogTitle>全局代理设置</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="globalProxyUrl" className="text-sm font-medium">
              代理地址
            </label>
            <Input
              id="globalProxyUrl"
              placeholder="例如 http://127.0.0.1:7890 或 socks5://host:1080"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              disabled={isLoading || isPending}
            />
            <p className="text-xs text-muted-foreground">
              留空保存即关闭全局代理。必须带协议头，支持 `http://`、`https://`、`socks5://`
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label htmlFor="globalProxyUsername" className="text-sm font-medium">
                账号
              </label>
              <Input
                id="globalProxyUsername"
                placeholder="可选"
                value={proxyUsername}
                onChange={(e) => setProxyUsername(e.target.value)}
                disabled={isLoading || isPending || !proxyUrl.trim()}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="globalProxyPassword" className="text-sm font-medium">
                密码
              </label>
              <Input
                id="globalProxyPassword"
                type="password"
                placeholder="可选"
                value={proxyPassword}
                onChange={(e) => setProxyPassword(e.target.value)}
                disabled={isLoading || isPending || !proxyUrl.trim()}
              />
            </div>
          </div>

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
