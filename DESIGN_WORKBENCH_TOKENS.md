# 设计令牌完整规范

**文档用途**：定义所有设计系统中的常数值和规则

---

## 1. 间距系统

### 1.1 页面/容器级间距

```
当前（paper.css）         →  新版本（workbench）
─────────────────────────────────────────
页面内边距：              
  22px 28px 24px         →  20px 24px 22px
  （上下左右）              （上下左右）

页面间距比例：
  上：22px  →  20px (-2px)
  右：28px  →  24px (-4px)
  下：24px  →  22px (-2px)
  左：28px  →  24px (-4px)
```

**理由**：减少页面外边距，增加内容区域，提高信息密度。

### 1.2 区块级间距

```
区块间距：    18px → 16px (-2px)
卡片内边距：  16px → 14px (-2px)
卡片间距：    16px → 14px (-2px)
行项间距：    12px → 10px (-2px)
```

**应用场景**：
- 区块间距：两个 `.library-group` 或两个主区块之间
- 卡片内边距：`.quick-card`、`.task-panel` 等卡片内部的填充
- 卡片间距：左栏中相邻卡片之间
- 行项间距：列表项、表格行之间

### 1.3 组件内间距

```
左栏卡片间距布局：
  ┌─ quick-card ─────┐
  │ head: 10px (下)  │
  │ ─────────────────│
  │ body: 12px gap   │
  │                  │
  └──────────────────┘
  next card: 14px (上方)

表格行间距：
  行高固定 40px
  内部左右 padding 16px
  列间距 12px
```

---

## 2. 字号系统

### 2.1 字号定义

```
当前 paper.css    →  新版本
──────────────────────────
超小   8.5px    →  9px
小    11px     →  10.5px
标准  13px     →  12px
中    14px     →  13.5px
```

### 2.2 字号应用规则

| 元素 | 字号 | 字重 | 用途 | 示例 |
|------|------|------|------|------|
| 页面标题 | 32px | 600 | H1 | 「启动」 |
| 区块标题 | 22px | 600 | H2 | 「已安装版本」 |
| 卡片标题 | 16px | 600 | H3 | 「当前账户」 |
| 主文案 | 13px | 600 | 强调 | 版本号、账户名 |
| 正文 | 11px | 400 | 常规 | 描述文本 |
| 副文案 | 10.5px | 400 | 次要 | 「离线账户」 |
| 标签 | 9px | 500 | 大写 | 「ACCOUNT」 |
| 日志/代码 | 8px | 400 | 等宽 | 日志内容 |
| 极小 | 7px | 500 | 最小 | 百分比、计数 |

### 2.3 行高规则

```
标题（H1/H2/H3）：  1.1 倍行高
正文和表格：       1.5 倍行高
日志/代码：        1.65 倍行高
```

---

## 3. 颜色系统

### 3.1 继承自 paper.css 的色系

保持现有的主题色系统，不做改动：

```css
浅色模式（默认）：
  --bg: #f1eee7              /* 页面背景 */
  --surface: #fbf9f4         /* 卡片背景 */
  --surface-2: #ebe7de       /* 次要背景 */
  --surface-3: #e1dcd1       /* 第三级背景 */
  --text: #181a17            /* 主文字 */
  --text-2: #565b53          /* 次要文字 */
  --text-3: #8a8d85          /* 第三级文字 */
  --border: rgba(24,26,23,0.12)   /* 细线 */
  --border-strong: rgba(24,26,23,0.26) /* 粗线 */

深色模式（data-theme="dark"）：
  --bg: #141512              /* 页面背景 */
  --surface: #1b1d19         /* 卡片背景 */
  --surface-2: #23251f       /* 次要背景 */
  --surface-3: #2b2e27       /* 第三级背景 */
  --text: #ece9e1            /* 主文字 */
  --text-2: #b0b1a7          /* 次要文字 */
  --text-3: #7e8177          /* 第三级文字 */
  --border: rgba(236,233,225,0.11)   /* 细线 */
  --border-strong: rgba(236,233,225,0.24) /* 粗线 */

状态色（保留）：
  --accent: 青碧/潮蓝/森绿/暖橙（4 套主题）
  --success: #3f6b4f / #8bb99a
  --warning: #8a6430 / #c6a36b
  --danger: #a34a3f / #d18a7f
```

### 3.2 新增状态色

