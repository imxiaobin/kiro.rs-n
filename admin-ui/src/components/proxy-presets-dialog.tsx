import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, Edit2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { getProxyPresets, addProxyPreset, updateProxyPreset, deleteProxyPreset } from '@/api/credentials'
import type { ProxyPreset } from '@/types/api'

interface ProxyPresetsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProxyPresetsDialog({ open, onOpenChange }: ProxyPresetsDialogProps) {
  const [presets, setPresets] = useState<ProxyPreset[]>([])
  const [loading, setLoading] = useState(false)
  const [editingPreset, setEditingPreset] = useState<ProxyPreset | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    proxyUrl: '',
    proxyUsername: '',
    proxyPassword: '',
  })

  const loadPresets = async () => {
    try {
      setLoading(true)
      const response = await getProxyPresets()
      setPresets(response.presets)
    } catch (error) {
      toast.error('加载代理预设失败: ' + (error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      loadPresets()
    }
  }, [open])

  const handleAdd = async () => {
    if (!formData.name.trim() || !formData.proxyUrl.trim()) {
      toast.error('名称和代理 URL 不能为空')
      return
    }

    try {
      await addProxyPreset({
        name: formData.name,
        proxyUrl: formData.proxyUrl,
        proxyUsername: formData.proxyUsername || undefined,
        proxyPassword: formData.proxyPassword || undefined,
      })
      toast.success('代理预设已添加')
      setFormData({ name: '', proxyUrl: '', proxyUsername: '', proxyPassword: '' })
      setShowAddForm(false)
      loadPresets()
    } catch (error) {
      toast.error('添加失败: ' + (error as Error).message)
    }
  }

  const handleUpdate = async () => {
    if (!editingPreset || !formData.name.trim() || !formData.proxyUrl.trim()) {
      toast.error('名称和代理 URL 不能为空')
      return
    }

    try {
      await updateProxyPreset(editingPreset.name, {
        name: formData.name,
        proxyUrl: formData.proxyUrl,
        proxyUsername: formData.proxyUsername || undefined,
        proxyPassword: formData.proxyPassword || undefined,
      })
      toast.success('代理预设已更新')
      setEditingPreset(null)
      setFormData({ name: '', proxyUrl: '', proxyUsername: '', proxyPassword: '' })
      loadPresets()
    } catch (error) {
      toast.error('更新失败: ' + (error as Error).message)
    }
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`确定要删除代理预设 "${name}" 吗？`)) {
      return
    }

    try {
      await deleteProxyPreset(name)
      toast.success('代理预设已删除')
      loadPresets()
    } catch (error) {
      toast.error('删除失败: ' + (error as Error).message)
    }
  }

  const startEdit = (preset: ProxyPreset) => {
    setEditingPreset(preset)
    setFormData({
      name: preset.name,
      proxyUrl: preset.proxyUrl,
      proxyUsername: preset.proxyUsername || '',
      proxyPassword: preset.proxyPassword || '',
    })
    setShowAddForm(false)
  }

  const cancelEdit = () => {
    setEditingPreset(null)
    setShowAddForm(false)
    setFormData({ name: '', proxyUrl: '', proxyUsername: '', proxyPassword: '' })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>代理预设管理</DialogTitle>
          <DialogDescription>
            管理代理预设，可在配置凭据时快速选择
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 添加/编辑表单 */}
          {(showAddForm || editingPreset) && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div>
                  <label className="text-sm font-medium">预设名称</label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="例如：美国代理1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">代理 URL</label>
                  <Input
                    value={formData.proxyUrl}
                    onChange={(e) => setFormData({ ...formData, proxyUrl: e.target.value })}
                    placeholder="http://proxy.example.com:8080 或 socks5://proxy.example.com:1080"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">用户名（可选）</label>
                  <Input
                    value={formData.proxyUsername}
                    onChange={(e) => setFormData({ ...formData, proxyUsername: e.target.value })}
                    placeholder="代理认证用户名"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">密码（可选）</label>
                  <Input
                    type="password"
                    value={formData.proxyPassword}
                    onChange={(e) => setFormData({ ...formData, proxyPassword: e.target.value })}
                    placeholder="代理认证密码"
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={editingPreset ? handleUpdate : handleAdd}>
                    {editingPreset ? '更新' : '添加'}
                  </Button>
                  <Button variant="outline" onClick={cancelEdit}>
                    取消
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 添加按钮 */}
          {!showAddForm && !editingPreset && (
            <Button onClick={() => setShowAddForm(true)} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              添加新代理预设
            </Button>
          )}

          {/* 预设列表 */}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : presets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无代理预设
            </div>
          ) : (
            <div className="space-y-2">
              {presets.map((preset) => (
                <Card key={preset.name}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium">{preset.name}</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {preset.proxyUrl}
                        </p>
                        {preset.proxyUsername && (
                          <p className="text-xs text-muted-foreground mt-1">
                            用户名: {preset.proxyUsername}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(preset)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(preset.name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
