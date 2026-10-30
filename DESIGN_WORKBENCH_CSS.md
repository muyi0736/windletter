# 样式文件完整规范

**文件**：`src/renderer/src/styles/workbench.css`  
**大小**：约 2000+ 行  
**依赖**：`paper.css`（必须已导入）

---

## 1. 文件结构概览

```
workbench.css
├── 设计令牌定义（CSS variables）
├── 三栏布局容器（.workbench-layout）
├── 左栏样式（.left-panel）
│   ├── 账户卡片
│   ├── 快速启动卡片
│   └── Java 环境卡片
├── 中栏样式（.center-panel）
│   ├── 聚焦卡片改造（.focus-panel.workbench）
│   └── 表格视图（.library-table）
├── 右栏样式（.right-panel）
│   ├── 任务面板（.task-panel）
│   ├── 日志面板（.log-panel）
│   └── 系统状态（.status-panel）
├── 响应式规则（@media）
└── 动画定义（@keyframes）
```

---

## 2. 完整 CSS 代码

### 2.1 文件头和令牌定义

```css
/* ============================================================
   Workbench Layout — 游戏工作台三栏布局
   Version: 1.0
   Last Updated: 2026-10-24
   ============================================================ */

/* ────────── Design Tokens ────────── */
:root {
  /* 间距系统收紧 */
  --spacing-page: 20px 24px 22px;
  --spacing-section: 16px;
  --spacing-card: 14px;
  --spacing-row: 10px;

  /* 字号微调 */
  --text-xs: 9px;
  --text-sm: 10.5px;
  --text-base: 12px;
  --text-lg: 13.5px;

  /* 状态色 */
  --status-running: var(--accent);
  --status-preparing: var(--warning);
  --status-error: var(--danger);
  --status-idle: var(--text-3);
  --status-bar: 3px;

  /* 栏目宽度 */
  --left-panel-width: 280px;
  --right-panel-width: 320px;
  --right-panel-collapsed: 48px;
}
```

### 2.2 三栏布局容器

```css
/* ────────── Three Column Layout ────────── */
.workbench-layout {
  display: grid;
  grid-template-columns: 
    var(--left-panel-width) 
    1fr 
    var(--right-panel-width);
  gap: 18px;
  height: 100%;
  min-height: 0;
  padding: var(--spacing-page);
  overflow: hidden;
}

.workbench-layout.right-collapsed {
  grid-template-columns: 
    var(--left-panel-width) 
    1fr 
    var(--right-panel-collapsed);
}

/* 容器内的三个直接子元素 */
.workbench-layout > * {
  min-height: 0;  /* 允许内部滚动 */
  display: flex;
  flex-direction: column;
}
```

**说明**：
- `display: grid` 创建三列网格
- `1fr` 使中栏自适应填充剩余空间
- `min-height: 0` 是关键，使 flex 子元素可以正确溢出和滚动
- `gap: 18px` 定义列间距

### 2.3 左栏样式