```css
/* 用于卡片左侧状态条 */
--status-running: var(--accent)        /* 动画效果，脉冲 */
--status-preparing: var(--warning)     /* 准备中 */
--status-error: var(--danger)          /* 错误状态 */
--status-idle: var(--text-3)           /* 空闲 */
--status-bar: 3px                      /* 状态条宽度 */
```

**应用**：
```css
.focus-panel.workbench {
  border-left: var(--status-bar) solid var(--accent);
}

.focus-panel.workbench.status-running {
  border-left-color: var(--status-running);
  animation: pulse-status 2s infinite;
}

.focus-panel.workbench.status-error {
  border-left-color: var(--status-error);
}
```

### 3.3 半透明背景规则

```css
/* 悬停高亮 */
.table-row:hover {
  background: color-mix(in srgb, var(--surface-2) 50%, transparent);
}

/* 选中状态 */
.table-row.selected {
  background: var(--accent-soft);  /* 低饱和点缀 */
}

/* 卡片提示 */
.account-info {
  background: var(--surface-2);
}
```

---

## 4. 栏目尺寸规范

### 4.1 宽度定义

```css
:root {
  --left-panel-width: 280px;              /* 左栏宽度 */
  --right-panel-width: 320px;             /* 右栏宽度（展开） */
  --right-panel-collapsed: 48px;          /* 右栏宽度（折叠） */
}
```

### 4.2 布局网格

```
完整视口（≥1280px）：
┌────────────────────────────────────────────┐
│ 左: 280px │ 中: 1fr  │ 右: 320px │ gap: 18px
└────────────────────────────────────────────┘
总宽度: 280 + 1fr + 320 + 36 = 100% 视口

中等视口（1280px 向下）：
┌────────────────────────────────────────────┐
│ 左: 240px │ 中: 1fr  │ 右: 280px │ gap: 16px
└────────────────────────────────────────────┘

小视口（< 960px）：
┌────────────────────────────────────────────┐
│         中: 100%（左右隐藏）
└────────────────────────────────────────────┘
```

### 4.3 表格列宽

```
表格总列数：6 列
┌───────┬─────┬──────┬──────┬──────┬──────┐
│ 图标  │ 版本 │ 类型 │ 日期 │ 时间 │ 操作 │
├───────┼─────┼──────┼──────┼──────┼──────┤
│ 48px  │ 1fr │ 100px│ 100px│ 100px│ 80px │
│ minw: │ minw:│      │      │      │      │
│ 48px  │ 180px│      │      │      │      │
└───────┴─────┴──────┴──────┴──────┴──────┘
行间距（gap）: 12px
```

---

## 5. 圆角规范

```css
/* 保留现有 */
--radius-xl: 16px   /* 大面板 */
--radius-lg: 10px   /* 卡片 */
--radius-md: 8px    /* 组件 */
--radius-sm: 6px    /* 小控件 */

/* 应用 */
.left-panel .quick-card {
  border-radius: var(--radius-lg);  /* 10px */
}

.library-table {
  border-radius: var(--radius-lg);
}

.account-avatar {
  border-radius: 6px;  /* 图片容器用小圆角 */
}
```

---

## 6. 边框规范

```css
/* 标准边框 */
--border: rgba(24,26,23,0.12)        /* 细线，最常用 */
--border-strong: rgba(24,26,23,0.26) /* 粗线，分隔 */

/* 应用规则 */
分割线（.table-head）：
  border-bottom: 1px solid var(--border-strong);

卡片边框（.quick-card）：
  border: 1px solid var(--border);

行分隔（.table-row）：
  border-bottom: 1px solid var(--border);
```

---

## 7. 阴影规范

```css
/* 保留现有 */
--shadow-sm: 0 1px 0 rgba(24,26,23,0.04)
--shadow-md: 0 20px 44px -38px rgba(24,26,23,0.38)
--shadow-pop: 0 34px 80px -44px rgba(24,26,23,0.44)

/* 使用场景 */
.task-dock（悬浮任务面板）：
  box-shadow: var(--shadow-md);

.modal（模态窗口）：
  box-shadow: var(--shadow-pop);

.card（普通卡片）：
  box-shadow: none;  /* 不用阴影，用边框 */
```

---

## 8. 过渡和动画

### 8.1 过渡时间

