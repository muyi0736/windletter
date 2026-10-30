import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Database,
  FolderTree,
  Keyboard,
  MessageCircleQuestion,
  MousePointerClick,
  PencilLine,
  Rocket,
  Save,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Wrench
} from 'lucide-react'
import type { InstanceSummary } from '@shared/types'
import { Modal } from './ui'

type HelpBlock =
  | { kind: 'text'; text: string }
  | { kind: 'steps'; items: string[] }
  | { kind: 'list'; items: string[] }
  | { kind: 'keys'; items: { keys: string; desc: string }[] }
  | { kind: 'subhead'; text: string }
  | { kind: 'note'; tone: 'info' | 'warn'; text: string }

interface HelpSection {
  id: string
  title: string
  icon: ReactNode
  summary: string
  blocks: HelpBlock[]
}

const SECTIONS: HelpSection[] = [
  {
    id: 'start',
    title: '快速开始',
    icon: <Rocket size={13} />,
    summary: '按“索引 → 生成 → 检查 → 保存”走一遍，基本不会踩坑。',
    blocks: [
      {
        kind: 'steps',
        items: [
          '在「知识」页点「建立索引」。首次约 10–20 秒，之后复用缓存。',
          '从左侧打开脚本，或用「新建文件」创建 `server_scripts/...`。',
          '在「配方」「标签」里生成代码，插入光标或替换选区。',
          '在「问题」页检查当前文件或整个项目。',
          '确认后按 `Ctrl+S` 保存；保存前会备份原文件。'
        ]
      },
      {
        kind: 'note',
        tone: 'info',
        text: '0.53.0 起，配方页支持「从已有配方导入」：搜索实例索引里的配方，映射成可视化后继续修改。'
      }
    ]
  },
  {
    id: 'files',
    title: '文件与标签',
    icon: <FolderTree size={13} />,
    summary: '左侧目录树就是实例真实的 kubejs 目录，不是副本。',
    blocks: [
      {
        kind: 'list',
        items: [
          '目录树支持折叠和「过滤文件或路径」；路径里有空格也能正常打开。',
          '新建文件限制 `.js/.json/.snbt/.txt/.properties/.md/.zs`，路径不能越出 `kubejs`。',
          '多标签编辑；标签上的圆点表示未保存，关闭时会确认。',
          '`F2` 重命名/移动当前文件；删除前会先备份。',
          '每个实例会恢复上次打开的标签和当前文件。'
        ]
      },
      {
        kind: 'note',
        tone: 'warn',
        text: '保存会真正写入当前实例的 KubeJS 目录，外部实例也不例外；写之前确认实例没选错。'
      }
    ]
  },
  {
    id: 'editor',
    title: '编辑与保存',
    icon: <PencilLine size={13} />,
    summary: 'CodeMirror 6 编辑器，每个标签保留独立的撤销、光标和滚动状态。',
    blocks: [
      {
        kind: 'list',
        items: [
          '查找替换 `Ctrl+F`，跳行 `Ctrl+G`，关闭标签 `Ctrl+W`，切换标签 `Ctrl+Tab`。',
          '上方工具栏可切换自动换行、字号、模板和查找；模板按加载器/版本过滤。',
          '保存当前 `Ctrl+S`，保存全部 `Ctrl+Shift+S`；内容没变不会写盘。',
          'BOM 和 CRLF 会保留；磁盘文件被外部修改时会提示冲突，可重新加载或强制覆盖。',
          '左栏「历史」可查看逐行 diff、恢复快照；恢复前再备份，每个文件保留 50 份。'
        ]
      },
      {
        kind: 'note',
        tone: 'warn',
        text: '遇到保存冲突先「重新加载」；只有确认自己的内容更重要时再强制覆盖。'
      }
    ]
  },
  {
    id: 'knowledge',
    title: '实例索引',
    icon: <Database size={13} />,
    summary: '只读扫描模组 jar、原版客户端数据、kubejs/data 和启动脚本，生成物品/配方/标签索引。',
    blocks: [
      {
        kind: 'list',
        items: [
          '首次建立约 10–20 秒，显示 jar、物品、配方、标签和耗时；可以取消。',
          '之后每次启动优先读缓存；模组或 kubejs/data 变了才需要重建。',
          '搜索物品、配方、标签，支持中文名/ID 和模组过滤；物品带图标，结果分页。',
          '物品/标签可插入 ID；配方可按 ID/产物/模组生成删除代码，插入后仍需自己保存。'
        ]
      },
      {
        kind: 'note',
        tone: 'info',
        text: '索引是静态快照：脚本里 `event.*` 运行时注册的配方/物品不会出现在索引里，问题页可能对动态物品给出警告。'
      }
    ]
  },
  {
    id: 'generate',
    title: '配方 / 标签生成',
    icon: <Wrench size={13} />,
    summary: '生成的是 KubeJS 代码，不会直接改游戏文件。',
    blocks: [
      { kind: 'subhead', text: '配方' },
      {
        kind: 'list',
        items: [
          '8 种基础类型：有序、无序、熔炉、高炉、烟熏、营火、切石、锻造。',
          '3×3 格子自动裁掉空行空列、复用字母键；无序材料可以重复添加。',
          '大网格 4×4–9×9 生成 `event.custom` 的 `pattern/key/result`，可补 tier/energy 等附加 JSON。',
          '机器/祭坛可视化槽位支持输入数量、`cast`、`mainOutput` 和字段映射，其余字段进附加 JSON。',
          '复杂 schema 用「自定义 JSON」，或让导入自动回退；不会静默丢字段。'
        ]
      },
      { kind: 'subhead', text: '从已有配方导入' },
      {
        kind: 'list',
        items: [
          '搜索实例索引里的配方（产物、ID、type、材料），结果带图标、type、材料预览和分页加载。',
          '从模组 jar / `kubejs/data` 只读原始 JSON，自动映射成基础配方、大网格或机器/祭坛可视化；无法完整表达的嵌套结构原样放进自定义 JSON。',
          '默认勾选「先生成 event.remove 移除原配方」，插入时先删原配方再注册新配方；取消勾选或点「不替换」就只新增。'
        ]
      },
      { kind: 'subhead', text: '标签' },
      {
        kind: 'list',
        items: [
          '类型可选 item/block/fluid/jei 或自定义；搜索已有标签会显示成员数和前几个成员。',
          '支持添加成员、移除成员、清空标签三种模式；最多 24 个物品/标签成员。',
          '生成 `ServerEvents.tags` 代码，插入或替换后仍需检查保存。'
        ]
      },
      {
        kind: 'note',
        tone: 'info',
        text: '配方通常放 `server_scripts`；生成器只负责把代码放进编辑器，不会自动保存。'
      }
    ]
  },
  {
    id: 'qa',
    title: 'AI 配方 / 物品问答',
    icon: <MessageCircleQuestion size={13} />,
    summary: '先检索本地索引，再让 AI 解释；答案带可复制的物品/配方 ID。',
    blocks: [
      {
        kind: 'list',
        items: [
          '在「问答」页输入问题，例如「铁锭怎么获得」「圆石能做什么」「铁锭属于哪些标签」；也可以直接贴物品或配方 ID。',
          '本地会先筛出相关物品、配方和标签，只把这一小段上下文和问题发给 AI，不上传整个实例、脚本或账户。',
          '答案下方列出本地引用；物品/配方/标签可复制 ID，AI 提到索引外 ID 会给出警告。',
          'AI 未启用或请求失败时只展示本地检索结果，不会阻止你继续查物品和配方。'
        ]
      },
      {
        kind: 'note',
        tone: 'info',
        text: '问答是只读的：每次点击「提问」才发送请求，不会自动应用或保存任何配方。'
      }
    ]
  },
  {
    id: 'explain',
    title: '释意、问题与日志',
    icon: <ScanSearch size={13} />,
    summary: '先本地释意，再按需用 AI 深讲；问题页负责静态检查与日志定位。',
    blocks: [
      {
        kind: 'list',
        items: [
          '「释意」本地用 AST 解析，不联网；识别事件、配方、标签、注册表、玩家、LootJS、Java 等操作，要点带行号可点击跳转。',
          '语法错误时回退为逐行识别并提示；脚本侧、按模组大范围删除、占位符也会提醒。',
          '「问题」页可看当前文件或全项目，支持只看错误、按文件折叠、点击跳行。',
          '可确定的命名/事件拼写问题会标「可修复」；点「一键修复」先看逐行 diff，可逐项勾选，应用后只改编辑器，不会自动保存。',
          '脚本侧错误会提供「移动到 server_scripts / client_scripts / startup_scripts」；移动会实际改变文件路径，有未保存修改时需先保存。',
          '「运行日志」只读 `logs/kubejs/*` 和 `logs/latest.log` 的末尾 2 MB，解析脚本路径、行号和堆栈，点击跳转。'
        ]
      },
      {
        kind: 'note',
        tone: 'info',
        text: '问题检查本身不会改脚本；只有点击修复/移动并确认后，才会修改编辑器内容或文件路径，文本仍需手动保存。ID 检查基于静态索引，运行时动态注册的物品可能被标为未找到。'
      }
    ]
  },
  {
    id: 'ai',
    title: 'AI 辅助',
    icon: <Sparkles size={13} />,
    summary: '可选能力，只有显式点击按钮才会请求你配置的 AI。',
    blocks: [
      {
        kind: 'list',
        items: [
          '在编辑器里选中一段脚本，点「改写选区」：只发送选中的行，AI 只返回替换片段。',
          '结果先用逐行 diff 预览（+/- 统计），确认后「替换选区」；只会替换选区，不动其他内容。',
          '没有选区时是整份脚本生成/插入/替换；两种方式都不会自动保存。',
          '等待或应用前选区被改动，会提示过期并拒绝覆盖。'
        ]
      },
      {
        kind: 'note',
        tone: 'warn',
        text: 'AI 结果必须自己检查；AI 未配置/未启用时不影响其他功能。'
      }
    ]
  },
  {
    id: 'limits',
    title: '边界与排错',
    icon: <AlertTriangle size={13} />,
    summary: '这些边界不是 bug，是当前静态/本地实现的范围。',
    blocks: [
      {
        kind: 'list',
        items: [
          '索引来自 jar 与 `kubejs/data`，脚本里 `event.*` 动态注册的配方不在导入搜索里。',
          '1.21+ 的 `id` 产物、NBT/组件、复杂嵌套机器 schema 可能回退自定义 JSON，需按模组文档补充。',
          '大网格小于 4×4 会补空位；超过 9×9 或原版 pattern 超过 3×3 会回退自定义 JSON。',
          '工作台保存的是脚本文件，不会替你启动游戏或热重载 KubeJS；改完需要按你的流程重载/重启。',
          '外部实例同样可写，操作前确认实例；备份不是版本控制，重要改动仍建议自己留底。'
        ]
      }
    ]
  },
  {
    id: 'shortcuts',
    title: '快捷键',
    icon: <Keyboard size={13} />,
    summary: 'Windows 下为 Ctrl；Esc 只关闭最上层弹窗。',
    blocks: [
      {
        kind: 'keys',
        items: [
          { keys: 'Ctrl+S', desc: '保存当前文件' },
          { keys: 'Ctrl+Shift+S', desc: '保存全部标签' },
          { keys: 'Ctrl+F', desc: '查找 / 替换' },
          { keys: 'Ctrl+G', desc: '跳转到行' },
          { keys: 'Ctrl+W', desc: '关闭当前标签' },
          { keys: 'Ctrl+Tab', desc: '切换标签' },
          { keys: 'F2', desc: '重命名 / 移动当前文件' },
          { keys: 'Esc', desc: '关闭最上层弹窗；不会关闭工作台' }
        ]
      }
    ]
  }
]