```css
/* ────────── Left Panel ────────── */
.left-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-card);
  overflow-y: auto;
  padding-right: 6px;
}

/* 快捷卡片基础样式 */
.quick-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-card);
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;  /* 不被压缩 */
}

.quick-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.quick-card-title {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-3);
  font-weight: 500;
  margin: 0;
}

.quick-card-action {
  font-family: var(--font-mono);
  font-size: 8px;
  color: var(--text-3);
  text-decoration: none;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  transition: color 0.14s ease;
}

.quick-card-action:hover {
  color: var(--text);
  text-decoration: underline;
}

/* ──── 账户卡片 ──── */
.account-card {
  min-height: 80px;
}

.account-info {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.account-avatar {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  overflow: hidden;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 20px;
}

.account-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.account-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.account-name {
  font-size: 11.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  margin: 0;
}

.account-type {
  font-family: var(--font-mono);
  font-size: 8px;
  color: var(--text-3);
  margin-top: 4px;
  letter-spacing: 0.05em;
}

.account-actions {
  display: flex;
  gap: 6px;
}

.account-actions .button {
  flex: 1;
  height: 28px;
  font-size: 9.5px;
  padding: 0 8px;
}

/* ──── 快速启动卡片 ──── */
.quick-launch-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
  padding: 0;
}

.quick-launch-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background-color 0.14s ease;
  background: transparent;
  border: none;
  text-align: left;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}

.quick-launch-item:hover {
  background: color-mix(in srgb, var(--surface-2) 50%, transparent);
}

.quick-launch-item:last-child {
  border-bottom: 0;
}

.launch-item-title {
  font-size: 11.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  margin: 0;
}

.launch-item-meta {
  font-family: var(--font-mono);
  font-size: 8px;
  color: var(--text-3);
  margin-top: 3px;
  letter-spacing: 0.02em;
}

.quick-launch-empty {
  padding: 12px 0;
  font-size: 10px;
  color: var(--text-3);
  text-align: center;
  margin: 0;
}

.quick-launch-add {
  font-size: 9px;
  margin-top: 6px;
  text-decoration: none;
  color: var(--text-2);
}

.quick-launch-add:hover {
  color: var(--text);
  text-decoration: underline;
}

/* ──── Java 环境卡片 ──── */
.java-card {
  min-height: 140px;
}

.java-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.java-status-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.java-info {
  flex: 1;
  min-width: 0;
}

.java-version {
  font-size: 11.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  margin: 0;
}

.java-type {
  font-family: var(--font-mono);
  font-size: 8px;
  color: var(--text-3);
  margin-top: 2px;
  letter-spacing: 0.05em;
}

.java-path {
  background: var(--surface-2);
  border-radius: 4px;
  padding: 8px;
  margin: 10px 0;
  font-family: var(--font-mono);
  font-size: 8px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.java-memory {
  font-size: 10px;
  margin-bottom: 10px;
}

.java-memory-label {
  color: var(--text-3);
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
  display: block;
}

.java-memory-bar {
  background: var(--surface-2);
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  margin: 4px 0;
}

.java-memory-fill {
  background: var(--accent);
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.java-actions {
  display: flex;
  gap: 6px;
}

.java-actions .button {
  flex: 1;
  height: 28px;
  font-size: 9.5px;
  padding: 0 8px;
}
```

### 2.4 中栏样式

```css
/* ────────── Center Panel ────────── */
.center-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  padding-right: 6px;
}

/* ──── 聚焦卡片改造 ──── */
.focus-panel.workbench {
  border-left: var(--status-bar) solid var(--accent);
  min-height: 360px;
  position: relative;
}

.focus-panel.workbench.status-preparing {
  border-left-color: var(--status-preparing);
}

.focus-panel.workbench.status-running {
  border-left-color: var(--status-running);
  animation: pulse-status 2s ease-in-out infinite;
}

.focus-panel.workbench.status-error {
  border-left-color: var(--status-error);
}

@keyframes pulse-status {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.focus-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--accent-soft);
  color: var(--accent-ink);
  padding: 6px 12px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transition: all 0.14s ease;
}

.focus-status-badge::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  display: inline-block;
  flex-shrink: 0;
}

.focus-status-badge.preparing {
  background: var(--warning-soft);
  color: var(--warning-ink);
}

.focus-status-badge.preparing::before {
  background: var(--warning);
}

.focus-status-badge.running {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.focus-status-badge.running::before {
  background: var(--accent);
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% {
    box-shadow: 0 0 0 0 currentColor;
  }
  50% {
    box-shadow: 0 0 0 3px rgba(255,255,255,0.2);
  }
}

.focus-status-badge.error {
  background: var(--danger-soft);
  color: var(--danger-ink);
}

.focus-status-badge.error::before {
  background: var(--danger);
}

/* ──── 表格视图 ──── */
.library-table {
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-collapse: collapse;
}

.table-head {
  display: grid;
  grid-template-columns: 48px 1fr 100px 100px 100px 80px;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-strong);
  background: var(--surface-2);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-3);
  position: sticky;
  top: 0;
  z-index: 10;
  flex-shrink: 0;
}

.table-head-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
  transition: color 0.14s ease;
  padding: 0;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  color: inherit;
}

.table-head-cell:hover {
  color: var(--text);
}

.table-head-cell.sortable::after {
  content: '⟳';
  font-size: 9px;
  opacity: 0.4;
  transition: opacity 0.2s ease, transform 0.2s ease;
  margin-left: auto;
}

.table-head-cell.sortable:hover::after {
  opacity: 0.8;
}

.table-head-cell.sortable.desc::after {
  transform: scaleY(-1) rotate(180deg);
}

.table-body {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex: 1;
}

.table-row {
  display: grid;
  grid-template-columns: 48px 1fr 100px 100px 100px 80px;
  gap: 12px;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  height: 40px;
  cursor: pointer;
  transition: background-color 0.14s ease;
  background: transparent;
}

.table-row:hover {
  background: color-mix(in srgb, var(--surface-2) 50%, transparent);
}

.table-row.selected {
  background: var(--accent-soft);
  border-left: var(--status-bar) solid var(--accent);
  padding-left: calc(16px - var(--status-bar));
}

.table-cell-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  overflow: hidden;
  color: var(--text-2);
  font-size: 16px;
  flex-shrink: 0;
}

.table-cell-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.table-cell-name {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.table-cell-name-main {
  font-size: 11.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  margin: 0;
}

.table-cell-name-sub {
  font-family: var(--font-mono);
  font-size: 8px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.02em;
  margin: 0;
}

.table-cell-meta {
  font-family: var(--font-mono);
  font-size: 8px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.table-cell-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  overflow: hidden;
}

.table-cell-actions .icon-button {
  width: 28px;
  height: 28px;
  font-size: 14px;
  flex-shrink: 0;
}
```