```css
/* 快速过渡 */
transition: 0.14s ease  /* 按钮 hover */

/* 标准过渡 */
transition: 0.16s ease  /* 背景色变化 */

/* 缓慢过渡 */
transition: 0.3s ease   /* 进度条 */
transition: 0.5s ease   /* 页面切换 */

/* 特殊过渡 */
right-panel 折叠：
  transition: width 0.2s ease;

launch-cta 进度条：
  transition: width 0.28s cubic-bezier(0.22, 0.8, 0.22, 1);
```

### 8.2 关键动画

```css
/* 状态脉冲（正在运行） */
@keyframes pulse-status {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.focus-status-badge.running {
  animation: pulse-status 2s ease-in-out infinite;
}

/* 进度条填充 */
@keyframes progress-fill {
  /* 用 CSS transition，不用 @keyframes */
  transition: width 0.28s ease;
}
```

---

## 9. 字体系统

```css
/* 保留现有 */
--font-sans: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif
--font-display: "Segoe UI Variable Display", "Segoe UI", "Microsoft YaHei UI", sans-serif
--font-mono: "Cascadia Mono", "Cascadia Code", Consolas, ui-monospace, monospace

/* 应用规则 */
标题（H1/H2/H3）：
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: -0.03em;

正文和按钮：
  font-family: var(--font-sans);
  font-weight: 400;

标签和日志：
  font-family: var(--font-mono);
  font-weight: 500;
  letter-spacing: 0.05em;
```

---

## 10. Z-index 层级

```css
z-index 层级规划：

100-999：
  .splash：1000           /* 启动动画 */

10-99：
  .modal-overlay：900     /* 模态蒙层 */
  .modal：910             /* 模态框 */
  .toast-stack：920       /* 通知堆栈 */
  .console-drawer：800    /* 日志抽屉 */
  .table-head：10         /* 表头粘性 */

0 以下：
  -1 及以上：背景元素
```

---

## 11. 响应式断点

```css
/* 主要断点 */
≥1280px：三栏完整显示
  左：280px，右：320px，gap：18px
  页面内边距：20px 24px

960px-1280px：三栏显示但收缩
  左：240px，右：280px，gap：16px
  页面内边距：18px 20px

<960px：左/右隐藏，中栏全屏
  中：100%
  页面内边距：16px 18px
  隐藏左栏和右栏，显示汉堡菜单

<600px（移动设备）：仅焦点卡片
  中：100%
  隐藏表格和实例网格
  页面内边距：12px 16px
```

---

## 12. 比例和黄金分割

### 12.1 内容比例

```
三栏比例（≥1280px）：
  左 : 中 : 右 = 280 : 1fr : 320
  实际约 19% : 54% : 27%

焦点卡片内部：
  图标 : 内容 : 按钮 = 68px : 1fr : 160px

表格行：
  图标 : 名称 : 其他 = 48px : 1fr : 380px
```

### 12.2 最大宽度

```
整体最大宽度：不限制（填充视口）
焦点卡片最大高度：360px
日志面板最大高度：180px
快速启动卡片最大项数：3-5 条
表格最多显示版本数：≥100（支持虚拟滚动）
```

---

## 附录：快速参考

### CSS 变量速查表

```css
/* 间距 */
--spacing-page: 20px 24px 22px;
--spacing-section: 16px;
--spacing-card: 14px;
--spacing-row: 10px;

/* 字号 */
--text-xs: 9px;
--text-sm: 10.5px;
--text-base: 12px;
--text-lg: 13.5px;

/* 尺寸 */
--left-panel-width: 280px;
--right-panel-width: 320px;
--right-panel-collapsed: 48px;

/* 状态 */
--status-bar: 3px;
--status-running: var(--accent);
--status-preparing: var(--warning);
--status-error: var(--danger);

/* 圆角 */
--radius-xl: 16px;
--radius-lg: 10px;
--radius-md: 8px;
--radius-sm: 6px;
```

### 快速对照表

| 用途 | 旧值 | 新值 | 差异 |
|------|------|------|------|
| 页面内边距 | 22 28 24 | 20 24 22 | -2，-4，-2 |
| 卡片内边距 | 16 | 14 | -2 |
| 卡片间距 | 16 | 14 | -2 |
| 行项间距 | 12 | 10 | -2 |
| 超小字号 | 8.5 | 9 | +0.5 |
| 小字号 | 11 | 10.5 | -0.5 |
| 标准字号 | 13 | 12 | -1 |
| 中字号 | 14 | 13.5 | -0.5 |
| 左栏宽 | — | 280 | 新增 |
| 右栏宽 | — | 320 | 新增 |
