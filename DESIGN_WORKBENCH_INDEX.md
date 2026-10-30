# 风信启动器「游戏工作台」设计方案 - 文件索引

**完整文档集合**  
**版本**: 1.0  
**创建时间**: 2026-10-24

---

## 📚 文档导航

### 快速入门（5 分钟）

👉 **从这里开始**：[DESIGN_WORKBENCH.md](DESIGN_WORKBENCH.md)

这份文档包含：
- 设计概述和核心改变
- 三栏布局详细说明
- 设计目标和实现路径
- 文件清单

---

### 设计规范（深入学习）

#### 1️⃣ 设计令牌完整规范
📄 **[DESIGN_WORKBENCH_TOKENS.md](DESIGN_WORKBENCH_TOKENS.md)**

内容：
- 间距系统（页面、卡片、组件）
- 字号系统（8 个级别）
- 颜色系统（继承 paper.css + 新增状态色）
- 栏目尺寸规范
- 圆角、边框、阴影规范
- 字体系统
- Z-index 层级规划
- 响应式断点

**何时查阅**：
- 当需要调整间距或大小时
- 当需要了解完整的设计令牌时
- 当需要扩展新的设计元素时

#### 2️⃣ 样式文件完整规范
📄 **[DESIGN_WORKBENCH_CSS.md](DESIGN_WORKBENCH_CSS.md)**

内容：
- 完整的 `workbench.css` 代码（2000+ 行）
- 三栏布局容器详解
- 左栏、中栏、右栏详细 CSS
- 响应式规则详解
- 动画定义
- 类名规范
- 性能优化建议

**何时查阅**：
- 当需要创建 CSS 文件时
- 当样式不生效需要调试时
- 当需要优化性能时

#### 3️⃣ 组件代码详细说明
📄 **[DESIGN_WORKBENCH_COMPONENTS.md](DESIGN_WORKBENCH_COMPONENTS.md)**

内容：
- LeftPanel 组件（完整代码 + Props 接口）
- RightPanel 组件（完整代码 + Props 接口）
- LibraryTable 组件（完整代码 + Props 接口）
- 辅助组件（EmptyState、LoadingSpinner）
- 类型扩展示例
- 常见问题解答

**何时查阅**：
- 当需要创建或修改组件时
- 当需要理解 Props 接口时
- 当需要扩展组件功能时

#### 4️⃣ HomePage 页面改造指南
📄 **[DESIGN_WORKBENCH_PAGES.md](DESIGN_WORKBENCH_PAGES.md)**

内容：
- 当前结构分析
- 改造概览（对比表）
- 状态管理改动（新增、删除、修改）
- JSX 结构改造（焦点卡片、版本列表、实例列表）
- 事件处理改造
- 删除的代码清单
- 新增的代码详解
- 折叠/展开状态管理
- 迁移检查清单

**何时查阅**：
- 当需要改造 HomePage 时
- 当需要理解状态管理变化时
- 当需要知道删除哪些代码时

---

### 实现指南（动手操作）

#### 5️⃣ 实现步骤和检查清单
📄 **[DESIGN_WORKBENCH_IMPLEMENTATION.md](DESIGN_WORKBENCH_IMPLEMENTATION.md)**

内容：
- 准备工作（环境检查、分支创建、文件备份）
- **第一阶段**：核心体验（7 个 Step，1-2 天）
  - Step 1-7：从创建 CSS 到第一次测试
  - 包含每步的验证方法和问题排查
- **第二阶段**：效率提升（3 个功能，1-2 天）
  - 右键菜单、高级筛选、快捷键系统
- **第三阶段**：锦上添花（3 个功能，1 天）
  - Modrinth 预览、系统状态、响应式优化
- 测试清单（功能、性能、兼容性）
- 常见问题 Q&A（6 个常见问题的解决方案）
- 性能优化技巧
- 后续维护指南
- 回滚方案
- 完成检查

**何时查阅**：
- 当准备开始实现时
- 当遇到问题需要排查时
- 当完成每个 Step 需要验证时
- 当需要优化性能时

---

## 📊 文档结构图

```
设计方案
├── DESIGN_WORKBENCH.md（👈 入口）
│   ├── 概述和目标
│   ├── 核心改变
│   └── 文件清单
│
├── 设计规范
│   ├── DESIGN_WORKBENCH_TOKENS.md
│   │   └── 间距、字号、颜色等令牌
│   ├── DESIGN_WORKBENCH_CSS.md
│   │   └── 完整 CSS 代码（可复制）
│   ├── DESIGN_WORKBENCH_COMPONENTS.md
│   │   └── 三个组件完整代码（可复制）
│   └── DESIGN_WORKBENCH_PAGES.md
│       └── HomePage 改造细节
│
└── 实现指南
    └── DESIGN_WORKBENCH_IMPLEMENTATION.md
        ├── 准备工作
        ├── 第一阶段（7 Step）
        ├── 第二阶段（3 功能）
        ├── 第三阶段（3 功能）
        ├── 测试清单
        ├── 问题排查
        ├── 性能优化
        └── 完成检查
```