### 2.5 右栏样式

```css
/* ────────── Right Panel ────────── */
.right-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding-left: 6px;
  transition: width 0.2s ease;
  position: relative;
}

.right-panel.collapsed {
  width: var(--right-panel-collapsed);
  align-items: center;
}

.right-panel.collapsed > *:not(.right-panel-toggle) {
  display: none;
}

.right-panel-toggle {
  width: 32px;
  height: 32px;
  border-radius: 5px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-3);
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 14px;
}

.right-panel-toggle:hover {
  background: var(--surface-2);
  color: var(--text);
}

.right-panel.collapsed .right-panel-toggle {
  position: static;
  margin-top: auto;
}

/* ──── 任务面板 ──── */
.task-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-card);
  flex-shrink: 0;
}

.task-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 12px;
}

.task-panel-title {
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-3);
  margin: 0;
}

.task-count-badge {
  background: var(--text);
  color: var(--bg);
  border-radius: 3px;
  padding: 3px 8px;
  font-family: var(--font-mono);
  font-size: 7px;
  font-weight: 600;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
}

.task-item {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  background: var(--surface-2);
}

.task-item-title {
  font-size: 10.5px;
  font-weight: 600;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
}

.task-item-icon {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  font-size: 12px;
  flex-shrink: 0;
}

.task-item-progress {
  margin-bottom: 6px;
}

.task-item-progress-bar {
  height: 3px;
  background: var(--surface-3);
  border-radius: 1px;
  overflow: hidden;
  margin-bottom: 4px;
}

.task-item-progress-fill {
  background: var(--accent);
  height: 100%;
  border-radius: 1px;
  transition: width 0.3s ease;
}

.task-item-progress-text {
  font-family: var(--font-mono);
  font-size: 7.5px;
  color: var(--text-3);
  letter-spacing: 0.02em;
}

.task-empty {
  padding: 20px 0;
  text-align: center;
  font-size: 10px;
  color: var(--text-3);
  margin: 0;
}

.task-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

.task-actions .button {
  flex: 1;
  height: 26px;
  font-size: 9px;
  padding: 0 8px;
}

/* ──── 日志面板 ──── */
.log-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-card);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.log-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 10px;
}

.log-panel-title {
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-3);
  margin: 0;
}

.log-copy-button {
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  padding: 4px;
  transition: color 0.14s ease;
  font-size: 14px;
}

.log-copy-button:hover {
  color: var(--text);
}

.log-panel-preview {
  font-family: var(--font-mono);
  font-size: 8px;
  line-height: 1.5;
  color: var(--text-3);
  height: 180px;
  overflow-y: auto;
  background: var(--surface-2);
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 8px;
  white-space: pre-wrap;
  word-break: break-word;
}

.log-line {
  margin: 0;
  padding: 0;
}

.log-panel-actions {
  display: flex;
  gap: 6px;
}

.log-panel-actions .button {
  flex: 1;
  height: 26px;
  font-size: 9px;
  padding: 0 8px;
}

/* ──── 系统状态面板 ──── */
.status-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-card);
  flex-shrink: 0;
}

.status-item {
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-item:last-child {
  border-bottom: 0;
}

.status-label {
  font-family: var(--font-mono);
  font-size: 8px;
  color: var(--text-3);
  letter-spacing: 0.05em;
  flex: 1;
}

.status-value {
  font-weight: 600;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 9px;
  text-align: right;
}
```

### 2.6 响应式规则

