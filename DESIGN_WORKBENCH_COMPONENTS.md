# 组件代码详细说明

**文档用途**：定义所有新增组件的完整代码、Props 接口和使用方法

---

## 目录

- [1. LeftPanel 组件](#1-leftpanel-组件)
- [2. RightPanel 组件](#2-rightpanel-组件)
- [3. LibraryTable 组件](#3-librarytable-组件)
- [4. 辅助组件](#4-辅助组件)

---

## 1. LeftPanel 组件

### 1.1 文件位置

`src/renderer/src/components/LeftPanel.tsx`

### 1.2 Props 接口

```typescript
import type { AccountInfo, InstanceSummary, LauncherVersion, JavaInfo } from '@shared/types'

interface LeftPanelProps {
  // 账户相关
  account: AccountInfo | null
  accounts: AccountInfo[]
  onAccountSwitch: (id: string) => void
  onAccountManage: () => void
  onAddAccount: () => void
  
  // 快速启动相关
  recentInstances: (InstanceSummary | LauncherVersion)[]
  onLaunchRecent: (id: string, isInstance: boolean) => void
  
  // Java 相关
  javaList: JavaInfo[]
  selectedJavaMajor: number | null
  onJavaManage: () => void
  onJavaDetect: () => void
}
```

### 1.3 完整代码

```typescript
import { ChevronRight, Coffee } from 'lucide-react'
import type { AccountInfo, InstanceSummary, LauncherVersion, JavaInfo } from '@shared/types'
import { Avatar, BlockIcon } from './visuals'
import { relativeTime, formatMemory } from '../lib/format'

function isInstance(item: InstanceSummary | LauncherVersion): item is InstanceSummary {
  return 'gameVersion' in item
}

function instanceIcon(instance: InstanceSummary | LauncherVersion): React.ReactNode {
  if (isInstance(instance)) {
    return instance.iconUrl ? (
      <img src={instance.iconUrl} alt="" loading="lazy" />
    ) : (
      <BlockIcon />
    )
  }
  return '📦'
}

function getRecentLabel(item: InstanceSummary | LauncherVersion): string {
  if (isInstance(item)) {
    return `${item.gameVersion} · ${item.modCount} mods`
  }
  return `Minecraft ${item.id}`
}

export function LeftPanel({
  account,
  accounts,
  onAccountSwitch,
  onAccountManage,
  onAddAccount,
  recentInstances,
  onLaunchRecent,
  javaList,
  selectedJavaMajor,
  onJavaManage,
  onJavaDetect
}: LeftPanelProps) {
  const selectedJava = javaList.find((j) => selectedJavaMajor && j.major === selectedJavaMajor) || javaList[0]
  const javaMemoryPercent = selectedJava
    ? Math.round((selectedJava.memory / (selectedJava.totalMemory || 1)) * 100)
    : 0

  return (
    <div className="left-panel">
      {/* 账户卡片 */}
      <div className="quick-card account-card">
        <div className="quick-card-head">
          <span className="quick-card-title">当前账户</span>
        </div>

        {account ? (
          <>
            <div className="account-info">
              <div className="account-avatar">
                <Avatar account={account} />
              </div>
              <div className="account-details">
                <div className="account-name">{account.name}</div>
                <div className="account-type">
                  {account.type === 'offline' ? '离线账户' : '微软账户'}
                </div>
              </div>
            </div>
            <div className="account-actions">
              {accounts.length > 1 && (
                <button
                  type="button"
                  className="button button--soft button--sm"
                  onClick={() => onAccountSwitch(account.id)}
                >
                  切换
                </button>
              )}
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={onAccountManage}
              >
                管理
              </button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-3)', marginBottom: '8px' }}>
              未添加账户
            </div>
            <button
              type="button"
              className="button button--primary button--sm"
              onClick={onAddAccount}
              style={{ width: '100%' }}
            >
              + 添加账户
            </button>
          </div>
        )}
      </div>

      {/* 快速启动卡片 */}
      <div className="quick-card">
        <div className="quick-card-head">
          <span className="quick-card-title">快速启动</span>
        </div>

        {recentInstances.length > 0 ? (
          <div className="quick-launch-list">
            {recentInstances.slice(0, 3).map((item) => {
              const isInst = isInstance(item)
              const label = 'name' in item ? item.name : `Minecraft ${item.id}`
              return (
                <button
                  key={`${isInst ? 'inst' : 'ver'}-${item.id}`}
                  type="button"
                  className="quick-launch-item"
                  onClick={() => onLaunchRecent(item.id, isInst)}
                >
                  <div className="launch-item-title">{label}</div>
                  <div className="launch-item-meta">{getRecentLabel(item)}</div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="quick-launch-empty">最近无启动记录</div>
        )}

        <button
          type="button"
          className="link-button quick-launch-add"
        >
          + 固定一个版本
        </button>
      </div>

      {/* Java 环境卡片 */}
      <div className="quick-card java-card">
        <div className="quick-card-head">
          <span className="quick-card-title">Java 环境</span>
        </div>

        {selectedJava ? (
          <>
            <div className="java-status">
              <div className="java-status-icon">☕</div>
              <div className="java-info">
                <div className="java-version">Java {selectedJava.major}</div>
                <div className="java-type">
                  {selectedJava.source === 'system' ? '系统 Java' : 'Mojang 运行时'}
                </div>
              </div>
            </div>

            {selectedJavaMajor && selectedJavaMajor !== selectedJava.major && (
              <div
                style={{
                  fontSize: '9px',
                  color: 'var(--warning-ink)',
                  background: 'var(--warning-soft)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  marginBottom: '8px'
                }}
              >
                ⚠ 需要 Java {selectedJavaMajor}
              </div>
            )}

            <div className="java-path">{selectedJava.path}</div>

            <div className="java-memory">
              <span className="java-memory-label">内存使用</span>
              <div className="java-memory-bar">
                <div
                  className="java-memory-fill"
                  style={{ width: `${javaMemoryPercent}%` }}
                />
              </div>
              <span className="java-memory-label" style={{ marginTop: '4px' }}>
                {formatMemory(selectedJava.memory)} / {formatMemory(selectedJava.totalMemory)}
              </span>
            </div>

            <div className="java-actions">
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={onJavaDetect}
              >
                检测
              </button>
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={onJavaManage}
              >
                管理
              </button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-3)', marginBottom: '12px' }}>
              未检测到 Java
            </div>
            <button
              type="button"
              className="button button--primary button--sm"
              onClick={onJavaDetect}
              style={{ width: '100%' }}
            >
              检测 Java
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

### 1.4 使用示例

```typescript
// 在 HomePage 中使用
import { LeftPanel } from '../components/LeftPanel'

function HomePage() {
  const account = useLauncher((state) => state.accounts.accounts.find((a) => a.id === state.accounts.activeId))
  const javaList = useLauncher((state) => state.javaList)
  // ... 其他 state

  const recentLaunches = useMemo(() => {
    const all = [
      ...instances.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)),
      ...visibleInstalled.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
    ]
    return all.slice(0, 5)
  }, [instances, visibleInstalled])

  return (
    <div className="workbench-layout">
      <LeftPanel
        account={account ?? null}
        accounts={accounts.accounts}
        onAccountSwitch={() => setAccountModalOpen(true)}
        onAccountManage={() => setAccountModalOpen(true)}
        onAddAccount={() => setAccountModalOpen(true)}
        recentInstances={recentLaunches}
        onLaunchRecent={(id, isInstance) => {
          if (isInstance) {
            selectInstance(id)
            void startInstance(id)
          } else {
            selectVersion(id)
            void startLaunch(id)
          }
        }}
        javaList={javaList}
        selectedJavaMajor={targetJavaMajor}
        onJavaManage={() => setPage('settings')}
        onJavaDetect={() => refreshInstalled()}
      />
      {/* 中栏和右栏 */}
    </div>
  )
}
```

---

## 2. RightPanel 组件

### 2.1 文件位置

`src/renderer/src/components/RightPanel.tsx`

### 2.2 Props 接口

```typescript
import type { TaskState } from '@shared/types'

interface RightPanelProps {
  // 折叠状态
  isCollapsed: boolean
  onToggleCollapse: () => void
  
  // 任务队列
  tasks: TaskState[]
  
  // 日志预览
  onOpenConsole: () => void
  onCopyLog: () => void
  logLines: string[]
  
  // 系统状态
  diskSpace: { used: number; total: number }
  downloadSpeed: number
  connectionCount: number
}
```

### 2.3 完整代码

```typescript
import { ChevronLeft, ChevronRight, Copy, Maximize2 } from 'lucide-react'
import type { TaskState } from '@shared/types'
import { formatMemory } from '../lib/format'

function getTaskIcon(kind: TaskState['kind']): string {
  switch (kind) {
    case 'install':
      return '⬇'
    case 'java':
      return '☕'
    case 'modpack':
      return '📦'
    default:
      return '⏳'
  }
}

function getTaskTitle(task: TaskState): string {
  switch (task.kind) {
    case 'install':
      return `正在安装 Minecraft ${task.versionId}`
    case 'java':
      return `正在下载 Java ${task.javaMajor ?? ''}`
    case 'modpack':
      return `正在导入整合包`
    default:
      return '后台任务'
  }
}

export function RightPanel({
  isCollapsed,
  onToggleCollapse,
  tasks,
  onOpenConsole,
  onCopyLog,
  logLines,
  diskSpace,
  downloadSpeed,
  connectionCount
}: RightPanelProps) {
  const activeTasks = tasks.filter((t) => t.status === 'running')

  return (
    <div className={`right-panel ${isCollapsed ? 'collapsed' : ''}`}>
      {!isCollapsed && (
        <>
          {/* 任务面板 */}
          <div className="task-panel">
            <div className="task-panel-head">
              <span className="task-panel-title">后台任务</span>
              <div className="task-count-badge">{activeTasks.length}</div>
            </div>

            {activeTasks.length > 0 ? (
              <div className="task-list">
                {activeTasks.slice(0, 3).map((task, idx) => (
                  <div key={`${task.id}-${idx}`} className="task-item">
                    <div className="task-item-title">
                      <span className="task-item-icon">{getTaskIcon(task.kind)}</span>
                      <span>{getTaskTitle(task)}</span>
                    </div>
                    <div className="task-item-progress">
                      <div className="task-item-progress-bar">
                        <div
                          className="task-item-progress-fill"
                          style={{ width: `${Math.max(task.progress || 0, 4)}%` }}
                        />
                      </div>
                      <div className="task-item-progress-text">
                        {task.stage || '准备中'} · {Math.round(task.progress || 0)}%
                      </div>
                    </div>
                  </div>
                ))}
                {activeTasks.length > 3 && (
                  <div
                    style={{
                      fontSize: '9px',
                      color: 'var(--text-3)',
                      textAlign: 'center',
                      marginTop: '6px'
                    }}
                  >
                    +{activeTasks.length - 3} 个任务
                  </div>
                )}
              </div>
            ) : (
              <div className="task-empty">当前无后台任务</div>
            )}

            {activeTasks.length > 0 && (
              <div className="task-actions">
                <button type="button" className="button button--soft button--sm">
                  暂停全部
                </button>
                <button type="button" className="button button--soft button--sm">
                  清空
                </button>
              </div>
            )}
          </div>

          {/* 日志面板 */}
          <div className="log-panel">
            <div className="log-panel-head">
              <span className="log-panel-title">游戏日志</span>
              <button
                type="button"
                className="log-copy-button"
                onClick={onCopyLog}
                title="复制日志"
              >
                <Copy size={12} />
              </button>
            </div>

            <div className="log-panel-preview">
              {logLines.length > 0 ? (
                logLines.slice(-20).map((line, idx) => (
                  <div key={idx} className="log-line">
                    {line}
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--text-3)' }}>等待游戏启动...</div>
              )}
            </div>

            <div className="log-panel-actions">
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={onOpenConsole}
              >
                <Maximize2 size={12} />
                展开控制台
              </button>
            </div>
          </div>

          {/* 系统状态 */}
          <div className="status-panel">
            <div className="status-item">
              <span className="status-label">磁盘空间</span>
              <span className="status-value">
                {formatMemory(diskSpace.used)} / {formatMemory(diskSpace.total)}
              </span>
            </div>
            {downloadSpeed > 0 && (
              <div className="status-item">
                <span className="status-label">下载速度</span>
                <span className="status-value">{formatMemory(downloadSpeed)}/s</span>
              </div>
            )}
            {connectionCount > 0 && (
              <div className="status-item">
                <span className="status-label">活动连接</span>
                <span className="status-value">{connectionCount}</span>
              </div>
            )}
          </div>
        </>
      )}

      <button
        type="button"
        className="right-panel-toggle"
        onClick={onToggleCollapse}
        title={isCollapsed ? '展开' : '折叠'}
      >
        {isCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>
    </div>
  )
}
```

### 2.4 使用示例

```typescript
import { RightPanel } from '../components/RightPanel'

function HomePage() {
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
    return localStorage.getItem('right-panel-collapsed') === 'true'
  })

  const handleToggleCollapse = () => {
    const newState = !rightPanelCollapsed
    setRightPanelCollapsed(newState)
    localStorage.setItem('right-panel-collapsed', String(newState))
  }

  return (
    <div className="workbench-layout">
      {/* 左栏和中栏 */}
      <RightPanel
        isCollapsed={rightPanelCollapsed}
        onToggleCollapse={handleToggleCollapse}
        tasks={tasks}
        onOpenConsole={() => openConsole('launch')}
        onCopyLog={() => {
          const text = launch.logs.join('\n')
          void navigator.clipboard.writeText(text).then(() => {
            toast('success', '已复制到剪贴板')
          })
        }}
        logLines={launch.logs}
        diskSpace={{ used: 42300, total: 512000 }}  // 实际从主进程获取
        downloadSpeed={0}
        connectionCount={0}
      />
    </div>
  )
}
```

---

## 3. LibraryTable 组件

### 3.1 文件位置

`src/renderer/src/components/LibraryTable.tsx`

### 3.2 Props 接口

```typescript
import type { LauncherVersion } from '@shared/types'

interface LibraryTableProps {
  // 数据
  versions: LauncherVersion[]
  selectedId?: string
  
  // 事件
  onSelect: (id: string) => void
  onLaunch: (id: string) => void
  onDelete: (id: string) => void
  onSettings?: (id: string) => void
  
  // 排序
  sortBy?: 'name' | 'date'
  sortOrder?: 'asc' | 'desc'
  onSort?: (field: 'name' | 'date') => void
}
```

### 3.3 完整代码

```typescript
import { Play, Trash2, Settings } from 'lucide-react'
import type { LauncherVersion } from '@shared/types'
import { formatDate, versionTypeLabel } from '../lib/format'

export function LibraryTable({
  versions,
  selectedId,
  onSelect,
  onLaunch,
  onDelete,
  onSettings,
  sortBy = 'date',
  sortOrder = 'desc',
  onSort
}: LibraryTableProps) {
  const handleHeaderClick = (field: 'name' | 'date') => {
    if (onSort) {
      onSort(field)
    }
  }

  const sortedVersions = [...versions].sort((a, b) => {
    let comparison = 0
    if (sortBy === 'date') {
      comparison = (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)
    } else {
      comparison = a.id.localeCompare(b.id)
    }
    return sortOrder === 'desc' ? comparison : -comparison
  })

  return (
    <div className="library-table">
      <div className="table-head">
        <div className="table-head-cell">图标</div>
        <button
          type="button"
          className={`table-head-cell sortable ${sortBy === 'name' ? sortOrder : ''}`}
          onClick={() => handleHeaderClick('name')}
        >
          版本
        </button>
        <div className="table-head-cell">类型</div>
        <button
          type="button"
          className={`table-head-cell sortable ${sortBy === 'date' ? sortOrder : ''}`}
          onClick={() => handleHeaderClick('date')}
        >
          发布日期
        </button>
        <div className="table-head-cell">最后启动</div>
        <div className="table-head-cell">操作</div>
      </div>

      <div className="table-body">
        {sortedVersions.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
            暂无版本
          </div>
        ) : (
          sortedVersions.map((version) => (
            <div
              key={version.id}
              className={`table-row ${selectedId === version.id ? 'selected' : ''}`}
              onClick={() => onSelect(version.id)}
            >
              <div className="table-cell-icon">📦</div>

              <div className="table-cell-name">
                <div className="table-cell-name-main">{version.id}</div>
                <div className="table-cell-name-sub">{version.inheritsFrom || '原版'}</div>
              </div>

              <div className="table-cell-meta">{versionTypeLabel(version.type)}</div>

              <div className="table-cell-meta">
                {version.releaseTime ? formatDate(version.releaseTime) : '—'}
              </div>

              <div className="table-cell-meta">
                {version.lastPlayed ? formatDate(version.lastPlayed) : '未启动'}
              </div>

              <div className="table-cell-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onLaunch(version.id)}
                  title="启动"
                >
                  <Play size={14} />
                </button>
                {onSettings && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onSettings(version.id)}
                    title="设置"
                  >
                    <Settings size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  onClick={() => {
                    if (confirm(`确定删除 Minecraft ${version.id}?`)) {
                      onDelete(version.id)
                    }
                  }}
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

### 3.4 使用示例

```typescript
import { LibraryTable } from '../components/LibraryTable'

function HomePage() {
  const [sortBy, setSortBy] = useState<'name' | 'date'>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const handleSort = (field: 'name' | 'date') => {
    if (field === sortBy) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  return (
    <div className="center-panel">
      {/* 焦点卡片 */}
      <LibraryTable
        versions={visibleInstalled}
        selectedId={selectedId}
        onSelect={selectVersion}
        onLaunch={(id) => {
          if (!account) {
            setAccountModalOpen(true)
            return
          }
          selectVersion(id)
          void startLaunch(id)
        }}
        onDelete={(id) => {
          // TODO: 实现删除
          toast('info', '版本删除功能即将推出')
        }}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
      />
    </div>
  )
}
```

---

## 4. 辅助组件

### 4.1 EmptyState 组件（可选）

```typescript
interface EmptyStateProps {
  message: string
  action?: string
  onAction?: () => void
}

export function EmptyState({ message, action, onAction }: EmptyStateProps) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '40px',
        background: 'var(--surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        color: 'var(--text-3)'
      }}
    >
      {message}
      {action && onAction && (
        <>
          <br />
          <button
            type="button"
            className="link-button"
            onClick={onAction}
            style={{ marginTop: '8px' }}
          >
            {action}
          </button>
        </>
      )}
    </div>
  )
}
```

### 4.2 LoadingSpinner 组件（可选）

```typescript
export function LoadingSpinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
```

---

## 5. 类型扩展

如果需要扩展 `@shared/types.ts` 中的类型，添加以下内容：

```typescript
// 视图模式类型
export type ViewMode = 'grid' | 'table'

// 排序方向类型
export type SortOrder = 'asc' | 'desc'

// 排序字段类型
export type SortField = 'name' | 'date'

// 右栏面板状态
export interface RightPanelState {
  collapsed: boolean
  activeTab?: 'tasks' | 'logs' | 'status'
}
```

---

## 6. 常见问题

**Q1: 为什么 LeftPanel 要同时接受 InstanceSummary 和 LauncherVersion？**  
A: 快速启动列表需要显示最近启动的实例和版本，它们是不同的类型，使用联合类型处理。

**Q2: Java 环境卡片的 totalMemory 从哪来？**  
A: 从主进程的 `java.ts::detectJava()` 获取，需要扩展 JavaInfo 类型包含 `totalMemory` 字段。

**Q3: 表格排序为什么不用服务端排序？**  
A: 版本数据已经全部加载到内存，客户端排序更快。如果版本数超过 1000，再考虑服务端分页。

**Q4: 右栏折叠状态保存在哪里？**  
A: localStorage，key 为 `right-panel-collapsed`。也可以保存到 store 的 settings 中。

**Q5: 组件之间怎么通信？**  
A: 通过 props 传递回调函数，所有状态由 HomePage 统一管理（状态提升）。

---

**下一步**：查看 `DESIGN_WORKBENCH_PAGES.md` 了解 HomePage 改造细节。