---

## 🎯 使用场景和导航

### 场景 1: 我是设计师，想了解整体设计

**推荐阅读顺序**：
1. [DESIGN_WORKBENCH.md](DESIGN_WORKBENCH.md) - 5 分钟，了解总体
2. [DESIGN_WORKBENCH_TOKENS.md](DESIGN_WORKBENCH_TOKENS.md) - 10 分钟，理解设计系统
3. [DESIGN_WORKBENCH_CSS.md](DESIGN_WORKBENCH_CSS.md) - 浏览样式（不需要全读）

---

### 场景 2: 我是前端工程师，要实现这个设计

**推荐阅读顺序**：
1. [DESIGN_WORKBENCH.md](DESIGN_WORKBENCH.md) - 理解整体结构
2. [DESIGN_WORKBENCH_COMPONENTS.md](DESIGN_WORKBENCH_COMPONENTS.md) - 学习组件 API
3. [DESIGN_WORKBENCH_PAGES.md](DESIGN_WORKBENCH_PAGES.md) - 理解改造细节
4. [DESIGN_WORKBENCH_IMPLEMENTATION.md](DESIGN_WORKBENCH_IMPLEMENTATION.md) - 按步骤实现

**实现时的工作流**：
- Step 1-2：准备 + CSS
- Step 3-5：创建三个组件
- Step 6-7：改造 HomePage + 第一次测试
- 参考 [DESIGN_WORKBENCH_CSS.md](DESIGN_WORKBENCH_CSS.md) 复制 CSS 代码
- 参考 [DESIGN_WORKBENCH_COMPONENTS.md](DESIGN_WORKBENCH_COMPONENTS.md) 复制组件代码

---

### 场景 3: 我遇到了问题，需要调试

**查找方法**：

