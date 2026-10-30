import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Hash,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2,
  X
} from 'lucide-react'
import type {
  InstanceSummary,
  KubeJsIndexItem,
  KubeJsIndexStatus,
  KubeJsIndexTag
} from '@shared/types'
import { cleanError } from '../lib/format'
import { Spinner } from './ui'

type TagMode = 'add' | 'remove' | 'removeAll'

const TAG_TYPES = ['item', 'block', 'fluid', 'jei']
const ID_PATTERN = /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/i
const TYPE_PATTERN = /^[a-z0-9_.-]+$/i
const tagIconCache = new Map<string, string | null>()

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function shortValue(value: string): string {
  const clean = value.replace(/^#/, '')
  const path = clean.includes(':') ? clean.slice(clean.indexOf(':') + 1) : clean
  const short = path.length > 18 ? `${path.slice(0, 16)}…` : path
  return value.startsWith('#') ? `#${short}` : short
}

function initial(value: string): string {
  const clean = value.replace(/^#/, '')
  const path = clean.includes(':') ? clean.slice(clean.indexOf(':') + 1) : clean
  return path ? path[0].toUpperCase() : '?'
}

function isTagId(value: string): boolean {
  return ID_PATTERN.test(value.trim())
}

function isLikelyId(value: string): boolean {
  return ID_PATTERN.test(value.trim())
}

function TagTile({
  value,
  icons
}: {
  value: string
  icons: Record<string, string | null>
}) {
  if (value.startsWith('#')) {
    return <span className="kjs-recipe-icon is-tag is-compact">#</span>
  }
  const icon = icons[value]
  if (icon) {
    return <img className="kjs-recipe-icon is-compact" src={icon} alt="" draggable={false} />
  }
  return <span className="kjs-recipe-icon is-fallback is-compact">{initial(value)}</span>
}

function buildTagCode(
  type: string,
  mode: TagMode,
  tagId: string,
  members: string[]
): { code: string; error: string } {
  const tagType = type.trim()
  if (!tagType || !TYPE_PATTERN.test(tagType)) {
    return { code: '', error: '标签类型需要类似 item、block、fluid 或 jei。' }
  }
  const tag = tagId.trim().replace(/^#/, '')
  if (!tag || !isTagId(`#${tag}`)) {
    return { code: '', error: '标签 ID 需要是 namespace:path 的格式。' }
  }
  if (mode === 'removeAll') {
    return {
      code: `ServerEvents.tags(${quote(tagType)}, event => {\n  event.removeAll(${quote(
        tag
      )})\n})\n`,
      error: ''
    }
  }
  const values = members.map((value) => value.trim()).filter(Boolean)
  if (values.length === 0) {
    return { code: '', error: mode === 'add' ? '请至少添加一个成员。' : '请至少添加一个要移除的成员。' }
  }
  for (const value of values) {
    if (!isLikelyId(value)) {
      return { code: '', error: `成员 ${value} 需要是 namespace:path 或 #tag。` }
    }
  }
  const method = mode === 'add' ? 'add' : 'remove'
  if (values.length === 1) {
    return {
      code: `ServerEvents.tags(${quote(tagType)}, event => {\n  event.${method}(${quote(
        tag
      )}, ${quote(values[0])})\n})\n`,
      error: ''
    }
  }
  const lines = values.map((value) => `    ${quote(value)}`).join(',\n')
  return {
    code: `ServerEvents.tags(${quote(tagType)}, event => {\n  event.${method}(${quote(
      tag
    )}, [\n${lines}\n  ])\n})\n`,
    error: ''
  }
}

export function KubeJsTagBuilder({
  instance,
  active,
  path,
  hasSelection,
  onInsert,
  onReplaceSelection,
  onOpenKnowledge
}: {
  instance: InstanceSummary | null
  active: boolean
  path: string
  hasSelection: boolean
  onInsert: (code: string) => void
  onReplaceSelection: (code: string) => void
  onOpenKnowledge: () => void
}) {
  const [tagType, setTagType] = useState('item')
  const [mode, setMode] = useState<TagMode>('add')
  const [tagId, setTagId] = useState('')
  const [members, setMembers] = useState<string[]>([''])
  const [status, setStatus] = useState<KubeJsIndexStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [existing, setExisting] = useState<KubeJsIndexTag | null>(null)
  const [existingLoading, setExistingLoading] = useState(false)

  const [tagPicker, setTagPicker] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const [tagResults, setTagResults] = useState<KubeJsIndexTag[]>([])
  const [tagTotal, setTagTotal] = useState(0)
  const [tagSearching, setTagSearching] = useState(false)
  const [tagSearchError, setTagSearchError] = useState('')

  const [memberPicker, setMemberPicker] = useState<number | null>(null)
  const [memberQuery, setMemberQuery] = useState('')
  const [memberResults, setMemberResults] = useState<
    { id: string; name: string; tag: boolean; detail: string }[]
  >([])
  const [memberSearching, setMemberSearching] = useState(false)
  const [memberSearchError, setMemberSearchError] = useState('')
  const [icons, setIcons] = useState<Record<string, string | null>>({})

  const tagSeq = useRef(0)
  const memberSeq = useRef(0)
  const existingSeq = useRef(0)
  const iconSeq = useRef(0)

  useEffect(() => {
    setTagType('item')
    setMode('add')
    setTagId('')
    setMembers([''])
    setStatus(null)
    setStatusError('')
    setExisting(null)
    setTagPicker(false)
    setMemberPicker(null)
    setIcons({})
  }, [instance?.id])

  useEffect(() => {
    if (!active || !instance) return
    let cancelled = false
    setStatusError('')
    void window.ccl.workshop
      .kubejsIndexStatus(instance.id)
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((cause) => {
        if (!cancelled) setStatusError(cleanError(cause))
      })
    return () => {
      cancelled = true
    }
  }, [active, instance?.id])

  // 当前标签的索引成员，用于“已有 N 个成员”提示。
  useEffect(() => {
    if (!active || !instance || status?.state !== 'ready') {
      setExisting(null)
      setExistingLoading(false)
      return
    }
    const id = tagId.trim().replace(/^#/, '')
    if (!id || !isTagId(`#${id}`)) {
      setExisting(null)
      setExistingLoading(false)
      return
    }
    const request = ++existingSeq.current
    setExistingLoading(true)
    const timer = window.setTimeout(() => {
      void window.ccl.workshop
        .kubejsIndexSearch({
          instanceId: instance.id,
          kind: 'tag',
          query: id,
          page: 1,
          pageSize: 20
        })
        .then((result) => {
          if (request !== existingSeq.current || result.kind !== 'tag') return
          const tagTypeLower = tagType.trim().toLowerCase()
          const found = (result.items as KubeJsIndexTag[]).find(
            (tag) =>
              tag.id === id &&
              (!TAG_TYPES.includes(tagTypeLower) || tag.type === tagTypeLower)
          )
          setExisting(found ?? null)
        })
        .catch(() => {
          if (request === existingSeq.current) setExisting(null)
        })
        .finally(() => {
          if (request === existingSeq.current) setExistingLoading(false)
        })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [active, instance?.id, status?.state, tagId, tagType])

  useEffect(() => {
    if (!tagPicker) {
      tagSeq.current += 1
      setTagResults([])
      setTagTotal(0)
      setTagSearching(false)
      return
    }
    if (!instance || status?.state !== 'ready') {
      tagSeq.current += 1
      setTagResults([])
      setTagTotal(0)
      return
    }
    const keyword = tagQuery.trim()
    if (!keyword) {
      tagSeq.current += 1
      setTagResults([])
      setTagTotal(0)
      return
    }
    const request = ++tagSeq.current
    setTagSearching(true)
    setTagSearchError('')
    const timer = window.setTimeout(() => {
      void window.ccl.workshop
        .kubejsIndexSearch({
          instanceId: instance.id,
          kind: 'tag',
          query: keyword,
          page: 1,
          pageSize: 20
        })
        .then((result) => {
          if (request !== tagSeq.current || result.kind !== 'tag') return
          const tagTypeLower = tagType.trim().toLowerCase()
          const tags = (result.items as KubeJsIndexTag[]).filter(
            (tag) =>
              !TAG_TYPES.includes(tagTypeLower) || tag.type === tagTypeLower
          )
          setTagResults(tags)
          setTagTotal(tags.length)
        })
        .catch((cause) => {
          if (request === tagSeq.current) setTagSearchError(cleanError(cause))
        })
        .finally(() => {
          if (request === tagSeq.current) setTagSearching(false)
        })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [tagPicker, tagQuery, tagType, instance?.id, status?.state])

  useEffect(() => {
    if (memberPicker === null) {
      memberSeq.current += 1
      setMemberResults([])
      setMemberSearching(false)
      return
    }
    if (!instance || status?.state !== 'ready') {
      memberSeq.current += 1
      setMemberResults([])
      return
    }
    const keyword = memberQuery.trim()
    if (!keyword) {
      memberSeq.current += 1
      setMemberResults([])
      return
    }
    const request = ++memberSeq.current
    setMemberSearching(true)
    setMemberSearchError('')
    const timer = window.setTimeout(() => {
      void Promise.all([
        window.ccl.workshop.kubejsIndexSearch({
          instanceId: instance.id,
          kind: 'item',
          query: keyword,
          page: 1,
          pageSize: 8
        }),
        window.ccl.workshop.kubejsIndexSearch({
          instanceId: instance.id,
          kind: 'tag',
          query: keyword,
          page: 1,
          pageSize: 5
        })
      ])
        .then(([items, tags]) => {
          if (request !== memberSeq.current) return
          const itemResult = items as {
            kind: 'item'
            items: KubeJsIndexItem[]
          }
          const next = itemResult.items.map((item) => ({
            id: item.id,
            name: item.nameZh || item.nameEn || item.id,
            tag: false,
            detail: item.block ? '方块' : '物品'
          }))
          if (tags.kind === 'tag') {
            for (const tag of tags.items as KubeJsIndexTag[]) {
              next.push({
                id: `#${tag.id}`,
                name: tag.id,
                tag: true,
                detail: `${tag.type} 标签 · ${tag.count} 成员`
              })
            }
          }
          setMemberResults(next.slice(0, 13))
        })
        .catch((cause) => {
          if (request === memberSeq.current) setMemberSearchError(cleanError(cause))
        })
        .finally(() => {
          if (request === memberSeq.current) setMemberSearching(false)
        })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [memberPicker, memberQuery, instance?.id, status?.state])

  const iconIds = useMemo(() => {
    const ids = new Set<string>()
    for (const value of members) {
      const clean = value.trim()
      if (clean && !clean.startsWith('#') && isLikelyId(clean)) ids.add(clean)
    }
    for (const value of existing?.members ?? []) {
      const clean = value.trim()
      if (clean && !clean.startsWith('#') && isLikelyId(clean)) ids.add(clean)
    }
    for (const result of memberResults) {
      if (!result.tag) ids.add(result.id)
    }
    return [...ids]
  }, [members, existing, memberResults])

  const iconKey = iconIds.join('|')
  useEffect(() => {
    if (!active || !instance) return
    const cacheKey = (id: string): string => `${instance.id}|${id}`
    const apply = (): void => {
      const next: Record<string, string | null> = {}
      for (const id of iconIds) next[id] = tagIconCache.get(cacheKey(id)) ?? null
      setIcons(next)
    }
    const missing = iconIds.filter((id) => !tagIconCache.has(cacheKey(id)))
    if (missing.length === 0) {
      apply()
      return
    }
    const request = ++iconSeq.current
    void window.ccl.workshop
      .kubejsItemIcons(instance.id, missing.slice(0, 80))
      .then((loaded) => {
        if (request !== iconSeq.current) return
        for (const [id, url] of Object.entries(loaded)) {
          tagIconCache.set(cacheKey(id), url)
        }
        apply()
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, instance?.id, iconKey])

  const preview = useMemo(
    () => buildTagCode(tagType, mode, tagId, members),
    [tagType, mode, tagId, members]
  )

  const manualTagId = tagQuery.trim().replace(/^#/, '')
  const manualTagValid = Boolean(manualTagId) && isTagId(`#${manualTagId}`)
  const manualMember = memberQuery.trim()
  const manualMemberValid = Boolean(manualMember) && isLikelyId(manualMember)

  const openTagPicker = () => {
    setTagPicker(true)
    setMemberPicker(null)
    setTagQuery(tagId)
    setTagResults([])
    setTagTotal(0)
    setTagSearchError('')
  }

  const openMemberPicker = (index: number) => {
    setMemberPicker(index)
    setTagPicker(false)
    setMemberQuery('')
    setMemberResults([])
    setMemberSearchError('')
  }

  const chooseTag = (value: string) => {
    setTagId(value.replace(/^#/, ''))
    setTagPicker(false)
  }

  const chooseMember = (value: string) => {
    if (memberPicker === null) return
    setMembers((current) => {
      const next = [...current]
      next[memberPicker] = value
      return next
    })
    setMemberPicker(null)
  }

  const modeLabel =
    mode === 'add' ? '添加成员' : mode === 'remove' ? '移除成员' : '清空标签'

  return (
    <div className="kjs-tag">
      <div className="kjs-recipe-head">
        <TagIcon size={13} />
        <strong>标签生成器</strong>
        <span>本地生成 · 不自动保存</span>
      </div>
      <p className="kjs-recipe-copy">
        选择标签类型和已有/新标签，增删成员后生成 ServerEvents.tags 代码。
      </p>
      {path && !path.startsWith('server_scripts/') && (
        <div className="kjs-check-note">
          标签通过 ServerEvents.tags 注册，通常应放在 server_scripts；当前文件是 {path}。
        </div>
      )}

      {tagPicker && (
        <div className="kjs-recipe-picker">
          <div className="kjs-recipe-picker-head">
            <strong>选择已有标签</strong>
            <button
              type="button"
              className="kjs-icon-btn"
              onClick={() => setTagPicker(false)}
              title="关闭标签搜索"
            >
              <X size={12} />
            </button>
          </div>
          <label className="kjs-recipe-search">
            <Search size={11} />
            <input
              autoFocus
              value={tagQuery}
              placeholder="搜索标签 ID 或成员，也可直接输入"
              onChange={(event) => setTagQuery(event.target.value)}
            />
          </label>
          <div className="kjs-recipe-results">
            {tagSearching && (
              <div className="kjs-recipe-search-state">
                <Spinner size={11} /> 搜索中…
              </div>
            )}
            {!tagSearching && tagSearchError && (
              <div className="kjs-check-error">{tagSearchError}</div>
            )}
            {!tagSearching &&
              !tagSearchError &&
              tagResults.map((tag) => (
                <button
                  key={`${tag.type}-${tag.id}`}
                  type="button"
                  className="kjs-recipe-result"
                  onClick={() => chooseTag(tag.id)}
                >
                  <span className="kjs-recipe-result-tile">#</span>
                  <span className="kjs-recipe-result-copy">
                    <strong>{tag.id}</strong>
                    <small>{tag.type} 标签</small>
                  </span>
                  <em>{tag.count} 成员</em>
                </button>
              ))}
            {!tagSearching && !tagSearchError && tagQuery.trim() && manualTagValid && (
              <button
                type="button"
                className="kjs-recipe-manual"
                onClick={() => chooseTag(manualTagId)}
              >
                <Hash size={11} />
                使用标签 ID <code>{manualTagId}</code>
              </button>
            )}
            {!tagSearching && !tagSearchError && tagQuery.trim() && !manualTagValid && tagResults.length === 0 && (
              <div className="kjs-recipe-search-state">
                没有匹配，或标签 ID 格式不正确（需要 namespace:path）。
              </div>
            )}
            {!tagQuery.trim() && (
              <div className="kjs-recipe-search-state">
                输入标签 ID 或成员名搜索；索引未建立时可直接手动输入。
              </div>
            )}
          </div>
          {tagTotal > tagResults.length && (
            <small className="kjs-recipe-result-total">
              共 {tagTotal} 个结果，继续输入可缩小范围。
            </small>
          )}
          {status?.state !== 'ready' && (
            <div className="kjs-recipe-index-hint">
              <span>索引未建立，仍可手动输入标签 ID。</span>
              <button
                type="button"
                onClick={() => {
                  setTagPicker(false)
                  onOpenKnowledge()
                }}
              >
                去知识页建立
              </button>
            </div>
          )}
        </div>
      )}

      {memberPicker !== null && (
        <div className="kjs-recipe-picker">
          <div className="kjs-recipe-picker-head">
            <strong>选择标签成员（第 {memberPicker + 1} 个）</strong>
            <button
              type="button"
              className="kjs-icon-btn"
              onClick={() => setMemberPicker(null)}
              title="关闭成员搜索"
            >
              <X size={12} />
            </button>
          </div>
          <label className="kjs-recipe-search">
            <Search size={11} />
            <input
              autoFocus
              value={memberQuery}
              placeholder="搜索物品或标签，也可直接输入"
              onChange={(event) => setMemberQuery(event.target.value)}
            />
          </label>
          <div className="kjs-recipe-results">
            {memberSearching && (
              <div className="kjs-recipe-search-state">
                <Spinner size={11} /> 搜索中…
              </div>
            )}
            {!memberSearching && memberSearchError && (
              <div className="kjs-check-error">{memberSearchError}</div>
            )}
            {!memberSearching &&
              !memberSearchError &&
              memberResults.map((result) => (
                <button
                  key={`${result.tag ? 'tag' : 'item'}-${result.id}`}
                  type="button"
                  className="kjs-recipe-result"
                  onClick={() => chooseMember(result.id)}
                >
                  <span className="kjs-recipe-result-tile">
                    <TagTile value={result.id} icons={icons} />
                  </span>
                  <span className="kjs-recipe-result-copy">
                    <strong>{result.name}</strong>
                    <small>{result.id}</small>
                  </span>
                  <em>{result.tag ? '标签' : result.detail}</em>
                </button>
              ))}
            {!memberSearching &&
              !memberSearchError &&
              memberQuery.trim() &&
              manualMemberValid && (
                <button
                  type="button"
                  className="kjs-recipe-manual"
                  onClick={() => chooseMember(manualMember)}
                >
                  <Hash size={11} />
                  使用原样 ID <code>{manualMember}</code>
                </button>
              )}
            {!memberSearching &&
              !memberSearchError &&
              memberQuery.trim() &&
              !manualMemberValid &&
              memberResults.length === 0 && (
                <div className="kjs-recipe-search-state">
                  没有匹配，或 ID 格式不正确（需要 namespace:path）。
                </div>
              )}
            {!memberQuery.trim() && (
              <div className="kjs-recipe-search-state">
                {status?.state === 'ready'
                  ? '输入中文名或 ID；标签成员也可以使用 #tag。'
                  : '输入物品或标签 ID；建立实例索引后还能按中文名搜索。'}
              </div>
            )}
          </div>
          {status?.state !== 'ready' && (
            <div className="kjs-recipe-index-hint">
              <span>索引未建立，仍可手动输入成员 ID。</span>
              <button
                type="button"
                onClick={() => {
                  setMemberPicker(null)
                  onOpenKnowledge()
                }}
              >
                去知识页建立
              </button>
            </div>
          )}
        </div>
      )}

      <div className="kjs-recipe-field">
        <span className="kjs-recipe-label">标签类型</span>
        <input
          className="kjs-recipe-text-input"
          list="kjs-tag-types"
          value={tagType}
          spellCheck={false}
          onChange={(event) => setTagType(event.target.value)}
        />
        <datalist id="kjs-tag-types">
          {TAG_TYPES.map((type) => (
            <option key={type} value={type} />
          ))}
        </datalist>
        <small className="kjs-recipe-hint">
          常用 item / block / fluid / jei；其他类型可以直接输入。
        </small>
      </div>

      <div className="kjs-recipe-field">
        <span className="kjs-recipe-label">标签 ID</span>
        <div className="kjs-tag-id-row">
          <input
            className="kjs-recipe-text-input"
            value={tagId}
            spellCheck={false}
            placeholder="forge:ingots/steel"
            onChange={(event) => setTagId(event.target.value)}
          />
          <button
            type="button"
            className="kjs-tag-search-btn"
            title="搜索已有标签"
            onClick={openTagPicker}
          >
            <Search size={12} />
          </button>
        </div>
        {existing ? (
          <div className="kjs-tag-existing">
            <div className="kjs-tag-existing-head">
              <TagIcon size={10} />
              索引中已有 {existing.count} 个成员
              {existingLoading ? ' · 更新中…' : ''}
            </div>
            <div className="kjs-tag-existing-members">
              {existing.members.slice(0, 12).map((member) => (
                <span key={member} className="kjs-tag-chip" title={member}>
                  <TagTile value={member} icons={icons} />
                  {shortValue(member)}
                </span>
              ))}
              {existing.members.length > 12 && (
                <span className="kjs-tag-chip is-more">
                  +{existing.members.length - 12}
                </span>
              )}
            </div>
          </div>
        ) : tagId.trim() && status?.state === 'ready' && !existingLoading ? (
          <small className="kjs-recipe-hint">
            索引中没有找到这个标签；可以继续创建新标签。
          </small>
        ) : null}
      </div>

      <div className="kjs-recipe-field">
        <span className="kjs-recipe-label">操作</span>
        <div className="kjs-recipe-segmented kjs-tag-modes">
          {(['add', 'remove', 'removeAll'] as TagMode[]).map((item) => (
            <button
              key={item}
              type="button"
              className={mode === item ? 'is-active' : ''}
              onClick={() => setMode(item)}
            >
              {item === 'add' ? '添加成员' : item === 'remove' ? '移除成员' : '清空标签'}
            </button>
          ))}
        </div>
      </div>

      {mode !== 'removeAll' && (
        <div className="kjs-recipe-field">
          <div className="kjs-recipe-label-row">
            <span className="kjs-recipe-label">{modeLabel} 的成员</span>
            <button
              type="button"
              className="kjs-recipe-text-btn"
              disabled={members.length >= 24}
              onClick={() => setMembers((current) => [...current, ''])}
            >
              <Plus size={10} /> 添加
            </button>
          </div>
          {members.map((value, index) => (
            <div className="kjs-recipe-input-row" key={index}>
              <button
                type="button"
                className={`kjs-recipe-pick ${value ? 'has-value' : ''}`}
                onClick={() => openMemberPicker(index)}
                title={value || '选择成员'}
              >
                <span className="kjs-recipe-pick-tile">
                  {value ? <TagTile value={value} icons={icons} /> : <Plus size={11} />}
                </span>
                <span className="kjs-recipe-pick-copy">
                  <strong>{value ? shortValue(value) : '选择成员'}</strong>
                  <small>{value || '物品或 #标签'}</small>
                </span>
              </button>
              {members.length > 1 && (
                <button
                  type="button"
                  className="kjs-icon-btn"
                  title="移除这行"
                  onClick={() =>
                    setMembers((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index)
                    )
                  }
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}
          <small className="kjs-recipe-hint">
            {mode === 'add' ? '会写入 event.add' : '会写入 event.remove'}；成员可以是物品或 #标签。
          </small>
        </div>
      )}

      <div className="kjs-recipe-preview">
        <div className="kjs-recipe-preview-head">
          <span>代码预览</span>
          <em>ServerEvents.tags</em>
        </div>
        {preview.error ? (
          <div className="kjs-recipe-error">
            <AlertTriangle size={12} />
            <span>{preview.error}</span>
          </div>
        ) : (
          <pre>{preview.code}</pre>
        )}
      </div>

      <div className="kjs-recipe-actions">
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={Boolean(preview.error) || !path}
          onClick={() => onInsert(preview.code)}
        >
          插入光标
        </button>
        <button
          type="button"
          className="button button--primary button--sm"
          disabled={Boolean(preview.error) || !path || !hasSelection}
          onClick={() => onReplaceSelection(preview.code)}
        >
          替换选区
        </button>
      </div>
      <small className="kjs-recipe-hint">
        {!path
          ? '先打开一个 KubeJS 文件。'
          : hasSelection
            ? '当前有选区；替换只改选区，应用后仍未保存。'
            : '应用后是未保存状态，检查无误再 Ctrl+S。'}
      </small>
      {statusError && <div className="kjs-check-error">{statusError}</div>}
    </div>
  )
}
