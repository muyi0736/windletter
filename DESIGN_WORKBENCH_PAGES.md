# HomePage 页面改造指南

**文档用途**：详细说明如何改造现有的 HomePage 使用三栏布局

---

## 目录

- [1. 当前结构分析](#1-当前结构分析)
- [2. 改造概览](#2-改造概览)
- [3. 状态管理改动](#3-状态管理改动)
- [4. JSX 结构改造](#4-jsx-结构改造)
- [5. 事件处理改造](#5-事件处理改造)
- [6. 删除的代码](#6-删除的代码)
- [7. 新增的代码](#7-新增的代码)

---

## 1. 当前结构分析

### 1.1 现有布局树

```
HomePage()
├── header (.home-header)
│   ├── 标题和说明
│   └── 快速操作按钮（实例、安装版本）
├── home-stage (.home-stage)
│   ├── focus-panel（焦点卡片）
│   │   ├── focus-top
│   │   ├── focus-identity
│   │   ├── focus-facts
│   │   ├── launch-cta
│   │   └── launch-error / launch-hint
│   └── home-rail （右侧资料栏）
│       ├── 账户信息
│       ├── 最新版本
│       └── 快捷链接
└── library-section (库列表)
    ├── library-head
    ├── 实例列表（library-group）
    └── 版本列表（library-group）
```

### 1.2 当前代码行数

- 文件总行数：~670 行
- 状态定义：~80 行
- 计算 memo：~40 行
- 事件处理：~200 行
- JSX 渲染：~350 行

### 1.3 移除的部分

以下代码在新版本中不再需要：

- `.home-header`（顶部标题栏，改为集成到中栏）
- `.home-rail`（右侧资料栏，功能分散到左栏和右栏）
- `.library-section`、`.library-group`（改为表格 + 网格）

---

## 2. 改造概览

### 2.1 核心改动

| 方面 | 现状 | 改造后 |
|------|------|--------|
| 页面布局 | 流式（垂直滚动） | 三栏固定（水平分布） |
| 快速操作入口 | 页面顶部 | 左栏（账户、Java、快速启动） |
| 焦点卡片 | 与资料栏并列 | 单独占据中栏上部 |
| 版本显示 | 网格布局、网格行 | 表格视图、表格行 |
| 实例显示 | 网格布局 | 网格布局（保留） |
| 任务队列 | 浮窗（TaskDock） | 右栏面板（紧集成） |
| 日志预览 | 完全无 | 右栏面板（新增） |
| Java 状态 | 焦点卡片内部 | 左栏卡片（新增） |

### 2.2 文件变更大纲

```diff
src/renderer/src/pages/HomePage.tsx

- import { 移除部分图标 }
+ import { 新增图标 }

- 删除旧的计算 memo（home-rail 相关）
+ 新增计算 memo（recentLaunches、viewMode 相关）

- 删除旧的 return (顶部 header + home-stage + library-section)
+ 新增 return (workbench-layout 三栏结构)
```

---

## 3. 状态管理改动

### 3.1 新增局部状态

```typescript
// 右栏折叠状态
const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
  // 从 localStorage 读取上次设置
  return localStorage.getItem('right-panel-collapsed') === 'true'
})

// 视图模式（表格 / 网格）
const [viewMode, setViewMode] = useState<'grid' | 'table'>('table')

// 排序字段
const [sortBy, setSortBy] = useState<'name' | 'date'>('date')

// 排序方向
const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
```

### 3.2 删除的 memo

以下已有的 memo 可以删除或修改：

```typescript
// 删除：latestEntry 相关（资料栏特有）
- const latest = manifest?.latest.release ?? null
- const latestInstalled = latest ? installed.some((version) => version.id === latest) : false
- const latestEntry = manifest?.versions.find((version) => version.id === latest) ?? null
- const latestTask = latest
-   ? tasks.find((task) => task.kind === 'install' && task.versionId === latest && task.status === 'running')
-   : undefined

// 保留：orderedInstalled（仍然需要）
const orderedInstalled = useMemo(
  () =>
    [...visibleInstalled].sort((a, b) => {
      if (a.id === selectedId) return -1
      if (b.id === selectedId) return 1
      return (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)
    }),
  [visibleInstalled, selectedId]
)

// 新增：快速启动列表
const recentLaunches = useMemo(() => {
  const all: (InstanceSummary | LauncherVersion)[] = [
    ...instances.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)),
    ...visibleInstalled.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
  ]
  return all.slice(0, 5)
}, [instances, visibleInstalled])
```

### 3.3 新增计算值

```typescript
// 快速启动列表已有（上面的 memo）

// 不需要额外计算，但需要存储右栏折叠状态的变化
const handleToggleRightPanel = () => {
  const newState = !rightPanelCollapsed
  setRightPanelCollapsed(newState)
  localStorage.setItem('right-panel-collapsed', String(newState))
}
```

---

## 4. JSX 结构改造

### 4.1 新的顶级结构

```typescript
return (
  <div className="workbench-layout">
    {/* 左栏 */}
    <LeftPanel { ...leftPanelProps } />
    
    {/* 中栏 */}
    <div className="center-panel">
      {/* 焦点卡片 */}
      <section className="focus-panel workbench">
        {/* 改造后的焦点卡片内容 */}
      </section>
      
      {/* 版本表格 */}
      <LibraryTable { ...tableProps } />
      
      {/* 实例卡片网格 */}
      {instances.length > 0 && (
        <div>
          {/* 实例卡片，保留原有网格布局 */}
        </div>
      )}
    </div>
    
    {/* 右栏 */}
    <RightPanel { ...rightPanelProps } />
    
    {/* 模态和确认框 */}
    <ConfirmDialog { ...confirmProps } />
  </div>
)
```

### 4.2 焦点卡片改造

**原有结构**：
```jsx
<section className="focus-panel">
  <div className="focus-top">
    <span className="mono-label">Current target</span>
    <span className={`focus-status ${running ? 'is-live' : launchBusy || installTask ? 'is-busy' : ''}`}>
      {targetStatus}
    </span>
  </div>
  {/* ... 其他内容 */}
</section>
```

**改造后**：
```jsx
<section className={`focus-panel workbench ${statusClass}`}>
  <div className="focus-top">
    <div className="focus-status-badge" style={{ cursor: 'pointer' }} onClick={chooseTarget}>
      <span>{statusText}</span>
    </div>
    <div style={{ display: 'flex', gap: '8px' }}>
      <button className="icon-button" onClick={() => setPage('settings')} title="设置">
        <Settings size={14} />
      </button>
      <button className="icon-button" onClick={openFolder} title="打开目录">
        <FolderOpen size={14} />
      </button>
    </div>
  </div>
  {/* 其他内容保持不变 */}
</section>
```

**关键改动**：
- 移除 `mono-label` 的「Current target」文本
- 用徽章代替原有的小标签
- 快捷操作按钮从隐藏变为始终可见
- 添加 `.workbench` 类和状态类用于 CSS 的左侧色条

### 4.3 版本列表改造

**原有**：
```jsx
<div className="library-group">
  <div className="library-group-head">
    <span>版本 / Versions</span>
    <span>{orderedInstalled.length.toString().padStart(2, '0')}</span>
  </div>
  <div className="library-list">
    {orderedInstalled.map((version) => (
      <article className="library-row" onClick={() => selectVersion(version.id)}>
        {/* 网格行布局 */}
      </article>
    ))}
  </div>
</div>
```

**改造后**：
```jsx
<div>
  <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
    <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
      已安装版本 ({visibleInstalled.length})
    </h3>
    <div style={{ display: 'flex', gap: '8px' }}>
      <button className="button button--soft button--sm" onClick={() => void refreshInstalled()}>
        <RefreshCw size={12} />
        刷新
      </button>
      <button className="button button--soft button--sm" onClick={() => setPage('downloads')}>
        <Plus size={12} />
        安装
      </button>
    </div>
  </div>

  {visibleInstalled.length > 0 ? (
    <LibraryTable
      versions={visibleInstalled}
      selectedId={selectedId}
      onSelect={selectVersion}
      onLaunch={(id) => { /* ... */ }}
      onDelete={(id) => { /* ... */ }}
      sortBy={sortBy}
      sortOrder={sortOrder}
      onSort={() => setSortBy(prev => prev === 'date' ? 'name' : 'date')}
    />
  ) : (
    <EmptyState 
      message="还没有安装版本。"
      action="前往下载中心"
      onAction={() => setPage('downloads')}
    />
  )}
</div>
```

**关键改动**：
- 用组件 `<LibraryTable>` 替代 `library-list` 网格
- 头部改为 flex 布局，标题和操作按钮并排
- 添加「刷新」和「安装」快捷按钮

### 4.4 实例列表保留

```jsx
{instances.length > 0 && (
  <div>
    <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 12px 0' }}>
      我的整合包 ({instances.length})
    </h3>
    <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
      {instances.map((instance) => (
        <div key={instance.id} className="instance-card" /* ... */>
          {/* 保留原有的实例卡片代码 */}
        </div>
      ))}
    </div>
  </div>
)}
```

**说明**：实例部分基本保留，只是改为直接渲染，不用 `library-group` 包装。

---

## 5. 事件处理改造

### 5.1 新增的事件处理器

```typescript
// 右栏折叠切换
const handleToggleRightPanel = () => {
  const newState = !rightPanelCollapsed
  setRightPanelCollapsed(newState)
  localStorage.setItem('right-panel-collapsed', String(newState))
}

// 快速启动项目
const handleQuickLaunch = (item: InstanceSummary | LauncherVersion) => {
  if (!account) {
    setAccountModalOpen(true)
    return
  }
  if (launchActive) {
    toast('info', '已有游戏正在运行', '请先结束当前进程')
    return
  }
  
  const isInstance = 'gameVersion' in item
  if (isInstance) {
    selectInstance(item.id)
    void startInstance(item.id)
  } else {
    selectVersion(item.id)
    void startLaunch(item.id)
  }
}

// 排序字段切换
const handleSort = (field: 'name' | 'date') => {
  if (field === sortBy) {
    setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
  } else {
    setSortBy(field)
    setSortOrder('desc')
  }
}

// 版本删除
const handleDeleteVersion = (versionId: string) => {
  if (confirm(`确定删除 Minecraft ${versionId}?`)) {
    // TODO: 实现删除逻辑
    toast('info', '版本删除功能即将推出')
  }
}
```

### 5.2 修改的事件处理器

```typescript
// handleLaunch - 保持不变，已经很完善

// handleStop - 保持不变

// openFolder - 保持不变

// 删除：handleQuickPlay, handleQuickInstance（合并为 handleQuickLaunch）
// 删除：handleLatestAction（资料栏特有）
// 删除：chooseTarget（改为 onClick 内联）
```

---

## 6. 删除的代码

### 6.1 删除的 JSX 部分

```jsx
// ❌ 删除：顶部标题栏
<header className="home-header">
  <div className="home-header-copy">
    <span className="eyebrow">Workspace / 启动</span>
    <h1>{greeting()}{account ? `，${account.name}` : '，旅人'}</h1>
    <p>从原版到整合包，今天想进入哪个世界？
      <span className="home-header-stats">{instances.length} 实例 · {visibleInstalled.length} 版本</span>
    </p>
  </div>
  <div className="home-header-actions">
    <button type="button" className="button button--soft" onClick={() => setPage('instances')}>
      <Boxes size={14} />
      实例
    </button>
    <button type="button" className="button button--primary" onClick={() => setPage('downloads')}>
      <Plus size={14} />
      安装版本
    </button>
  </div>
</header>

// ❌ 删除：右侧资料栏
<aside className="home-rail">
  <section className="rail-block">
    {/* 账户信息 */}
  </section>
  <section className="rail-block">
    {/* 最新版本 */}
  </section>
  <section className="rail-block rail-links">
    {/* 快捷链接 */}
  </section>
</aside>

// ❌ 删除：底部库列表容器
<section className="library-section">
  <div className="library-head">
    {/* ... */}
  </div>
  <div className="library-group">
    {/* 实例组 */}
  </div>
  <div className="library-group">
    {/* 版本组 */}
  </div>
</section>
```

### 6.2 删除的函数

```typescript
// ❌ 删除：handleQuickPlay（版本快速启动，合并到 handleQuickLaunch）
const handleQuickPlay = (versionId: string) => { /* ... */ }

// ❌ 删除：handleQuickInstance（实例快速启动，合并到 handleQuickLaunch）
const handleQuickInstance = (instance: InstanceSummary) => { /* ... */ }

// ❌ 删除：handleLatestAction（最新版本操作，资料栏特有）
const handleLatestAction = () => { /* ... */ }
```

### 6.3 删除的 memo

```typescript
// ❌ 删除：latest、latestInstalled、latestEntry、latestTask（资料栏特有）
const latest = manifest?.latest.release ?? null
const latestInstalled = latest ? installed.some((version) => version.id === latest) : false
const latestEntry = manifest?.versions.find((version) => version.id === latest) ?? null
const latestTask = latest
  ? tasks.find((task) => task.kind === 'install' && task.versionId === latest && task.status === 'running')
  : undefined
```

---

## 7. 新增的代码

### 7.1 导入新组件

```typescript
import { LeftPanel } from '../components/LeftPanel'
import { RightPanel } from '../components/RightPanel'
import { LibraryTable } from '../components/LibraryTable'
```

### 7.2 新增导入图标

```typescript
import { Settings, ChevronLeft, ChevronRight } from 'lucide-react'
// 其他已有的图标保留
```

### 7.3 新增状态初始化

```typescript
const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
  return localStorage.getItem('right-panel-collapsed') === 'true'
})
const [sortBy, setSortBy] = useState<'name' | 'date'>('date')
const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
```

### 7.4 新增 memo

```typescript
const recentLaunches = useMemo(() => {
  const all: (InstanceSummary | LauncherVersion)[] = [
    ...instances.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)),
    ...visibleInstalled.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
  ]
  return all.slice(0, 5)
}, [instances, visibleInstalled])
```

### 7.5 新增事件处理函数

见第 5 节「事件处理改造」的所有「新增」部分。

---

## 8. 折叠/展开状态管理

### 8.1 本地存储

```typescript
// 读取
const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
  return localStorage.getItem('right-panel-collapsed') === 'true'
})

// 写入
const handleToggleCollapse = () => {
  const newState = !rightPanelCollapsed
  setRightPanelCollapsed(newState)
  localStorage.setItem('right-panel-collapsed', String(newState))
}
```

### 8.2 或者存储到 store

如果要统一管理，可以扩展 store：

```typescript
// 在 store.ts 中添加
interface LauncherState {
  rightPanelCollapsed: boolean
  setRightPanelCollapsed: (collapsed: boolean) => void
  // ...其他状态
}

// 实现
setRightPanelCollapsed: (collapsed) => {
  set({ rightPanelCollapsed: collapsed })
  localStorage.setItem('right-panel-collapsed', String(collapsed))
}
```

---

## 9. 迁移检查清单

- [ ] 导入新组件（LeftPanel、RightPanel、LibraryTable）
- [ ] 添加新的导入图标（Settings、ChevronLeft 等）
- [ ] 添加新的状态变量（rightPanelCollapsed、sortBy、sortOrder）
- [ ] 添加新的 memo（recentLaunches）
- [ ] 添加新的事件处理函数
- [ ] 删除旧的 header 和 home-rail JSX
- [ ] 删除旧的事件处理函数（handleQuickPlay 等）
- [ ] 将 return 改为三栏布局
- [ ] 验证所有组件的 props 传递正确
- [ ] 运行 TypeScript 检查：`npm run typecheck`
- [ ] 运行测试：`npm run dev`
- [ ] 测试所有功能（启动、删除、排序等）

---

**下一步**：查看 `DESIGN_WORKBENCH_IMPLEMENTATION.md` 了解实现步骤。