| 问题 | 查看 |
|------|------|
| 样式不显示/位置不对 | [CSS 规范](DESIGN_WORKBENCH_CSS.md) + [实现指南的问题排查](DESIGN_WORKBENCH_IMPLEMENTATION.md#6-常见问题) |
| 组件报错/类型错误 | [组件详解](DESIGN_WORKBENCH_COMPONENTS.md) |
| 不知道如何改造 HomePage | [页面改造指南](DESIGN_WORKBENCH_PAGES.md) |
| 不知道下一步该做什么 | [实现步骤](DESIGN_WORKBENCH_IMPLEMENTATION.md) |

---

### 场景 4: 我需要性能优化或深入定制

**查看**：
1. [实现指南 - 性能优化](DESIGN_WORKBENCH_IMPLEMENTATION.md#7-性能优化)
2. [CSS 规范 - 性能优化建议](DESIGN_WORKBENCH_CSS.md#5-性能优化建议)
3. [组件详解 - 常见问题](DESIGN_WORKBENCH_COMPONENTS.md#6-常见问题)

---

## 📋 快速参考

### 关键数值速查

| 项目 | 值 |
|------|-----|
| 左栏宽度 | 280px |
| 右栏宽度 | 320px（展开）/ 48px（折叠） |
| 中栏宽度 | 自适应（1fr） |
| 三栏间距 | 18px（<1280px 时 16px） |
| 焦点卡片最小高度 | 360px |
| 日志预览高度 | 180px |
| 表格行高 | 40px |
| 任务队列最多显示 | 3 个任务 |

### 关键类名速查

```css
.workbench-layout        /* 三栏容器 */
.left-panel              /* 左栏 */
.center-panel            /* 中栏 */
.right-panel             /* 右栏 */
.quick-card              /* 左栏卡片 */
.library-table           /* 版本表格 */
.table-row               /* 表格行 */
.task-panel              /* 任务面板 */
.log-panel               /* 日志面板 */
.status-panel            /* 状态面板 */
.focus-panel.workbench   /* 改造后的焦点卡片 */
```

### 文件大小预期

| 文件 | 大小 |
|------|------|
| workbench.css | ~20-30KB（压缩后 ~5-8KB） |
| LeftPanel.tsx | ~400 行 |
| RightPanel.tsx | ~300 行 |
| LibraryTable.tsx | ~250 行 |
| HomePage.tsx（改造后） | ~600 行（从 ~670 行） |

---

## ⏱️ 预计工作量

| 阶段 | 任务 | 时间 | 文档 |
|------|------|------|------|
| 准备 | 环境检查、分支创建 | 30 分钟 | [实现指南 #1](DESIGN_WORKBENCH_IMPLEMENTATION.md#1-准备工作) |
| 第一阶段 | 核心体验（7 Step） | 1-2 天 | [实现指南 #2](DESIGN_WORKBENCH_IMPLEMENTATION.md#2-第一阶段核心体验) |
| 第二阶段 | 效率提升（3 功能） | 1-2 天 | [实现指南 #3](DESIGN_WORKBENCH_IMPLEMENTATION.md#3-第二阶段效率提升) |
| 第三阶段 | 锦上添花（3 功能） | 1 天 | [实现指南 #4](DESIGN_WORKBENCH_IMPLEMENTATION.md#4-第三阶段锦上添花) |
| 测试优化 | 性能、兼容性、问题修复 | 1-2 天 | [实现指南 #5-8](DESIGN_WORKBENCH_IMPLEMENTATION.md#5-测试清单) |
| **总计** | **完整实现** | **4-7 天** | **所有文档** |

---

## ✅ 使用检查清单

完整阅读此设计方案前，请确保：

- [ ] 已读过 [DESIGN_WORKBENCH.md](DESIGN_WORKBENCH.md)
- [ ] 了解三栏布局的基本结构
- [ ] 知道三个新组件的作用
- [ ] 了解工作量预期和时间规划
- [ ] 已准备好开发环境

开始实现前，请确保：

- [ ] 已阅读 [DESIGN_WORKBENCH_IMPLEMENTATION.md](DESIGN_WORKBENCH_IMPLEMENTATION.md) 的第 1 节
- [ ] 已创建 Git 分支
- [ ] 已备份关键文件
- [ ] 已确认没有未提交的改动

---

## 📞 常见问题速答

**Q: 这个方案会改变现有的启动器功能吗？**  
A: 不会。这只是改变界面布局和显示方式，所有功能保持不变。

**Q: 能否部分实现，比如只做第一阶段？**  
A: 可以。第一阶段是完整的功能，可以单独实现和发布。第二、三阶段是可选的增强。

**Q: 如果出现问题怎么回滚？**  
A: 查看 [实现指南 - 回滚方案](DESIGN_WORKBENCH_IMPLEMENTATION.md#9-回滚方案)，或者使用 Git：`git revert`

**Q: 这个新界面在移动设备上能用吗？**  
A: 可以。有响应式规则，在 960px 以下会自动隐藏左右栏，只显示中栏。

**Q: 能否不改动 HomePage，只添加新组件？**  
A: 可以，但那样就体现不出三栏布局的优势了。建议至少实现第一阶段。

---

## 🔗 内部链接速查

### 按文档

- [设计概述](DESIGN_WORKBENCH.md#1-设计概述)
- [核心改变](DESIGN_WORKBENCH.md#2-核心改变)
- [三栏详细设计](DESIGN_WORKBENCH.md#2-核心改变)
- [CSS 完整代码](DESIGN_WORKBENCH_CSS.md#2-完整-css-代码)
- [组件代码](DESIGN_WORKBENCH_COMPONENTS.md#1-leftpanel-组件)
- [实现步骤](DESIGN_WORKBENCH_IMPLEMENTATION.md#2-第一阶段核心体验)

### 按主题

- **布局**：[设计概述](DESIGN_WORKBENCH.md)
- **样式**：[CSS 规范](DESIGN_WORKBENCH_CSS.md) + [令牌规范](DESIGN_WORKBENCH_TOKENS.md)
- **组件**：[组件详解](DESIGN_WORKBENCH_COMPONENTS.md)
- **改造**：[页面改造](DESIGN_WORKBENCH_PAGES.md)
- **实现**：[实现步骤](DESIGN_WORKBENCH_IMPLEMENTATION.md)

---

## 📈 进度追踪

### 阶段 1 进度

- [x] CSS 文件创建
- [x] LeftPanel 组件
- [x] RightPanel 组件
- [x] LibraryTable 组件
- [x] HomePage 改造
- [x] 首次测试通过（0.4.4）

### 阶段 2 进度

- [x] 右键菜单
- [x] 高级筛选
- [x] 快捷键系统
- [x] 表格/网格切换
- [x] 实例快速预览

### 阶段 3 进度

- [x] Modrinth 预览
- [x] 系统状态监控
- [x] 响应式优化
- [x] 任务暂停/继续/取消
- [x] 快速启动固定
- [x] 日志复制与打开

---

**最后更新**：2026-10-24  
**维护者**：Windletter Design Team

---

👉 **现在就开始**：打开 [DESIGN_WORKBENCH.md](DESIGN_WORKBENCH.md)

或者根据你的角色选择合适的文档：
- 设计师 → [DESIGN_WORKBENCH_TOKENS.md](DESIGN_WORKBENCH_TOKENS.md)
- 前端工程师 → [DESIGN_WORKBENCH_COMPONENTS.md](DESIGN_WORKBENCH_COMPONENTS.md)
- 项目经理 → [DESIGN_WORKBENCH.md](DESIGN_WORKBENCH.md)
