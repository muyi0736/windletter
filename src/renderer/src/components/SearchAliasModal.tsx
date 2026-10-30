import { useEffect, useState } from 'react'
import type { CustomSearchAliasPayload } from '@shared/types'
import {
  ExternalLink,
  Link2,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react'
import { useLauncher } from '../store'
import { cleanError } from '../lib/format'
import { Badge, EmptyState, Modal, Spinner } from './ui'

export function SearchAliasModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}) {
  const toast = useLauncher((state) => state.toast)
  const [payload, setPayload] = useState<CustomSearchAliasPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setPayload(await window.ccl.searchAliases.list())
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) {
      setUrl('')
      setError('')
      setPayload(null)
      return
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const importAlias = async () => {
    const value = url.trim()
    if (!value || importing) return
    setImporting(true)
    setError('')
    try {
      const result = await window.ccl.searchAliases.importMcmod(value)
      setPayload({ items: result.items })
      setUrl('')
      toast(
        'success',
        '已加入中文搜索别名',
        `现在搜索「${result.item.chinese}」会匹配到 ${result.item.query}`
      )
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setImporting(false)
    }
  }

  const removeAlias = async (id: string, chinese: string) => {
    if (removing) return
    setRemoving(id)
    try {
      const next = await window.ccl.searchAliases.remove(id)
      setPayload(next)
      toast('info', '已移除搜索别名', chinese)
    } catch (err) {
      toast('error', '无法移除搜索别名', cleanError(err))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="中文搜索别名"
      subtitle="把 MC百科模组页里的中文名和 CurseForge / Modrinth 链接加入本地搜索索引"
      icon={<Link2 size={18} />}
      size="lg"
      footer={
        <div className="search-alias-footer">
          <span>{payload ? `共 ${payload.items.length} 条自定义别名` : '正在读取…'}</span>
          <button type="button" className="button button--soft button--sm" onClick={onClose}>
            关闭
          </button>
        </div>
      }
    >
      <div className="search-alias">
        <div className="search-alias-note">
          <Search size={14} />
          <span>
            PCL 使用离线的 MC百科翻译快照。为避免抓取 MC百科搜索页，风信只读取你主动粘贴的
            <strong> class 模组页链接</strong>；读取后只保存中文名、英文查询词和项目链接。
            数据来自 MC百科（BY-NC-SA 3.0）。
          </span>
        </div>

        <div className="search-alias-import">
          <div className="text-input">
            <Link2 size={14} />
            <input
              value={url}
              placeholder="https://www.mcmod.cn/class/3358.html"
              spellCheck={false}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void importAlias()
              }}
            />
          </div>
          <button
            type="button"
            className="button button--primary button--sm"
            disabled={!url.trim() || importing}
            onClick={() => void importAlias()}
          >
            {importing ? <Spinner size={12} /> : <Link2 size={13} />}
            导入
          </button>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => void window.ccl.app.openExternal('https://www.mcmod.cn/')}
          >
            <ExternalLink size={12} />
            打开 MC百科
          </button>
        </div>

        {error && (
          <div className="mods-error">
            <span>{error}</span>
            <button type="button" className="button button--soft button--xs" onClick={() => void load()}>
              <RefreshCw size={12} />
              重试
            </button>
          </div>
        )}

        {loading && !payload ? (
          <div className="downloads-loading">
            <Spinner size={15} />
            正在读取自定义别名…
          </div>
        ) : payload && payload.items.length === 0 ? (
          <EmptyState
            icon={<Link2 size={24} />}
            title="还没有自定义别名"
            description="在 MC百科搜索模组，打开它的资料页，复制地址栏里的 class 链接，粘贴到上方即可。"
          />
        ) : (
          <div className="search-alias-list">
            {payload?.items.map((item) => (
              <article key={item.id} className="search-alias-row">
                <div className="search-alias-body">
                  <div className="search-alias-head">
                    <strong>{item.chinese}</strong>
                    <span>{item.query}</span>
                  </div>
                  <div className="search-alias-meta">
                    {item.curseforgeSlugs.map((slug) => (
                      <Badge key={`cf-${slug}`} tone="neutral">
                        CurseForge · {slug}
                      </Badge>
                    ))}
                    {item.modrinthSlugs.map((slug) => (
                      <Badge key={`mr-${slug}`} tone="accent">
                        Modrinth · {slug}
                      </Badge>
                    ))}
                  </div>
                </div>
                {item.sourceUrl && (
                  <button
                    type="button"
                    className="button button--ghost button--xs"
                    title="打开来源页面"
                    onClick={() => void window.ccl.app.openExternal(item.sourceUrl as string)}
                  >
                    <ExternalLink size={12} />
                    来源
                  </button>
                )}
                <button
                  type="button"
                  className="button button--ghost button--xs"
                  title="移除这条别名"
                  disabled={removing !== null}
                  onClick={() => void removeAlias(item.id, item.chinese)}
                >
                  {removing === item.id ? <Spinner size={12} /> : <Trash2 size={12} />}
                  移除
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
