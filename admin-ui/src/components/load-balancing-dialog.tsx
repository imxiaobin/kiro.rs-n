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
import { getProxyPresets } from '@/api/credentials'
import { useLoadBalancingMode, useSetLoadBalancingMode } from '@/hooks/use-credentials'
import { extractErrorMessage } from '@/lib/utils'
import type { LoadBalancingMode, ProxyPreset } from '@/types/api'

interface LoadBalancingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MODE_OPTIONS: Array<{ value: LoadBalancingMode; label: string }> = [
  { value: 'priority', label: '优先级模式' },
  { value: 'balanced', label: '均衡负载模式' },
  { value: 'proxy_pair_rotation', label: '代理轮换模式' },
]

function normalizeProxyRounds(rounds: string[][]): string[][] {
  return rounds
    .map((round) => {
      const seen = new Set<string>()
      const normalizedRound: string[] = []
      for (const item of round) {
        const value = item.trim()
        if (!value || seen.has(value)) {
          continue
        }
        seen.add(value)
        normalizedRound.push(value)
      }
      return normalizedRound
    })
    .filter((round) => round.length > 0)
}

export function LoadBalancingDialog({ open, onOpenChange }: LoadBalancingDialogProps) {
  const [mode, setMode] = useState<LoadBalancingMode>('priority')
  const [intervalMinutes, setIntervalMinutes] = useState('60')
  const [groupSize, setGroupSize] = useState('2')
  const [rotationProxyRounds, setRotationProxyRounds] = useState<string[][]>([])
  const [proxyPresets, setProxyPresets] = useState<ProxyPreset[]>([])
  const [proxyPresetsLoading, setProxyPresetsLoading] = useState(false)

  const { data, isLoading } = useLoadBalancingMode()
  const { mutate, isPending } = useSetLoadBalancingMode()

  useEffect(() => {
    if (!open) {
      return
    }

    setMode(data?.mode || 'priority')
    setIntervalMinutes(String(data?.proxyPairRotationIntervalMinutes || 60))
    setGroupSize(String(data?.proxyPairRotationGroupSize || 2))
    setRotationProxyRounds(
      normalizeProxyRounds(data?.proxyPairRotationProxyRounds || [])
    )
  }, [data, open])

  useEffect(() => {
    if (!open) {
      return
    }

    setProxyPresetsLoading(true)
    getProxyPresets()
      .then((response) => {
        setProxyPresets(response.presets || [])
      })
      .catch((error) => {
        console.error('加载代理预设失败:', error)
      })
      .finally(() => {
        setProxyPresetsLoading(false)
      })
  }, [open])

  const addProxyRound = () => {
    setRotationProxyRounds((prev) => [...prev, []])
  }

  const removeProxyRound = (roundIndex: number) => {
    setRotationProxyRounds((prev) => prev.filter((_, index) => index !== roundIndex))
  }

  const togglePresetInRound = (roundIndex: number, presetName: string) => {
    setRotationProxyRounds((prev) =>
      prev.map((round, index) => {
        if (index !== roundIndex) {
          return round
        }

        if (round.includes(presetName)) {
          return round.filter((name) => name !== presetName)
        }

        return [...round, presetName]
      })
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsedIntervalMinutes = parseInt(intervalMinutes, 10)
    const parsedGroupSize = parseInt(groupSize, 10)

    if (Number.isNaN(parsedIntervalMinutes) || parsedIntervalMinutes <= 0) {
      toast.error('轮换分钟数必须是大于 0 的整数')
      return
    }

    if (Number.isNaN(parsedGroupSize) || parsedGroupSize <= 0) {
      toast.error('每轮账号数必须是大于 0 的整数')
      return
    }

    const parsedRotationProxyRounds = normalizeProxyRounds(rotationProxyRounds)

    mutate(
      {
        mode,
        proxyPairRotationIntervalMinutes: parsedIntervalMinutes,
        proxyPairRotationGroupSize: parsedGroupSize,
        proxyPairRotationProxyRounds: parsedRotationProxyRounds,
      },
      {
        onSuccess: () => {
          toast.success('请求模式配置已保存')
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>请求模式配置</DialogTitle>
          <DialogDescription>
            可配置请求模式，以及代理轮换模式的轮换周期、自动分组和自定义轮次。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">请求模式</label>
            <Select value={mode} onValueChange={(value) => setMode(value as LoadBalancingMode)}>
              <SelectTrigger disabled={isLoading || isPending}>
                <SelectValue placeholder="选择请求模式" />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label htmlFor="rotationIntervalMinutes" className="text-sm font-medium">
                轮换分钟数
              </label>
              <Input
                id="rotationIntervalMinutes"
                type="number"
                min="1"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value)}
                disabled={isLoading || isPending}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="rotationGroupSize" className="text-sm font-medium">
                每轮账号数（自动补位）
              </label>
              <Input
                id="rotationGroupSize"
                type="number"
                min="1"
                value={groupSize}
                onChange={(e) => setGroupSize(e.target.value)}
                disabled={isLoading || isPending}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium">
                轮次代理（可选）
              </label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addProxyRound}
                  disabled={isLoading || isPending}
                >
                  新增轮次
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setRotationProxyRounds([])}
                  disabled={isLoading || isPending || rotationProxyRounds.length === 0}
                >
                  清空
                </Button>
              </div>
            </div>

            {rotationProxyRounds.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                未配置轮次代理，将按生效代理账号自动分组轮换。
              </div>
            ) : (
              <div className="space-y-3">
                {rotationProxyRounds.map((round, roundIndex) => (
                  <div key={roundIndex} className="rounded-md border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">第 {roundIndex + 1} 轮</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeProxyRound(roundIndex)}
                        disabled={isLoading || isPending}
                      >
                        删除
                      </Button>
                    </div>

                    {round.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {round.map((proxyName) => (
                          <Button
                            key={`${roundIndex}-${proxyName}`}
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => togglePresetInRound(roundIndex, proxyName)}
                            disabled={isLoading || isPending}
                          >
                            {proxyName}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">当前轮次未选择代理</p>
                    )}

                    {proxyPresets.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {proxyPresets.map((preset) => {
                          const selected = round.includes(preset.name)
                          return (
                            <Button
                              key={`${roundIndex}-preset-${preset.name}`}
                              type="button"
                              size="sm"
                              variant={selected ? 'default' : 'outline'}
                              onClick={() => togglePresetInRound(roundIndex, preset.name)}
                              disabled={isLoading || isPending}
                            >
                              {preset.name}
                            </Button>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {proxyPresetsLoading
                          ? '代理预设加载中...'
                          : '暂无代理预设，可先在“代理预设”中添加。'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            轮换参数仅在“代理轮换模式”下生效。若未配置轮次代理，则按生效代理账号排序后自动分组轮换，且当前轮次不足时会按优先级从后备账号自动补位。
          </p>

          <DialogFooter className="gap-2 sm:gap-0">
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