```css
/* ────────── Responsive Design ────────── */

/* 中等视口：1280px 向下 */
@media (max-width: 1280px) {
  :root {
    --left-panel-width: 240px;
    --right-panel-width: 280px;
  }

  .workbench-layout {
    gap: 16px;
    padding: 18px 20px;
  }

  .left-panel {
    gap: var(--spacing-card);
  }

  .center-panel {
    gap: 16px;
  }

  .table-head {
    grid-template-columns: 40px 1fr 90px 90px 90px 70px;
    gap: 10px;
    padding: 8px 14px;
    font-size: 7.5px;
  }

  .table-row {
    grid-template-columns: 40px 1fr 90px 90px 90px 70px;
    gap: 10px;
    padding: 8px 14px;
    height: 36px;
  }

  .table-cell-icon {
    width: 32px;
    height: 32px;
  }
}

/* 小视口：< 960px，左右栏隐藏 */
@media (max-width: 960px) {
  .workbench-layout {
    grid-template-columns: 1fr;
    gap: 16px;
    padding: 16px 18px;
  }

  .left-panel,
  .right-panel {
    display: none !important;
  }

  .center-panel {
    overflow-y: auto;
    padding-right: 0;
    gap: 14px;
  }

  .focus-panel.workbench {
    min-height: auto;
  }

  .library-table {
    max-height: calc(100vh - 400px);
  }
}

/* 极小视口：< 600px，移动优化 */
@media (max-width: 600px) {
  :root {
    --spacing-page: 12px 16px;
  }

  .workbench-layout {
    padding: var(--spacing-page);
    gap: 12px;
  }

  .center-panel {
    gap: 12px;
  }

  .table-head {
    font-size: 7px;
    padding: 6px 10px;
  }

  .table-row {
    padding: 6px 10px;
    height: 32px;
  }

  .table-cell-name-main {
    font-size: 10px;
  }

  .table-cell-name-sub {
    font-size: 7px;
  }

  /* 简化表格，隐藏部分列 */
  .table-head {
    grid-template-columns: 40px 1fr 60px;
  }

  .table-row {
    grid-template-columns: 40px 1fr 60px;
  }

  /* 隐藏对应的单元格 */
  .table-cell-name-sub {
    display: none;
  }

  .table-cell-meta:nth-child(4),
  .table-cell-meta:nth-child(5) {
    display: none;
  }
}
```

---

## 3. 导入说明

在 `src/renderer/src/App.tsx` 中添加：

```typescript
import '../styles/workbench.css'
```

**导入顺序**（重要）：
```typescript
// 1. 全局样式
import '../styles/base.css'
import '../styles/paper.css'

// 2. 工作台样式（依赖 paper.css）
import '../styles/workbench.css'

// 3. 组件和页面样式
import '../styles/components.css'
import '../styles/pages.css'
```

---

## 4. 类名规范

### 4.1 命名约定

```
.workbench-* ........... 工作台相关
.left-panel ............ 左栏容器
.center-panel .......... 中栏容器
.right-panel ........... 右栏容器
.quick-card ............ 左栏卡片
.quick-launch-* ....... 快速启动相关
.java-* ............... Java 环境相关
.library-table ......... 表格容器
.table-* .............. 表格相关
.task-panel ........... 任务面板
.task-* ............... 任务相关
.log-panel ............ 日志面板
.log-* ................ 日志相关
.status-panel ......... 状态面板
.status-* ............. 状态相关
```

### 4.2 状态类

```
.selected ............. 选中状态
.collapsed ............ 折叠状态
.running .............. 运行中
.preparing ............ 准备中
.error ................ 错误状态
```

---

## 5. 性能优化建议

### 5.1 渲染优化

1. **表格虚拟滚动**
   - 当版本数 > 50 时，使用虚拟滚动库（如 react-window）
   - 只渲染可见的行

2. **日志截断**
   - 日志预览只保存最近 50 行
   - 完整日志用独立窗口

3. **媒体查询优化**
   - 使用 `prefers-reduced-motion` 禁用动画
   - 低端设备上简化阴影和模糊效果

### 5.2 打包优化

CSS 文件大小预期：**~20-30KB**（未压缩）

可用 cssnano 等工具进行生产环境压缩。

---

## 6. 常见问题

**Q: 三栏布局在什么时候会出现水平滚动条？**  
A: 不会。通过 `min-width: 0` 和 flex 布局，保证内容总是自适应，不会溢出。

**Q: 表格行为什么是 40px 高度？**  
A: 40px 是标准的 Web UI 高度，提供足够的点击区域（最小 48px），同时保持信息密度。

**Q: 右栏折叠后能展开吗？**  
A: 能。点击折叠按钮或者用快捷键都可以切换。

**Q: CSS 需要兼容旧浏览器吗？**  
A: 不需要。项目使用 Electron 和现代 CSS（Grid、Flex、CSS Variables），无需兼容 IE11。

---

**下一步**：查看 `DESIGN_WORKBENCH_COMPONENTS.md` 了解组件代码。