function RichText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g)
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('`') && part.endsWith('`') ? (
          <code key={index}>{part.slice(1, -1)}</code>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  )
}

function HelpBlockView({ block }: { block: HelpBlock }) {
  if (block.kind === 'text') {
    return (
      <p className="kjs-help-text">
        <RichText text={block.text} />
      </p>
    )
  }
  if (block.kind === 'subhead') {
    return <h4 className="kjs-help-subhead">{block.text}</h4>
  }
  if (block.kind === 'steps') {
    return (
      <ol className="kjs-help-steps">
        {block.items.map((item, index) => (
          <li key={index}>
            <em>{index + 1}</em>
            <span>
              <RichText text={item} />
            </span>
          </li>
        ))}
      </ol>
    )
  }
  if (block.kind === 'list') {
    return (
      <ul className="kjs-help-list">
        {block.items.map((item, index) => (
          <li key={index}>
            <RichText text={item} />
          </li>
        ))}
      </ul>
    )
  }
  if (block.kind === 'keys') {
    return (
      <div className="kjs-help-keys">
        {block.items.map((item) => (
          <div key={item.keys}>
            <kbd>{item.keys}</kbd>
            <span>{item.desc}</span>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className={`kjs-help-note ${block.tone === 'warn' ? 'is-warn' : ''}`}>
      {block.tone === 'warn' ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
      <span>
        <RichText text={block.text} />
      </span>
    </div>
  )
}

export function KubeJsHelpModal({
  open,
  onClose,
  instance,
  onOpenKnowledge
}: {
  open: boolean
  onClose: () => void
  instance: InstanceSummary | null
  onOpenKnowledge?: () => void
}) {
  const [activeId, setActiveId] = useState(SECTIONS[0].id)
  const contentRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    setActiveId(SECTIONS[0].id)
    const content = contentRef.current
    if (content) content.scrollTop = 0
  }, [open])

  const jumpTo = (id: string) => {
    const content = contentRef.current
    if (!content) return
    const section = content.querySelector<HTMLElement>(`[data-help-section="${id}"]`)
    if (!section) return
    content.scrollTo({ top: Math.max(0, section.offsetTop - 6), behavior: 'smooth' })
    setActiveId(id)
  }

  const handleScroll = () => {
    const content = contentRef.current
    if (!content) return
    if (content.scrollTop + content.clientHeight >= content.scrollHeight - 2) {
      setActiveId(SECTIONS[SECTIONS.length - 1].id)
      return
    }
    const top = content.getBoundingClientRect().top
    let current = SECTIONS[0].id
    for (const section of SECTIONS) {
      const element = content.querySelector<HTMLElement>(
        `[data-help-section="${section.id}"]`
      )
      if (element && element.getBoundingClientRect().top - top <= 20) {
        current = section.id
      }
    }
    setActiveId(current)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="KubeJS 工作台说明"
      subtitle={
        instance
          ? `${instance.name} · Minecraft ${instance.gameVersion} · 本地工作台`
          : '本地工作台'
      }
      icon={<BookOpen size={18} />}
      size="xl"
      footer={
        <div className="kjs-help-footer">
          <span>建议先建立索引，再试一次「从已有配方导入」。</span>
          <div>
            {onOpenKnowledge && (
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => {
                  onClose()
                  onOpenKnowledge()
                }}
              >
                去知识页
              </button>
            )}
            <button type="button" className="button button--primary button--sm" onClick={onClose}>
              开始使用
            </button>
          </div>
        </div>
      }
    >
      <div className="kjs-help">
        <div className="kjs-help-safety">
          <div>
            <ShieldCheck size={13} />
            <strong>本地优先</strong>
            <span>索引、释意、问题检查不联网；AI 只在点击时请求。</span>
          </div>
          <div>
            <Save size={13} />
            <strong>先备份再写盘</strong>
            <span>保存、删除、恢复历史前都会先备份原文件。</span>
          </div>
          <div>
            <MousePointerClick size={13} />
            <strong>不会自动保存</strong>
            <span>模板、配方、标签和 AI 结果都先进入编辑器，仍需自己保存。</span>
          </div>
        </div>
        <div className="kjs-help-layout">
          <nav className="kjs-help-nav" aria-label="说明目录">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={activeId === section.id ? 'is-active' : ''}
                onClick={() => jumpTo(section.id)}
              >
                {section.icon}
                <span>{section.title}</span>
              </button>
            ))}
          </nav>
          <div className="kjs-help-content" ref={contentRef} onScroll={handleScroll}>
            {SECTIONS.map((section) => (
              <section
                key={section.id}
                className="kjs-help-section"
                data-help-section={section.id}
              >
                <header>
                  <span className="kjs-help-section-icon">{section.icon}</span>
                  <div>
                    <h3>{section.title}</h3>
                    <p>{section.summary}</p>
                  </div>
                </header>
                {section.blocks.map((block, index) => (
                  <HelpBlockView key={index} block={block} />
                ))}
              </section>
            ))}
            <div className="kjs-help-end">
              <BookOpen size={13} />
              说明会随版本更新；遇到不确定的生成结果，先看「问题」页再保存。
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
