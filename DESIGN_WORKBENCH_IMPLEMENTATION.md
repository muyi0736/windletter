# 实现步骤和检查清单

**文档用途**：提供分阶段实现指南、测试方法和常见问题解决方案

---

## 目录

- [1. 准备工作](#1-准备工作)
- [2. 第一阶段：核心体验](#2-第一阶段核心体验)
- [3. 第二阶段：效率提升](#3-第二阶段效率提升)
- [4. 第三阶段：锦上添花](#4-第三阶段锦上添花)
- [5. 测试清单](#5-测试清单)
- [6. 常见问题](#6-常见问题)
- [7. 性能优化](#7-性能优化)
- [8. 后续维护](#8-后续维护)

---

## 1. 准备工作

### 1.1 环境检查

```bash
# 确保依赖已安装
npm ci

# 确保类型检查通过
npm run typecheck

# 确保当前可以正常运行
npm run dev
```

### 1.2 创建分支

```bash
# 创建功能分支
git checkout -b feature/workbench-layout

# 或者创建实验分支
git checkout -b experiment/workbench-ui
```

### 1.3 备份关键文件

```bash
# 备份 HomePage.tsx
cp src/renderer/src/pages/HomePage.tsx src/renderer/src/pages/HomePage.tsx.backup

# 备份 paper.css
cp src/renderer/src/styles/paper.css src/renderer/src/styles/paper.css.backup
```

---

## 2. 第一阶段：核心体验

**目标**：实现三栏布局，所有基础功能可用  
**预计时间**：1-2 天

### Step 1: 创建 CSS 文件（30 分钟）

**操作**：
1. 创建 `src/renderer/src/styles/workbench.css`
2. 复制 `DESIGN_WORKBENCH_CSS.md` 中的完整 CSS 代码
3. 在 `App.tsx` 导入：

```typescript
// src/renderer/src/App.tsx
import './styles/base.css'
import './styles/paper.css'
import './styles/workbench.css'  // ← 新增
import './styles/components.css'
import './styles/pages.css'
```

**验证**：
```bash
npm run dev
# 启动后打开浏览器开发者工具
# 检查 workbench.css 是否被加载
# 检查是否有 CSS 错误
```

**可能的问题**：
- CSS 变量未定义 → 检查 paper.css 是否在 workbench.css 之前导入
- 样式不生效 → 检查文件路径是否正确

---

### Step 2: 创建 LeftPanel 组件（1 小时）

**操作**：
1. 创建 `src/renderer/src/components/LeftPanel.tsx`
2. 复制 `DESIGN_WORKBENCH_COMPONENTS.md` 中的完整代码
3. 检查所有导入是否正确

**验证**：
```bash
npm run typecheck
# 应该无类型错误
```

**可能的问题**：
- `Avatar` 组件找不到 → 检查是否从 `./visuals` 正确导入
- `formatMemory` 未定义 → 检查是否从 `../lib/format` 导入
- `JavaInfo` 类型缺少 `memory` 字段 → 需要扩展类型定义

**类型扩展**（如果需要）：
```typescript
// src/shared/types.ts
export interface JavaInfo {
  path: string
  version: string
  major: number
  source: 'system' | 'mojang'
  memory: number          // ← 新增
  totalMemory: number     // ← 新增
}
```

---

### Step 3: 创建 RightPanel 组件（1 小时）

**操作**：
1. 创建 `src/renderer/src/components/RightPanel.tsx`
2. 复制代码并检查导入

**验证**：
```bash
npm run typecheck
```

**可能的问题**：
- `TaskState` 类型不完整 → 检查 `@shared/types.ts` 中的定义
- `formatMemory` 未导入 → 添加到 `../lib/format`

---

### Step 4: 创建 LibraryTable 组件（1 小时）

**操作**：
1. 创建 `src/renderer/src/components/LibraryTable.tsx`
2. 复制代码并检查导入

**验证**：
```bash
npm run typecheck
```

**可能的问题**：
- `versionTypeLabel` 未定义 → 检查 `../lib/format` 是否导出
- 表格排序逻辑错误 → 测试时验证

---

### Step 5: 改造 HomePage（2-3 小时）

**操作**：
1. 打开 `src/renderer/src/pages/HomePage.tsx`
2. 按照 `DESIGN_WORKBENCH_PAGES.md` 的指引逐步修改：
   - 添加导入
   - 添加新状态
   - 添加新 memo
   - 删除旧代码
   - 替换 return JSX

**详细步骤**：

#### 5.1 添加导入
```typescript
import { LeftPanel } from '../components/LeftPanel'
import { RightPanel } from '../components/RightPanel'
import { LibraryTable } from '../components/LibraryTable'
import { Settings } from 'lucide-react'
```

#### 5.2 添加状态
```typescript
const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
  return localStorage.getItem('right-panel-collapsed') === 'true'
})
const [sortBy, setSortBy] = useState<'name' | 'date'>('date')
const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
```

#### 5.3 添加 recentLaunches memo
```typescript
const recentLaunches = useMemo(() => {
  const all: (InstanceSummary | LauncherVersion)[] = [
    ...instances.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)),
    ...visibleInstalled.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
  ]
  return all.slice(0, 5)
}, [instances, visibleInstalled])
```

#### 5.4 删除旧 memo
```typescript
// 删除以下变量（Ctrl+F 搜索并删除）
- const latest = ...
- const latestInstalled = ...
- const latestEntry = ...
- const latestTask = ...
```

#### 5.5 添加事件处理
```typescript
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

const handleSort = (field: 'name' | 'date') => {
  if (field === sortBy) {
    setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
  } else {
    setSortBy(field)
    setSortOrder('desc')
  }
}
```

#### 5.6 替换 return
找到 `return (` 语句，**完全替换**为三栏布局（见 `DESIGN_WORKBENCH_PAGES.md` 第 4 节）

**验证**：
```bash
npm run typecheck
# 修复所有类型错误

npm run dev
# 启动后检查页面是否正常显示
```

---

### Step 6: 第一次测试（30 分钟）

**测试清单**：
- [ ] 页面能正常启动，无白屏
- [ ] 三栏正确显示（左 280px、中自适应、右 320px）
- [ ] 左栏显示账户信息
- [ ] 中栏显示焦点卡片和版本表格
- [ ] 右栏显示任务队列和日志预览
- [ ] 点击版本行可以选中（高亮）
- [ ] 点击启动按钮可以启动游戏
- [ ] 右栏可以折叠和展开

**如果出现问题**：
1. 打开浏览器开发者工具（F12）
2. 查看 Console 是否有错误
3. 查看 Elements 面板，检查 DOM 结构
4. 查看 Network 面板，检查 CSS 是否加载

---

### Step 7: 修复问题和调整（1-2 小时）

**常见问题及解决方案**：

#### 问题 1: 三栏宽度不对
**现象**：左栏或右栏太宽/太窄  
**原因**：CSS 变量未生效  
**解决**：
```css
/* 检查 workbench.css 是否正确定义 */
:root {
  --left-panel-width: 280px;
  --right-panel-width: 320px;
}
```

#### 问题 2: 表格不显示
**现象**：版本表格是空白的  
**原因**：`visibleInstalled` 为空或组件渲染错误  
**解决**：
```typescript
// 检查 visibleInstalled 是否有数据
console.log('visibleInstalled', visibleInstalled)

// 检查 LibraryTable 组件是否正确渲染
// 添加临时调试代码
{visibleInstalled.length > 0 ? (
  <>
    <p>有 {visibleInstalled.length} 个版本</p>
    <LibraryTable ... />
  </>
) : (
  <p>无版本</p>
)}
```

#### 问题 3: 右栏折叠不工作
**现象**：点击折叠按钮没反应  
**原因**：事件未绑定或 CSS 类名错误  
**解决**：
```typescript
// 检查 onClick 是否正确绑定
<button onClick={onToggleCollapse}> // ← 确认这个 prop 传递了

// 检查 CSS 类名
.right-panel.collapsed {
  width: var(--right-panel-collapsed);
}
```

#### 问题 4: Java 环境卡片显示错误
**现象**：「未检测到 Java」，但实际有 Java  
**原因**：`javaList` 为空或 `selectedJavaMajor` 不匹配  
**解决**：
```typescript
// 检查 javaList 数据
console.log('javaList', javaList)
console.log('selectedJavaMajor', selectedJavaMajor)

// 临时 mock 数据测试
const mockJava: JavaInfo = {
  path: 'C:\\Program Files\\Java\\jdk-21',
  version: '21.0.1',
  major: 21,
  source: 'system',
  memory: 2048,
  totalMemory: 16384
}
```

---

### 第一阶段完成标志

- [x] CSS 文件创建并加载
- [x] 三个新组件创建完成
- [x] HomePage 改造完成
- [x] 无 TypeScript 错误
- [x] 页面可以正常显示
- [x] 基本功能可用（选择、启动、折叠）

**提交代码**：
```bash
git add .
git commit -m "feat: 实现游戏工作台三栏布局（第一阶段）

- 创建 workbench.css 样式文件
- 新增 LeftPanel、RightPanel、LibraryTable 组件
- 改造 HomePage 使用三栏布局
- 基础功能已验证可用
"
```

---

## 3. 第二阶段：效率提升

**目标**：完善交互，提升操作效率  
**预计时间**：1-2 天

### Step 8: 实现右键菜单（2-3 小时）

**功能**：在表格行上右键显示菜单

**方案 A：使用原生菜单**（推荐）
```typescript
// 在 LibraryTable 组件中
import { Menu } from 'electron'

const handleContextMenu = (e: React.MouseEvent, version: LauncherVersion) => {
  e.preventDefault()
  
  const menu = window.ccl.app.showContextMenu([
    { label: '启动', click: () => onLaunch(version.id) },
    { label: '打开目录', click: () => openFolder(version.id) },
    { type: 'separator' },
    { label: '复制版本号', click: () => navigator.clipboard.writeText(version.id) },
    { label: '导出配置', click: () => exportConfig(version.id) },
    { type: 'separator' },
    { label: '删除', click: () => onDelete(version.id), danger: true }
  ])
}

// 绑定到表格行
<div 
  className="table-row"
  onContextMenu={(e) => handleContextMenu(e, version)}
>
```

**方案 B：自定义 CSS 菜单**
```typescript
// 创建 ContextMenu 组件
// src/renderer/src/components/ContextMenu.tsx
// （见完整实现代码...略）
```

**验证**：
- [ ] 右键表格行显示菜单
- [ ] 菜单项点击正确执行操作
- [ ] 点击外部关闭菜单

---

### Step 9: 实现高级筛选（1-2 小时）

**功能**：按游戏版本、加载器筛选

**实现**：
```typescript
// 添加状态
const [filters, setFilters] = useState({
  gameVersion: 'all' as 'all' | '1.21.x' | '1.20.x' | '1.12.x',
  loader: 'all' as 'all' | 'fabric' | 'forge' | 'quilt' | 'vanilla'
})

// 过滤逻辑
const filteredVersions = useMemo(() => {
  return visibleInstalled.filter((v) => {
    // 游戏版本筛选
    if (filters.gameVersion !== 'all') {
      const match = v.id.match(/(\d+)\.(\d+)/)
      if (match) {
        const major = parseInt(match[1])
        const minor = parseInt(match[2])
        if (filters.gameVersion === '1.21.x' && !(major === 1 && minor === 21)) return false
        if (filters.gameVersion === '1.20.x' && !(major === 1 && minor === 20)) return false
        if (filters.gameVersion === '1.12.x' && !(major === 1 && minor === 12)) return false
      }
    }
    
    // 加载器筛选
    if (filters.loader !== 'all') {
      if (filters.loader === 'vanilla' && v.loader !== null) return false
      if (filters.loader !== 'vanilla' && v.loader !== filters.loader) return false
    }
    
    return true
  })
}, [visibleInstalled, filters])

// UI 渲染
<div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
  <select 
    value={filters.gameVersion}
    onChange={(e) => setFilters({ ...filters, gameVersion: e.target.value })}
  >
    <option value="all">所有版本</option>
    <option value="1.21.x">1.21.x</option>
    <option value="1.20.x">1.20.x</option>
    <option value="1.12.x">1.12.x</option>
  </select>
  
  <select 
    value={filters.loader}
    onChange={(e) => setFilters({ ...filters, loader: e.target.value })}
  >
    <option value="all">所有加载器</option>
    <option value="vanilla">原版</option>
    <option value="fabric">Fabric</option>
    <option value="forge">Forge</option>
    <option value="quilt">Quilt</option>
  </select>
</div>
```

**验证**：
- [ ] 筛选器改变时表格实时更新
- [ ] 筛选条件可以叠加
- [ ] 清空筛选器恢复全部显示

---

### Step 10: 实现快捷键系统（2-3 小时）

**功能**：键盘快捷操作

**实现**：
```typescript
// 创建 src/renderer/src/lib/shortcuts.ts
export function useShortcuts(handlers: {
  onLaunch?: () => void
  onInstances?: () => void
  onDownloads?: () => void
  onSettings?: () => void
  onConsole?: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+L: 启动游戏
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault()
        handlers.onLaunch?.()
      }
      
      // Ctrl+I: 实例页面
      if (e.ctrlKey && e.key === 'i') {
        e.preventDefault()
        handlers.onInstances?.()
      }
      
      // Ctrl+D: 下载页面
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault()
        handlers.onDownloads?.()
      }
      
      // Ctrl+,: 设置页面
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        handlers.onSettings?.()
      }
      
      // Ctrl+`: 日志控制台
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        handlers.onConsole?.()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handlers])
}

// 在 HomePage 中使用
useShortcuts({
  onLaunch: handleLaunch,
  onInstances: () => setPage('instances'),
  onDownloads: () => setPage('downloads'),
  onSettings: () => setPage('settings'),
  onConsole: () => openConsole('launch')
})
```

**验证**：
- [ ] Ctrl+L 启动游戏
- [ ] Ctrl+I 跳转实例页
- [ ] Ctrl+D 跳转下载页
- [ ] Ctrl+, 跳转设置页
- [ ] Ctrl+` 打开控制台

---

### 第二阶段完成标志

- [x] 右键菜单实现
- [x] 高级筛选实现
- [x] 快捷键系统实现
- [x] 所有功能测试通过

**提交代码**：
```bash
git add .
git commit -m "feat: 添加效率提升功能（第二阶段）

- 实现表格行右键菜单
- 添加版本和加载器筛选器
- 实现全局快捷键系统
"
```

---

## 4. 第三阶段：锦上添花

**目标**：高级功能和优化  
**预计时间**：1 天

### Step 11: Modrinth 快速预览（1-2 小时）

略（可选功能）

### Step 12: 实时系统状态（1 小时）

**功能**：在右栏显示实时磁盘空间和下载速度

**实现**：
```typescript
// 主进程新增 IPC handler
// src/main/index.ts
ipcMain.handle('system:disk-space', async () => {
  const os = require('os')
  const path = require('path')
  
  // 获取数据目录所在盘符的空间
  const dataDir = getDataDir()
  // ... 计算逻辑
  
  return {
    used: usedBytes,
    total: totalBytes
  }
})

// 渲染进程定时获取
useEffect(() => {
  const fetchDiskSpace = async () => {
    const space = await window.ccl.system.diskSpace()
    setDiskSpace(space)
  }
  
  fetchDiskSpace()
  const interval = setInterval(fetchDiskSpace, 30000) // 每 30 秒
  
  return () => clearInterval(interval)
}, [])
```

---

### Step 13: 响应式优化（1-2 小时）

**测试不同分辨率**：
- 1920x1080（全高清）
- 1366x768（笔记本常见）
- 1280x720（最小推荐）

**调整断点**（如果需要）：
```css
@media (max-width: 1280px) {
  /* 调整栏宽 */
}

@media (max-width: 960px) {
  /* 隐藏左右栏 */
}
```

---

### 第三阶段完成标志

- [x] 所有高级功能实现
- [x] 响应式测试通过
- [x] 性能优化完成

**提交代码**：
```bash
git add .
git commit -m "feat: 添加高级功能和优化（第三阶段）

- 实现 Modrinth 快速预览
- 添加实时系统状态监控
- 优化响应式表现
"
```

---

## 5. 测试清单

### 5.1 功能测试

```
[ ] 布局测试
  [ ] 三栏正确显示
  [ ] 左栏宽度 280px
  [ ] 右栏宽度 320px
  [ ] 中栏自适应
  [ ] 右栏可折叠到 48px

[ ] 左栏测试
  [ ] 账户卡片显示正确
  [ ] 切换账户功能正常
  [ ] 快速启动列表显示最近项目
  [ ] 快速启动可以点击启动
  [ ] Java 环境卡片显示正确
  [ ] Java 内存进度条正常

[ ] 中栏测试
  [ ] 焦点卡片显示当前选中项
  [ ] 状态徽章正确显示
  [ ] 启动按钮功能正常
  [ ] 版本表格显示所有版本
  [ ] 表格排序功能正常
  [ ] 表格选中高亮正常
  [ ] 实例卡片网格显示正常

[ ] 右栏测试
  [ ] 任务队列显示正在运行的任务
  [ ] 任务进度条实时更新
  [ ] 日志预览显示最新日志
  [ ] 复制日志功能正常
  [ ] 展开控制台功能正常
  [ ] 系统状态显示正确

[ ] 交互测试
  [ ] 版本表格行可以点击选中
  [ ] 启动按钮启动游戏
  [ ] 右键菜单显示和操作
  [ ] 快捷键功能正常
  [ ] 筛选器实时过滤

[ ] 响应式测试
  [ ] 1920x1080 显示正常
  [ ] 1366x768 显示正常
  [ ] 1280x720 显示正常
  [ ] 960px 以下左右栏隐藏
```

### 5.2 性能测试

```
[ ] 加载性能
  [ ] 首次渲染 < 1 秒
  [ ] 页面切换流畅

[ ] 表格性能
  [ ] 100 个版本渲染 < 500ms
  [ ] 排序操作 < 100ms
  [ ] 滚动流畅无卡顿

[ ] 内存占用
  [ ] 空闲状态 < 200MB
  [ ] 游戏运行时 < 300MB
```

### 5.3 兼容性测试

```
[ ] 主题测试
  [ ] 浅色模式正常
  [ ] 深色模式正常
  [ ] 青碧主题色正常
  [ ] 潮蓝主题色正常
  [ ] 森绿主题色正常
  [ ] 暖橙主题色正常

[ ] 浏览器测试
  [ ] Chrome 正常
  [ ] Edge 正常
```

---

## 6. 常见问题

### Q1: 三栏布局在小屏幕上显示不全

**现象**：1280px 以下，内容被截断  
**原因**：媒体查询未生效  
**解决**：
```css
@media (max-width: 1280px) {
  :root {
    --left-panel-width: 240px;
    --right-panel-width: 280px;
  }
}
```

### Q2: 表格排序后选中状态丢失

**现象**：点击排序后，之前选中的行不再高亮  
**原因**：`selectedId` 未保持  
**解决**：排序不应改变选中状态，检查 `selectedId` 是否正确传递给 `LibraryTable`

### Q3: 右栏折叠后无法展开

**现象**：点击按钮后右栏消失，再点击无反应  
**原因**：CSS 选择器错误或状态未更新  
**解决**：
```typescript
// 检查状态更新
const handleToggle = () => {
  console.log('before', rightPanelCollapsed)
  setRightPanelCollapsed(!rightPanelCollapsed)
  console.log('after', !rightPanelCollapsed)
}

// 检查 CSS
.right-panel.collapsed .right-panel-toggle {
  display: flex;  // 确保按钮始终显示
}
```

### Q4: Java 内存显示 NaN%

**现象**：进度条宽度为 0 或 NaN  
**原因**：`totalMemory` 为 0 或未定义  
**解决**：
```typescript
const javaMemoryPercent = selectedJava
  ? Math.round((selectedJava.memory / Math.max(selectedJava.totalMemory, 1)) * 100)
  : 0

// 或者添加防御性检查
if (!selectedJava.totalMemory) {
  selectedJava.totalMemory = selectedJava.memory * 8 // 假设总内存是使用的 8 倍
}
```

### Q5: 快速启动列表显示错误的项目

**现象**：显示的不是最近启动的  
**原因**：排序逻辑错误  
**解决**：
```typescript
const recentLaunches = useMemo(() => {
  const all = [
    ...instances.map(i => ({ ...i, lastPlayed: i.lastPlayed ?? 0 })),
    ...visibleInstalled.map(v => ({ ...v, lastPlayed: v.lastPlayed ?? 0 }))
  ]
  return all.sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 5)
}, [instances, visibleInstalled])
```

### Q6: 右键菜单位置不对

**现象**：菜单显示在屏幕外或位置偏移  
**原因**：坐标计算错误  
**解决**：使用原生菜单（方案 A）或计算边界：
```typescript
const showMenu = (e: React.MouseEvent) => {
  const x = e.clientX
  const y = e.clientY
  const menuWidth = 200
  const menuHeight = 150
  
  // 防止超出视口
  const adjustedX = Math.min(x, window.innerWidth - menuWidth)
  const adjustedY = Math.min(y, window.innerHeight - menuHeight)
  
  setMenuPosition({ x: adjustedX, y: adjustedY })
}
```

---

## 7. 性能优化

### 7.1 表格虚拟滚动（可选）

当版本数 > 100 时，使用虚拟滚动：

```bash
npm install react-window
```

```typescript
import { FixedSizeList } from 'react-window'

<FixedSizeList
  height={600}
  itemCount={versions.length}
  itemSize={40}
  width="100%"
>
  {({ index, style }) => (
    <div style={style} className="table-row">
      {/* 渲染版本行 */}
    </div>
  )}
</FixedSizeList>
```

### 7.2 减少重渲染

```typescript
// 使用 React.memo 包装组件
export const LeftPanel = React.memo(function LeftPanel(props: LeftPanelProps) {
  // ...
})

// 使用 useCallback 缓存回调
const handleLaunch = useCallback((id: string) => {
  // ...
}, [account, launchActive])
```

### 7.3 延迟加载

```typescript
// 右栏日志预览使用防抖
import { useMemo } from 'react'
import debounce from 'lodash/debounce'

const debouncedLogs = useMemo(
  () => debounce((logs) => setDisplayLogs(logs), 100),
  []
)
```

---

## 8. 后续维护

### 8.1 版本兼容

- 确保新版本保持向后兼容
- localStorage 的 key 不要随意更改
- 如果 CSS 类名变化，提供迁移指南

### 8.2 文档更新

- 更新 README.md 提到新布局
- 更新 HANDOFF.md 记录新组件
- 截图更新为新界面

### 8.3 用户反馈

收集用户反馈后可能需要调整：
- 左栏宽度
- 字号大小
- 颜色对比度
- 表格列宽

---

## 9. 回滚方案

如果需要回滚到原版：

```bash
# 方案 1：使用备份
cp src/renderer/src/pages/HomePage.tsx.backup src/renderer/src/pages/HomePage.tsx
cp src/renderer/src/styles/paper.css.backup src/renderer/src/styles/paper.css

# 删除新文件
rm src/renderer/src/components/LeftPanel.tsx
rm src/renderer/src/components/RightPanel.tsx
rm src/renderer/src/components/LibraryTable.tsx
rm src/renderer/src/styles/workbench.css

# 还原 App.tsx 的导入
# 手动删除 import '../styles/workbench.css'

# 方案 2：使用 Git
git checkout main -- src/renderer/src/pages/HomePage.tsx
git clean -fd src/renderer/src/components/
git clean -fd src/renderer/src/styles/
```

---

## 10. 完成检查

最终验收清单：

```
[ ] 所有功能正常工作
[ ] 无 TypeScript 错误
[ ] 无 ESLint 警告（如果配置了）
[ ] 无 Console 错误
[ ] 所有测试用例通过
[ ] 性能符合预期
[ ] 响应式表现良好
[ ] 代码已提交到 Git
[ ] 文档已更新
[ ] 团队成员已 review
```

**合并到主分支**：
```bash
git checkout main
git merge feature/workbench-layout
git push origin main
```

---

**恭喜！游戏工作台设计方案实现完成！🎉**
