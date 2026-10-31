# 风信启动器 · 开发交接文档

最后更新：2026-10-31  
项目版本：0.60.20（本地构建；公开 Release 为 0.60.20）  
交接形态：源码 + Windows 安装包 + 本说明  
适用平台：Windows 10/11 x64

> 目标：换一台设备后，不依赖旧机器上的任何文件，也能在 10 分钟内跑起来并继续开发。

---

## 1. 立即开始

### 环境要求

- Windows 10/11 x64
- Node.js 22 或更高版本（旧机器实测 Node 24.20.0、npm 11.19.0）
- npm
- 可选：Git，用于后续版本管理

### 首次运行

```powershell
# 解压源码包后进入目录
npm ci
npm run dev
```

如果 `npm ci` 卡在 Electron 二进制下载，设置镜像后重新运行安装脚本：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
```

### 启动后的最短验证路径

1. 右上角账户 → 添加离线账户。
2. 进入「下载」→ 搜索一个版本（推荐 26.2）→ 安装。
3. 等待任务浮窗完成。首次安装会下载游戏文件，并在启动时自动准备对应 Java。
4. 进入「实例」→ 从 Modrinth 安装一个 Fabric 整合包，或导入本地 `.mrpack`。
5. 回到「启动」→ 选择实例 → 启动游戏；标题栏终端可查看实时日志。

如果只是要体验，不打算开发，可直接运行交付目录里的
`Windletter-Launcher-0.60.20-setup.exe`（本地 `D:\WindletterOut`；公开 Release v0.60.20）；仓库为 `https://github.com/muyi0736/windletter`，当前公开 Release 为 `https://github.com/muyi0736/windletter/releases/tag/v0.60.20`。0.60.20 本地构建安装包 116,789,027 字节，SHA-256 为 `63babce6a44b7cbb218f3948e35cde4a6f83146fbefa626e074eb5699e98c2cb`；公开 v0.60.20 安装包 116,788,167 字节，SHA-256 为 `c1ebafea6fee7d0c01f5d7a05471644818de14db4fce396691b2b4e297ece3d3`，`latest.json` 1474 字节，SHA-256 为 `b78c9c6cc5be3b6b825499dc4a54f4abcfe57fea8228fb306dae76cee756ed62`，Actions run `41170233475`，源码提交 `89cefb6`、tag `v0.60.20`；0.60.19 本地构建安装包 116,790,584 字节，SHA-256 为 `5ab99569599c3b2b70d88ef261da5bd8850ff03970fbc5cc4b23b04da7cf465c`；0.60.18 本地构建安装包 116,789,457 字节，SHA-256 为 `07477cc96a859cb71c141cc0c0c025b33ba173f4954ddd4ad3ae3364f50284d6`；0.60.17 本地构建安装包 116,789,737 字节，SHA-256 为 `4f60981023d901ab418398eb6048d97390c80ba542655e5f74af9ff5f47d5162`；0.60.16 本地构建安装包 116,788,520 字节，SHA-256 为 `ca246b48f693482f50843670202fe5200821107531784a79295293e77ca51356`；0.60.15 本地构建安装包 116,788,399 字节，SHA-256 为 `e0450afb0e1dc652024b51149866241cb4b976e504140f4b78e6e051b755e9c1`；0.60.14 本地构建安装包 116,787,314 字节，SHA-256 为 `ecfad2f0545ffea74230b6eca384a60ef252fd21256317376d5c144cffb42a41`。0.60.13 本地构建安装包 116,787,084 字节，SHA-256 为 `b3fd74516daf390964c6b8e4f74bdfb3ffc79ca4544c3ff3595abd467a505792`；公开 Actions 构建安装包 116,786,162 字节，SHA-256 为 `e93ca25c53d20c26d641e3766c81dd79d14e930c5c9262f562775eb5debf7ebb`，`latest.json` 1311 字节，SHA-256 为 `83161e648b802634cfbf103b611211f30b05ba24fe50b43f196cad37483aff43`，Actions run `41102626931`，源码提交 `c278749`、tag `v0.60.13`。0.60.12 本地安装包 SHA-256 为 `0a984bc551b2822e46914346d82a7f14d80c9a7b5f44ae204abfa4074924bf6e`；0.60.11 本地安装包 SHA-256 为 `8e38f0679f5c5455d7288ee21f3fca0b0dff81226df49bff9ef531687191b441`；0.60.9 的安装包 SHA-256 为 `7843854cfaeeed5650ce35f2e34c1c6b3eab7e54be61ed3399d5b742f919e775`。

### 三个最重要的目录

| 路径 | 作用 |
| --- | --- |
| `src/main/` | Electron 主进程：下载、安装、Java、账户、启动、实例与整合包 |
| `src/preload/index.ts` | 主进程与界面之间的类型化桥接 |
| `src/renderer/src/` | React 界面、Zustand 状态、样式 |

---

## 2. 项目定位与当前状态

这是一个 PCL2 风格的 Minecraft Java 版启动器。0.2.x 同时做通了「原版游戏从下载到启动」与「整合包从导入到启动」两条链路：

- 原版版本浏览、安装、补全、Java 准备与启动；
- 本地 `.mrpack` 导入与 Modrinth 在线安装；
- Fabric / Quilt / Forge / NeoForge / OptiFine 加载器自动安装；
- 独立实例目录，模组、配置与存档互不干扰；
- 实例与原生版本统一的首页/选择器入口。

### 已完成并实际验证

- 浏览 Mojang 版本清单，按正式版/快照/远古版本分类与搜索。
- 使用 BMCLAPI 或官方源下载并安装原版，含 SHA1 校验、失败回退和补全。
- 实测安装 Minecraft 1.21.1 与 26.2。
- 自动检测 Java，并自动下载 Mojang Java 运行时；实测 Java 21 / 25。
- 离线账户添加、切换与删除。
- 使用离线账户实际启动原版 1.21.1；实测启动 Fabric 0.19.5 + Minecraft 26.2 整合包，模组加载与渲染线程正常。
- 从 Modrinth 搜索并安装 Fabulously Optimized：原版 26.2 + Fabric 0.19.5 + 49 个模组，启动成功。
- 本地 `.mrpack` 导入：`modrinth.index.json` 解析、原版/加载器补齐、`overrides` 与 `client-overrides` 解压、实例元数据写入均实测通过。
- Quilt 加载器安装实测通过（0.20.0-beta.9 + Minecraft 26.2），但启动受上游 Java 25 兼容性限制，见第 6 节。
- Forge 加载器实测通过：Modrinth「OptiWorld」1.20.1 + Forge 47.4.20 + 21 个模组完成安装并进入 Forge 主界面；安装器使用 Java 21，原版 jar 在安装后 SHA1 与 Mojang 清单一致，Forge 使用独立的 patched jar。
- NeoForge 加载器实测通过：Modrinth「The Pixelmon Modpack」1.21.1 + NeoForge 21.1.248 + 13 个模组完成安装，实例元数据为 `loader: neoforge`、`versionId: neoforge-21.1.248`；原版 1.21.1.jar SHA1 与 Mojang 清单一致。清空模组后重新启动，NeoForge ModLauncher、EarlyDisplay、Mixin 和纹理图集均正常，进入主界面。Pixelmon 包内 Essential 在 stage2 会长时间等待网络，属于包/网络问题，不影响加载器本身。
- 实例删除、共享版本保护（正在被实例使用的原版版本不可删除）实测通过。
- 下载层用 `npm run test:download` 验证：1 MB 后强制断开，第二次请求从 `bytes=1048576-` 续传，最终 SHA1 与大小正确；删除目标文件后再次下载命中缓存、未发起网络请求，且目标与缓存 inode 相同（硬链接）；20 秒停滞会切换到备用线路；同主机并发上限为 16。
- 启动器自更新用本地限速更新源（HTTP localhost，产品仅允许 HTTPS）与 111MB 真实安装包完整走通：0.60.0 → 0.60.1 → 0.60.2；手动/启动静默检查、导航角标、实测进度与速度、取消后 16 分片断点续传、SHA-256 失败删除、不可达地址错误、NSIS 静默升级并自动重启、关闭启动检查后不再请求均验证；浅色/深色与 1000/1180 布局正常。
- 启动阶段与实时日志、日志文件、任务队列与进度显示。
- 0.3.0 UI 重做为「纸墨极简」：暖白/石墨双主题、细分割线、单一低饱和点缀、统一排版与克制动效；首页改为当前目标 + 资料栏 + 库列表结构。
- 0.4.4 首页按 `DESIGN_WORKBENCH*.md` 落地第一阶段「游戏工作台」：280/自适应/320 三栏，账户与快速启动、Java 环境、最新正式版、版本表格、实例卡片、右栏任务/日志/系统状态与折叠；1280/1040/840 三档响应式。微软账户头像改为从 sessionserver 读取公开皮肤并渲染 head + hat 图层，离线账户保留生成头像。
- 0.4.5 完成工作台第二、三阶段：版本行右键菜单（启动/目录/复制/导出/删除）、游戏版本与加载器叠加筛选、表格/网格切换、实例快速预览、全局快捷键；任务暂停/继续/取消/清理、磁盘 30 秒刷新、日志复制与打开日志文件、快速启动固定、Modrinth 整合包快速预览。暂停通过中止当前任务并在继续时重跑实现，已下载内容走缓存/断点续传。
- 0.4.6 NeoForge：现代版本走 `net/neoforged/neoforge/<版本>`，1.20.1 legacy 走 `net/neoforged/forge/<mc>-<版本>`；从 `neoforged.forgecdn.net` 下载并改写安装器内嵌的 `maven.neoforged.net` 地址，legacy profile 重命名为 `<mc>-neoforge-<版本>`，现代 profile 为 `neoforge-<版本>`。启动参数对 `-DignoreList` 使用父级 Minecraft 版本名，避免原版 jar 与 NeoForge client jar 同时注册 `minecraft` 模块。
- 0.4.7 内容安装：独立加载器实例（原版 + Fabric/Quilt/Forge/NeoForge，加载器版本可留空）、实例内模组搜索/安装（Modrinth 自动解析必需依赖，CurseForge 通过自备 API key）、模组禁用/启用/移除/导入本地 jar；CurseForge `downloadUrl: null` 转手动页面 + 本地导入。CurseForge API 地址可在设置里改成自建代理。
- 0.4.8 下载中心按 PCL2 逻辑重做：左侧原版游戏/整合包/Mod 分类；原版页左侧版本列表、右侧版本详情与加载器附加行（仅原版/Fabric/Quilt/Forge/NeoForge，OptiFine 显示无），底部开始下载；整合包页名称/版本/来源/类型筛选、搜索/重置/安装已有整合包、结果行含加载器标签、下载量与来源；Mod 页选择实例进入模组管理。CurseForge 整合包来源暂标记待接入。
- 0.4.9 下载与登录收口：实例页移除重复的整合包发现入口；整合包可选择具体版本安装（Modrinth 全量版本列表）；Mod 页在没有本地实例时也能搜索并下载到 `<数据目录>\downloads\mods`；整合包与 Mod 搜索支持加载器筛选；原版安装加载器时可选具体加载器版本（Fabric/Quilt/Forge/NeoForge 全量列表，默认最新推荐）；设置页与账户弹窗不再展示或要求填写 Client ID，外部正版启动器桥接从界面移除（内置 Client ID 已作为默认值）。
- 0.5.0 模组版本选择：下载中心与实例模组管理点击「选择版本」后打开统一弹窗；`mods:versions` 汇总 Modrinth 全部版本或 CurseForge 文件，按游戏版本 + 加载器分组，展示前置资源、版本类型、文件名、大小、下载量与日期；`install` / `download` 接受 `versionId`，Modrinth 会连同必需前置一起下载/安装，CurseForge 使用所选 fileId。下载中心显示实际下载的文件数量与前置。实测 AppleSkin：26.3 最新版下载得到主文件 + Fabric API；1.20.1 Forge 历史版本精确下载；实例安装 1.20.1 Fabric 版本得到 AppleSkin + Fabric API 两个文件。
- 0.5.1 前置跳转与版本列表收口：版本弹窗内的「前置资源」改为启动器内跳转，点击直接进入该前置模组的版本选择页，可下载/安装指定前置并通过面包屑返回原模组；回调携带当前目标，避免下错项目。游戏版本标签只保留稳定大版本，超出的版本进入「更多版本…」下拉；快照、pre、rc 默认折叠，最多先显示 12 个版本分组并支持继续展开。实例安装时兼容分组排在最前，不兼容分组标灰并禁用。实测 AppleSkin → Fabric API 跳转/返回、前置独立下载 `fabric-api-0.165.0+26.3.jar`、Fabric 1.20.1 实例兼容分组置顶。
- 0.6.0 本地整合包扫描：实例页和下载 → 整合包新增「扫描本地」。`localPacks.ts` 会扫描风信下载目录、系统下载/桌面/文档中的 `.mrpack`，CurseForge、Prism Launcher、MultiMC、Modrinth App 的已安装实例，以及 `.minecraft\versions` 下带 `mods` 的 PCL2/HMCL 版本；解析名称、Minecraft 版本、加载器、模组数和路径，缺失版本信息的条目标记不可导入。导入已安装实例时补齐原版与加载器，再复制模组与配置（排除存档、日志、共享库和运行时）并写入 `instance.json`；`.mrpack` 复用现有导入任务。实测 CurseForge / Prism / Modrinth / PCL 版本 / 损坏实例 / `.mrpack` 共 8 个夹具全部正确识别，UI 一键导入 26.2 原版夹具成功，复制了 `mods` 与 `config`。
- 0.6.1 扫描结果直接游玩：每个可导入条目提供「导入并启动 / 安装并启动」和「仅导入 / 仅安装」。选择前者时记录任务 ID，导入完成并刷新实例后自动选中新实例并调用启动；若没有账户，则打开账户窗口并提示登录后启动。扫描弹窗说明导入后会补齐原版与加载器、复制模组与配置，完成后直接进入游戏。
- 0.6.2 PCL2 版本目录兼容：扫描新增 C–H 盘根目录的 `.minecraft\versions`，不再只找用户目录；`readVersionPack` 支持 PCL2 已展开的 Forge profile（`clientVersion`、`--fml.mcVersion`、`--fml.forgeVersion`），并把导入入口补到通用实例识别链。Forge 与 NeoForge 的 `-DignoreList` 分开处理：Forge 忽略自身 profile jar，NeoForge 忽略父级原版 jar，解决 `Modules minecraft and _1._20._1.forge export package`。Forge/NeoForge 启动与安装改为要求精确 Java 主版本，缺少时自动下载对应运行时（1.20.1 Forge 使用 Java 17）。实测 `D:\.minecraft\versions\ae` 与 `miao` 均识别为 1.20.1 / Forge 47.4.16 / 301 与 303 个模组；ae 导入成功（301 个模组、262 个配置项），Java 17 启动通过 ModLauncher、EarlyDisplay、Mixin 与 Essential 阶段；同机已有 4.6GB 游戏进程时 8GB 分配在 Essential 阶段退出，未完成主菜单回归。
- 0.6.3 外部实例直接启动：扫描到的 `.minecraft\versions` 版本包现在以 external 实例记录引用原目录（`external.baseDir` / `external.gameDir`），只写 `instance.json`，不复制模组、不安装原版或加载器、不下载整合包文件。启动器使用外部 baseDir 的 versions/libraries/assets 与原版本目录，natives 写到风信实例元数据目录；模组管理、打开目录也指向外部 `mods`。Java 检测加入 PCL2/官方 `.minecraft\runtime`，可复用现成 Java 17。删除外部实例只移除引用，不碰原目录。实测添加 ae 仅生成 1 个 `instance.json`，`mods.list` 直接读取外部 301 个模组，启动使用 `D:\.minecraft\versions\ae`、`D:\.minecraft\assets` 和 PCL2 的 Java 17，无复制、无资源下载。
- 0.6.4 批量添加：扫描弹窗每条可添加项前有复选框，工具栏支持「全选可添加 / 取消全选」与「批量添加 (N)」；数量在底部实时显示。新 IPC `local-packs:import-many` 用一个 modpack 任务串行处理，外部实例瞬时写引用，复制/安装类按顺序补齐并映射分项进度；一次最多 50 个，全部完成刷新实例列表。实测全选 ae/miao 后批量添加，只启动一个任务，生成两个 external 实例，每个实例目录只有 `instance.json`。
- 0.6.5 拖放导入：全窗口监听 dragenter/dragover/dragleave/drop，显示虚线拖放层；preload 通过 `webUtils.getPathForFile` 取真实路径，支持一次拖入多个 `.mrpack` 并交给 `local-packs:import-many`，非 `.mrpack` 会提示忽略。实测 CDP 模拟拖入 `Avaritia-Project-1.17.mrpack`，拖放层出现，松开后启动导入任务。该文件用「导入 .mrpack」按钮也已完整导入：202 个文件、351 MB，约 10 分钟，最后一个大文件单连接约 200 KB/s，说明此前是缺少拖放入口而非解析或下载失败；大包下载慢时任务会继续在后台进行。
- 0.6.6 Modrinth 镜像加速：设置新增 `modrinthMirror`（默认开启，可关闭）；`modrinthFileCandidates()` 把 `cdn.modrinth.com/data/...` 改写到第三方 MCI 镜像 `https://mod.mcimirror.top`，官方地址保留为回退。应用到 `.mrpack` 内文件、Modrinth 整合包压缩包、模组/前置下载。实测同一 Avaritia 包：官方源约 200–300 KB/s，开启镜像后启动阶段 26 MB/s、持续约 3.9 MB/s，15 秒下载 160 MB；设置项默认开启，可随时回退官方 CDN。
- 0.6.7 搜索结果分页：整合包搜索、Mod 目录和实例模组管理都支持「加载更多」，按 20 条追加并去重，底部显示总数/已显示数量/剩余数量；加载更多失败时保留已加载结果。实测整合包和 Mod 各从 20 条追加到 40 条，计数同步更新；CurseForge 与 Modrinth 均复用各自 offset。
- 0.6.8 多线程分片下载：`downloadFile` 对 4 MB 以上的文件先发 `Range: bytes=0-0` 探测，支持 206 时按 4/6/8 路并发下载到 `.segN`，每段独立 20 秒停滞保护与主机并发控制；分段元数据写入 `.part.segments.json`，取消后保留分段，下次继续。完成后顺序合并、校验总大小和 SHA1，再写入内容缓存；服务器不支持 Range、分段失败或校验失败会自动清理分段并回退单连接下载。实测 Ad Astra（7.2 MB）+ 3 个依赖共 18.8 秒，之前单连接约 39–40 秒；`npm run test:download` 仍通过。
- 0.6.9 分片可靠性：每段失败最多重试 3 次，重试从该段当前文件大小继续；单段重试耗尽时保留所有分段并抛出错误，交给下一个候选 URL 或下次继续，不再清空进度改走单连接。分段元数据允许 URL 变化（镜像/官方），只要大小、段数和 ETag 一致就重用已下载分段。实测 392 MB Pixelmon：8 路分段 375 秒完成，平均约 1.05 MB/s，期间一段在 266 MB 附近停滞并成功续传，最终 SHA1 与 Modrinth 值一致、无 `.seg`/`.part` 残留；此前同文件回退单连接约 0.2–0.3 MB/s。
- 0.7.0 实例级启动设置：实例记录新增 `memoryMb`、`extraJvmArgs`、`javaPath`，启动时优先于全局设置合并到本次启动；实例卡片新增「启动设置」弹窗，可独立分配内存、追加 JVM 参数、指定 java.exe 或恢复自动。实测外部 ae 实例设为 6144 MB 并追加 `-Dwindletter.instance=1`，游戏进程命令行确实出现 `-Xmx6144M -Dwindletter.instance=1`。外部 ae 实例也已完整启动到主菜单（窗口标题 Project Avaritia，占用约 5.1 GB）。
- 0.7.1 本地文件夹列表：设置新增 `localPackFolders`（最多 20 个绝对路径），扫描 IPC 接受多个目录；扫描弹窗的「选择文件夹」会保存目录并在下次打开/重启后自动扫描，已保存目录显示为可移除的文件夹标签。保存目录会同时扫描 `.mrpack`、常见启动器实例、`.minecraft\versions` 和目录本身。实测添加 `D:\WindletterCustomPacks` 后重启，扫描列表仍保留该目录并发现 `SavedTest`（1.20.1 / Fabric / 1 个模组）。
- 0.7.2 Java 自动分配：新增 `java:assignments` / `java:apply-assignments`。读取每个实例版本 JSON（沿 inheritsFrom 向上）得到所需 Java，按 Forge/NeoForge 精确主版本、其他加载器可选更高版的规则，从已检测 Java（含 `.minecraft\runtime`）中分配；手动指定的 Java 保留并校验，缺少时标记但不主动下载。设置 → Java 环境新增「自动分配」弹窗，显示实例、所需/分配版本、路径与状态，应用后写入实例 `javaPath`。实测 ae/miao 自动匹配到 PCL2 的 Java 17，应用后两个实例的 `instance.json` 都写入了该路径。
- 0.8.0 CurseForge 整合包：新增 `searchCurseForgeModpacks`（classId 4471）、`listCurseForgeModpackVersions`、`getCurseForgeFileInfo`，以及 `installCurseForgeModpack`。安装时下载 CF 整合包 zip、读取 `manifest.json`，逐项调用 CF API 取文件下载地址与 SHA1，生成临时 `.mrpack`（含 overrides）后复用现有安装流程；支持 Forge/Fabric/Quilt/NeoForge 加载器 ID，`downloadUrl: null` 明确停止并给出手动页面，不绕过分发限制。UI 下载中心来源可切换 Modrinth/CurseForge，版本弹窗和安装按 provider 分流。用本地 HTTPS mock CF API 完整验证了搜索、版本列表和安装：Mock CF Pack 安装成功，`config/test.txt` 与 AppleSkin 均写入实例，来源记为 curseforge。真实 CurseForge 仍需用户自己的 API key，未做线上 key 回归。
- 0.8.1 下载缓存管理：设置新增 `cacheLimitMb`（默认 4096，0 为不限制），启动和修改设置时按文件 mtime 做 LRU 裁剪，命中缓存也会刷新 mtime；设置 → 下载设置显示缓存大小/文件数，可手动清理。实测 3 个 600 KB 对象、上限 1 MB 后只保留最新的 1 个；清理后统计为 0。
- 自定义标题栏、浅色/深色主题、四套主题色、设置持久化。
- 构建 Windows NSIS 安装包，并验证 asar 打包后的应用可启动。
- 0.12.0 服务器中心：新增 `servers.json` 书签库与 `servers:*` IPC；主进程实现 Server List Ping（SRV、IPv6、自定义端口、4.2 秒超时）、MOTD 颜色/格式解析、玩家数、延迟和服务器图标。顶部导航新增「服务器」，支持卡片状态每 60 秒刷新、绑定实例、一键启动并进服；启动命令追加 `--server`/`--port`（IPv6 自动加方括号），启动日志记录服务器目标。实测本地 mock SLP、Hypixel 公网探测、离线端口、添加/编辑/删除/重启持久化，以及绑定实例后的启动流程和错误处理；`npm run typecheck` 与 `npm run build` 均通过。
- 0.12.1 整合包 `.zip` 支持：Modrinth 整合包常常直接以 `.zip` 分发（根目录仍是 `modrinth.index.json` + `overrides/`）。现在导入文件对话框、拖放、本地扫描和批量添加都接受 `.zip`；主进程仍按内容识别，缺少 `modrinth.index.json` 会给出明确提示。实测 `baka也要玩红石(by yue) 3.0.0.zip`（117 MB，197 个清单文件，MC 26.2 / Fabric 0.19.5）被扫描识别，拖放导入完整完成，生成 185 个客户端模组、160 个配置项、39 个资源包，并复制 options.txt 与 servers.dat。
- 0.12.2 服务器档案化改版：服务器页从卡片列表改为 FILE A/B 档案布局，左侧文件索引 + 右侧档案页；档案页展示大标题、在线人数、版本/协议/加载器/绑定实例、MOTD 备注、上次检测和延迟，底部保留地址复制、单服探测、编辑、删除与一键进服。服务器新增可选分类字段（显示在 FILE 标签上），SLP 增加协议号。实测 baka（26.2/Fabric，6/69，776）与 AVT（1.20.1/Forge，0/10，763）两个真实服务器，在浅色/深色、1180 与宽屏、分类保存、单服探测与选中切换下正常。
- 0.13.0 故障医生：新增 `diagnostics:run`，检查版本文件、Java 兼容性、内存、游戏目录权限、模组 jar 元数据、重复 mod ID、缺失前置（扫描 Fabric API 子模块与 Jar-in-Jar 降低误报）和 OptiFine/Sodium 冲突；崩溃报告按 OOM、Java、缺前置、Mixin、损坏 jar、图形环境等规则提取证据，可在 UI 中禁用疑似模组、打开 Mod/日志/崩溃目录或复制诊断。AI 辅助为可选项，默认关闭；支持 DeepSeek/OpenAI/Ollama/自定义 OpenAI 兼容接口，API Key 经 safeStorage 加密存入 `ai.json`，仅点击分析时发送脱敏的实例信息、体检结果、日志尾部与模组文件名。实测故障夹具（重复/缺前置/损坏 jar/冲突/OOM）和真实 185 模组 baka（2 个重复 ID + 1 个未直接找到的前置，2.7 秒完成）均正常；mock OpenAI 接口返回结构化结果，密钥文件无明文、上下文无用户名/IP。
- 0.13.1 故障医生校准：重复 mod ID 从 error 降为 info，文案明确“部分加载器会继续、能正常游玩可保留”，不再把能玩的整合包标成 error；AI 提示词要求不要在没有崩溃证据时断言无法启动，AI 返回 JSON 增加首个完整对象提取、未转义换行修复和未结构化摘要兜底，避免大段 JSON 直接铺在结果卡上。
- 0.13.2 故障医生记忆与依赖语义：新增 `diagnostics:mark-known-good`、`diagnostics:ignore-issue`、`diagnostics:clear-ignored` 与 `instances/<id>/diagnostics.json`。启动器在游戏正常退出（运行超过 60 秒且退出码 0）后自动记录指纹，也可在医生界面手动标记；指纹覆盖版本、加载器、Java 主版本、内存、JVM 参数与每个模组的文件名/大小/启用状态。配置变化时返回新增/移除/替换差异，同一指纹下预检模组提示降为参考，崩溃报告保持原级别。提醒类预检可按实例和指纹忽略，配置变化后自动失效；改回原配置时忽略记录仍可复用。依赖解析新增客户端/服务端区分、Forge `side`/`mandatory`/`type`、Quilt optional、Fabric API 子模块、Jar-in-Jar 与保守版本范围比较；无法判断的范围不做告警。AI 上下文加入可运行历史与差异，提示词要求结合成功记录判断。实测独立夹具：服务端/可选前置/JiJ/Fabric 子模块不报假缺失，版本范围能识别 beta 1.5.0 不满足 >=2.0.0；标记后状态 healthy、新增 delta 文件产生差异、改变配置后忽略失效、恢复原配置后忽略复用、崩溃 OOM 在已知可运行状态下仍保持 error。mock AI 请求包含 `launchHistory`，且无用户名、本机路径、密钥或 IP。
- 0.13.3 前置下载可选：`ModInstallRequest` / `ModDownloadRequest` 新增 `includeDependencies`（缺省 true），IPC 参数校验保留该字段；Modrinth 递归前置解析和 CurseForge 前置循环都会读取开关。版本选择窗口新增「自动下载必需前置」开关，默认开启；关闭后副标题与提示变为只处理所选文件，Modrinth 与 CurseForge、实例安装与下载中心四条路径共用。实测 Iris 1.21.1 Fabric（必需 Sodium）：关闭后只安装 Iris 一个 jar，开启或缺省时同时安装 Iris + Sodium；下载中心关闭时只下载 Iris；界面开关状态与副标题同步。
- 0.13.4 记住前置开关：`LauncherSettings` 新增 `autoModDependencies`（缺省 true），版本选择窗口的开关会通过 `settings:update` 立即写入本机配置；打开窗口时读取上次选择，关闭过之后下次默认仍为关闭，手动开启后才恢复。实测关闭后重开窗口、重启应用都保持关闭，配置文件中为 false；再次开启后同步为 true，旧配置缺字段时默认开启。
- 0.13.5 实例内容分页：`InstanceContentModal` 之前只请求 `searchCatalog` 的第一页 20 条且没有加载更多，用户会误以为“只能显示这么点”。现在记录 `total/offset`，支持「加载更多」追加并按 `projectId` 去重，显示“共 X 个结果，已显示 Y 个 / 还有 Z 个结果”；切换模组、数据包、资源包、光影包或数据源会清空列表并回到第一页。实测 Iris 1.21.1 搜索：首屏 20 条，加载更多后 23 条且无重复，按钮消失；切换到数据包再切回模组，查询清空并重新从第一页开始。
- 0.13.6 Mod 搜索版本选择重做：新增 `ModGameVersionPicker`，替换原先的自由文本 + datalist。下拉内可搜索版本号或实例，实例置顶并显示 MC 版本/加载器；版本按正式版优先、快照/远古在后排序，标注已有实例，打开时自动滚到当前选择。选择实例会同时带入版本与加载器；手动改版本或加载器会解除实例跟随。进入 Mod 页默认跟随最近使用的非原版实例，没有实例时回退最新正式版。搜索只在下拉真正选定/加载器变化/分类或数据源变化时触发，不再每输入一个字符请求一次；`modSearchSeq` 丢弃过期响应，避免快速切换时旧结果覆盖新结果。实测两个夹具实例（Fabric 1.21.1、Forge 1.20.1）：默认带入 Fabric 实例，选 Forge 实例后加载器同步切换，手动选 1.21.1 保留 Forge，改加载器后解除实例跟随；搜索计数与筛选标签同步，切换分类后再返回仍保留手动筛选。
- 0.13.7 CurseForge 前置递归：新增 `collectCurseForgeFiles`，实例安装和下载中心共用；按 modId 去重，只处理 required，最多 4 层/20 个文件，根模组失败仍抛错，深层失败转为带项目 files 页链接的手动下载项，不阻断主模组。`curseforge.ts` 新增 `getCurseForgeProjectLink` 供兜底使用。实测 Waystones → Balm → Fabric API（1.20.1 Fabric）：开启自动前置时安装 3 个 jar，关闭时只装 Waystones；下载中心同样得到 3 个文件。此前 CurseForge 只会装 Waystones + Balm，漏掉 Fabric API。
- 0.13.8 版本窗口可随时关闭：之前 DownloadsPage、ModsModal、InstanceContentModal 的 `onClose` 在下载/安装进行中直接返回，点击关闭、X 或遮罩都没有反应，看起来像界面卡死。现在三个入口都允许关闭，正在进行的下载/安装继续在后台完成并照常弹完成提示；`ModVersionModal` 底部在忙碌时显示“正在处理，关闭窗口不会中断下载”。实测下载中心开始下载后 60ms 内点击关闭，版本窗口立即消失，底部忙碌提示正确；关闭后 `.part.seg0..11` 仍持续增长，约 16 秒后合并为 28,300,897 字节的 jar，分段文件自动清理，下载页也继续显示最终文件路径，确认后台下载与 UI 完成回调都没有被关闭动作打断。
- 0.13.9 模组下载加速：`DownloadOptions` 新增 `segmentMinBytes` 与 `probeSources`。模组/内容下载从 1 MB 起用 4 路分片，4/8/32 MB 以上仍按 8/12/16 路；`installFiles` 与 `downloadModFiles` 用 `mapWithConcurrency` 最多 3 个文件并发，结果顺序、已存在跳过、手动下载和失败语义保持不变（`uniqueFiles` 按文件名去重）。多候选且 ≥4 MB 时按 origin 做首字节测速，结果缓存 10 分钟并优先快线；无缓存/全部失败时保持原顺序。本地探针测试：300 ms 慢线和 0 ms 快线，慢线只收到 1 次探测、快线收到 2 次探测 + 8 个分片，5 MB 文件 426 ms 完成且 SHA1 正确。真实网络（当前线路很慢且波动大）：Iris 2.79 MB + Sodium 1.57 MB 用新逻辑 18.5 秒 / 29.4 秒；紧接着用 0.13.8 旧逻辑单连接串行下载同一组文件耗时 272.95 秒。Waystones → Balm → Fabric API 三文件并发安装 17.55 秒，三个 jar 与顺序均正确。`npm run test:download` 通过。
- 0.13.10 跨源结果提示：核对相同条件（1.20.1 + NeoForge + `ftb`）时 Modrinth 实际只有 6 个结果，CurseForge 有 19 个，PCL2 截图中的条目均标记 CurseForge，并非 Modrinth 检索缺失。DownloadsPage 在每次非翻页搜索成功后并行查询另一个数据源的总数，若对方更多则显示“Modrinth 当前 6 个；CurseForge 同一条件有 19 个”并提供一键切换；切换后保留关键词和版本/加载器，提示消失。实测 CF 19 条与 PCL2 列表一致，提示与切换正常。
- 0.13.11 跨源提示覆盖实例界面：`InstanceContentModal` 与 `ModsModal` 也加入另一个数据源的总数查询和切换；两处都增加搜索序号，丢弃过期响应。切换数据源改为显式处理，不再重置关键词；实例内容切换标签/重新打开才清空搜索框。实测 miao 同条件（1.20.1 Forge，关键词 FTB）：Modrinth 57 个，提示 CurseForge 163 个；点击后关键词保留、结果变为 163，提示消失。模组管理窗口同样验证通过。
- 0.13.12 双源合并搜索：新增 `renderer/lib/mergedSearch.ts`，同时请求 Modrinth 与 CurseForge，初始按各来源结果量决定交错顺序，按项目 slug 去重；返回两边总数、合并后的列表、是否还能加载以及单边错误。下载中心（模组/数据包/资源包/光影包/整合包）、实例内容、模组管理全部增加「全部来源」并默认使用；分页偏移每页 +20，两个来源同步翻页；单边失败时显示另一来源并给出黄色提示，两边都失败才整体报错。实测 miao 条件（1.20.1 Forge，FTB）：合并首屏 38 条（Modrinth 57 / CurseForge 163，重复 2 条已合并），加载更多后 68 条；模组管理同样 38→68；整合包默认空查询合并 38 条（Modrinth 1.9 万 / CurseForge 1 万）；数据包查询 `tower` 合并 40 条。切回单一来源仍保留关键词，并继续显示“另一来源更多”的提示。
- 0.13.13 加权交错排序：`searchDualSource` 从固定 1:1 改为按两边总结果量加权，权重 = 该来源结果数 / 较小来源结果数，限制在 1–3 之间；使用平滑加权调度（累计目标名额 - 已选数量，最大者先出，平手优先已选较少者），保证结果多的一边更频繁但不会被 3:1 以上完全淹没。所有已取到的命中仍全部保留，只改变顺序；去重仍在排序后按 slug 执行。实测 miao（FTB，Modrinth 57 / CurseForge 163）：前 16 条来源序列为 `CF, MR, CF, CF, CF, MR, CF, CF, CF, MR…`，首屏仍 38 条；总数与分页不变。
- 0.14.0 内容账本（只读阶段）：新增 `contentLedger.ts`、`ledger:scan` / `ledger:check` IPC 和 `instances/<id>/content-ledger.json`。扫描 mods/datapacks/resourcepacks/shaderpacks，按文件名+大小+mtime 缓存 SHA1 与 CurseForge 官方指纹；指纹算法取自 CurseForge 实际使用的 Murmur2 变体（固定忽略 9/10/13/32，长度取过滤后字节数，uint32）。识别顺序：Modrinth `POST /v2/version_files` 批量 SHA1 → CurseForge `POST /v1/fingerprints/432` 批量指纹（请求体必须是数字数组）→ 项目标题用 Modrinth `GET /v2/projects` 与 CurseForge `POST /v1/mods` 补齐，CF 批量失败时回退逐个项目页。更新检查按项目去重、并发 3，Modrinth 用新增 `latestModrinthVersionInfo`，CurseForge 用 `pickCurseForgeModFile`（Selection 增加 fileId/versionNumber），结果缓存 6 小时、识别失败 7 天后重试。UI 在实例内容里增加「已安装 / 搜索安装」切换，已安装视图有「全部 / 可更新」筛选、各分类徽标数量、当前版本 → 最新版本、刷新/强制检查按钮；全程只读，不修改模组文件。实测夹具：Iris 1.6.17 识别为 Modrinth 并提示更新 1.7.6，Waystones 经 CF 指纹识别且已是最新，随机 jar 标为本地/未知。真实 miao（308 个 mod，外部只读副本）：308/308 识别（207 Modrinth + 101 CurseForge），首次全量检查 78 秒发现 72 个可更新，无错误；再次打开直接命中缓存。5 个资源包未识别，保留为本地/未知。
- 0.15.0 内容安全更新：新增 `ledger:update` / `ledger:rollback` / `ledger:changelog` IPC、`instances/<id>/content-updates.json` 与 `instances/<id>/backups/content/<时间>-<随机>/`。`updateContent` 从磁盘账本重新校验每个选中项（必须仍有 `provider/projectId/versionId/latestVersionId` 且版本不同），只更新勾选内容；更新前复制原文件、调用 `markKnownGood()`，并把当时的 `diagnostics.json` 文本存入记录，然后删除旧文件并按 `latestVersionId` 调用 `installMod({ includeDependencies: true })`，新主文件与新增前置逐个写入 `addedFiles` 并即时保存；原文件若为 `.disabled`，新主文件也会保持禁用。成功后保留最近 6 份备份；失败则恢复原文件、删除新增文件、清理本次产生的未跟踪内容与 `.part`/`.part.json`/`.part.seg*` 临时文件，并恢复原 `diagnostics.json`。`mapWithConcurrency` 改为等待全部并发下载结束后再抛错，避免回滚时仍有下载写入目录。手动回滚只处理最近一条未回滚记录，不动更新后用户自己新增的文件。更新行显示当前→最新版本与新文件大小；点「更新日志」才调用 `ledger:changelog`（Modrinth `GET /v2/version/{id}`，CurseForge `GET /v1/mods/{projectId}/files/{fileId}`），前端按 `provider:project:version` 缓存，更新或回滚后自动收起。实测独立 1.20.1 Fabric 夹具：Iris 1.6.17→1.7.6 用时 10.5 秒并自动补装 Sodium 0.5.13，账本 2 项 current、`lastUpdate.canRollback=true`，备份含旧 Iris；手动回滚 1.4 秒恢复旧 Iris、删除新 Iris 与 Sodium，快照指纹回到旧值。阻断 Sodium 下载（用非空目录占位目标文件）触发 EPERM：返回 `ok:false, rolledBack:true`，已安装的新 Mod Menu 与未记录的 Iris 新 jar 都被清掉，本次 `.part`/`.part.json` 清除而更新前已存在的 `.part` 保留，两份原文件与诊断快照恢复。changelog 实测返回 1.7.6 文本、2.6 MB、发布日期与 Modrinth 页面链接。UI 的选中/更新栏、更新后回滚按钮、失败 toast 与日志面板收起均已验证；`npm run typecheck` / `npm run build` 通过。
- 0.16.0 更新进度与加载器更新：内容安全更新新增 `ContentUpdateProgress`、`ledger:progress` 事件和 `window.ccl.ledger.onProgress`，`updateContent` / `rollbackContentUpdate` 按 prepare / backup / snapshot / install / download / refresh / rollback / done 阶段上报百分比、文件数、已传输/总字节和当前文件；`InstallProgressHooks` 从 `installMod` / `installFiles` 透传到 `downloadFile.onBytes`，并发下载的原始重试字节在 1 个字节级别封顶到总大小，前端按事件差值计算平滑速度。实例内容底栏在更新/回滚时切换为进度面板，显示阶段、进度条、文件数与实时速度。新增 `instances:update-loader`（`updateLoaderForInstance` / `updateInstanceLoader`）：只允许非外部加载器实例，校验基础游戏文件后安装目标加载器档案，再原子更新 `instance.json` 的 `loaderVersion` / `versionId`；任务类型新增 `loader`，任务浮窗显示安装阶段与运行库下载进度，完成后刷新实例并提示。实例管理新增「加载器」区块和 `LoaderUpdateModal`：默认只列比当前新的版本和当前版本，可展开全部历史版本；相同版本不可选，外部实例与原版实例禁用。实测 Fabric 夹具 0.15.0 → 0.20.1：任务浮窗显示 4/8 个运行库与 627 KB/s，12 秒完成，`instance.json` 写入 `fabric-loader-0.20.1-1.20.1`，新版本目录生成；内容更新进度事件共 147 条，覆盖 prepare/backup/snapshot/download/rollback，`bytesDone` 从未超过 `bytesTotal`，失败后旧文件与 `.part` 清理逻辑不回归。`npm run typecheck` / `npm run build` 通过。Forge / NeoForge 加载器更新复用既有 installer 流程，但尚未在真实 Forge 实例上做更新回归；外部实例不支持加载器更新。
- 0.16.1 加载器一键回滚：新增 `LoaderRollbackState`、`instances:loader-rollback-state` / `instances:rollback-loader` 和实例目录 `loader-rollback.json`。加载器更新成功后写入 `from/to` 版本记录；实例管理加载器区块显示“可回滚到 …”和「回滚上次加载器」，点击后进入 `loader` 任务：旧档案存在时只切换 `instance.json`，缺失时按旧版本重新安装（含 Forge/NeoForge 的 Java 准备与运行库下载），成功后删除记录并刷新实例。读取状态时会校验当前 `versionId` / `loaderVersion` 必须仍等于记录中的 `to`，手动切过版本或记录损坏时按钮自动隐藏。实测 Fabric 夹具：0.15.0 → 0.20.1 后按钮出现；旧档案缺失时回滚任务 9 秒完成并重新下载运行库，旧档案存在时回滚 0 秒完成；两种路径都恢复 `fabric-loader-0.15.0-1.20.1`、删除 `loader-rollback.json`，任务浮窗标题为“回滚 Fabric 0.20.1 → 0.15.0”，完成提示为“加载器已回滚”。Forge / NeoForge 回滚复用同一实现，尚未做真实 Forge 实例回归；外部实例仍不提供回滚。
- 0.16.2 外部实例完整管理：加载器更新/回滚不再拒绝外部实例，安装目录从 `settings.gameDir` 改为 `instance.external.baseDir`（普通实例仍用 `settings.gameDir`）；基础游戏文件检查、Java 准备、旧档案检查与重装都走外部 baseDir，`updateInstanceLoader` 也放开外部实例。实例管理去掉外部实例的禁用态，并提示加载器会写入原启动器的 `versions` / `libraries`；「补全文件」对外部开放，使用 `external.baseDir` 只补缺失或损坏部分；删除仍只移除风信引用，确认文案明确不会改动原目录与存档。实测外部夹具：0.15.0 → 0.20.1 的档案写入 `external/mc/versions`（风信 `data/game/versions` 未变），回滚按钮出现并在旧档案缺失时重新安装 0.15.0，删除后 `data/instances` 为空而 `external/mc`、外部 mods 与 marker 文件保留。外部实例补全文件未执行完整大文件下载回归；Forge / NeoForge 外部实例更新/回滚未实测。
- 0.16.3 外部实例永久删除：`instances:remove` 增加 `deleteExternalFiles` 参数，`deleteInstance` 对外部实例先校验 `gameDir` 必须是 `baseDir\versions` 的直接子目录、目录名与实例 `versionId` 一致，并在 `realpath` 后再次确认没有指向 versions 之外或风信数据目录；通过后递归删除该版本目录（含 mods、config、saves），再删除风信实例引用。共享 `baseDir` 的 libraries、assets 与其他版本不会被删除。删除确认框对外部实例默认勾选「同时永久删除原整合包目录」，显示将删除的绝对路径和不可恢复提示；取消勾选则只移除风信引用。实测 ext-del：永久删除后版本目录消失，libraries/assets/shared-other 与另一外部实例保留；`versionId` 不一致的 ext-bad 被安全校验拒绝且两个目录都保留；取消勾选的 ext-bad 只移除引用、外部存档保留。外部实例启动中仍禁止删除。
- 0.17.0 预设模组：新增 `preset-mods.ts`、`preset-mods.json` 与 `presets:list/add/remove/set-auto/check/install` IPC。预设只保存项目身份（provider / projectId / slug / title / icon / author），不锁版本；管理入口在实例页顶部「预设模组」和设置 → 下载设置。安装/导入整合包完成后，`store.ts` 会等实例列表刷新再调用 `presets:check`；从本地实例导入时若选择了「添加并启动」，会跳过这次自动检查，避免在启动前或启动中改写 mods。检查阶段用并发 6 解析 `mods` 下 `.jar` / `.jar.disabled` 的 Fabric、Quilt、Forge、NeoForge 元数据和文件名，按 mod ID / 显示名 / slug 匹配；已包含项标为“已包含”，`.disabled` 标为“已禁用”且不重复安装。缺失项按实例的 `gameVersion` / `loader` 解析最新兼容版本：Modrinth 走 `latestModrinthVersionInfo`，CurseForge 走 `pickCurseForgeModFile`。确认框默认全选可安装项，可逐项取消；「以后自动安装」写入 `autoInstall`，开启后重新导入直接启动 `preset` 任务，不再弹窗。安装任务复用 `installMod` 的依赖解析与下载，`InstallProgressHooks` 新增 `signal`，任务浮窗显示第几个预设、当前文件、文件数、已传输/总大小和实测速度；完成 toast 区分“已补齐”与“有文件需手动下载”。修复 `pickCurseForgeModFile`：指定 fileId 时改为 `GET /v1/mods/{projectId}/files/{fileId}` 直查，旧文件不在最新 50 条列表时不再误报“CurseForge 没有找到所选文件”。实测 1.20.1 Fabric 夹具：含 Sodium 的整合包识别 1 个已包含、Iris 缺失；空实例识别 Sodium / Iris / JEI 缺失并解析出 3 个兼容版本，安装后 3 个 jar 均落到 `mods`，再次检查全部已包含；`.disabled` 识别为已包含且 enabled=false；外部整合包导入后自动弹出确认，开启自动安装后重新导入直接生成 `preset` 任务并完成 3 个文件。另用 Forge 夹具验证 `mods.toml` 只读取 `[[mods]]` 段：一个只是在 `[[dependencies]]` 里声明 Sodium 的模组不会被误判为已安装 Sodium，而真实 modId=sodium 的 jar 会识别为已包含。`npm run typecheck` 与 `npm run build` 通过；Forge / NeoForge 预设安装仅复用现有 installMod 路径，未做真实 Forge 整合包下载回归。
- 0.18.0 中文名与常用简称搜索：新增 `searchAliases.ts`，内置约 100 个常用模组/整合包的中文名、英文缩写、PCL 风格简称与常见别名（如 钠、机械动力、暮色、物品管理器、fapi、ae2、jei、mss、优化整合包、atm10），完全离线，不复制第三方数据库。主进程 `searchModrinthMods` / `searchCurseForgeMods` / `searchModpacks` / `searchCurseForgeModpacks` 在请求前调用 `expandSearchQuery(query, kind, loader)`：中文与简称先解析为目标项目和英文查询词，翻译后无结果时仅在首页回退原文；`SearchQueryExpansion.preferredSlugs` 用于把原项目置顶。为避免把不兼容的模组硬塞进结果，Modrinth 置顶前读取 `/v2/project/{slug}` 校验 `game_versions` / `loaders`，CurseForge 置顶前用 `slug` 参数查项目并校验 `latestFilesIndexes` 的 gameVersion / modLoader；不兼容时不置顶。`AliasVariant` 支持按加载器切换变体：「机械动力」在 Fabric/Quilt 下指向 Create Fabric、Forge/NeoForge 下指向 Create；「暮色森林」Forge 指向官方版、Fabric 指向非官方移植。搜索结果增加可选 `localizedName`，在下载中心、实例内容、旧模组管理、实例发现、预设管理、预设检查、模组版本弹窗中优先显示中文名并用 title 保留英文原名。`PresetModView` 同步缓存 `localizedName`，旧预设读取时自动补齐。实测 Modrinth/CurseForge：钠 → Sodium，物品管理器 → JEI/REI，fapi → Fabric API，ae2 → Applied Energistics 2，bop → Biomes O' Plenty，ie → Immersive Engineering，农夫乐事 → Farmer's Delight，小地图 → Xaero's Minimap；机械动力在 Forge 置顶 Create、Fabric 置顶 Create Fabric；mss 在 Forge 置顶官方 Twilight Forest、Fabric 置顶非官方版；直接置顶的项目均先通过版本/加载器校验。`npm run typecheck` 与 `npm run build` 通过；索引为常用集合，未收录中文名的模组仍按英文原名/slug 搜索。
- 0.19.0 输入法搜索与 MC百科别名导入：内置词表补充「输入法 / 输入法冲突 / 输入法修复 / 输入法冲突修复」→ `IMBlocker`，并加入 IMBlocker、IMBlockerFabric、InputMethodBlocker、IngameIME、ContingameIME、Roughly Enough Input Methods 的中文显示名；搜索「输入法」在 Fabric / Forge 下返回 IMBlocker / IMBlockerFabric。没有直接抓取 MC百科搜索页：`search.mcmod.cn/robots.txt` 明确 `Disallow: /s`，且 PCL 实际使用离线 mcmod 翻译快照而非实时接口。改为新增 `customSearchAliases.ts` + `mcmodAlias.ts` + `search-aliases.json`：用户在设置 → 下载设置 →「中文搜索别名」粘贴 MC百科 class 模组页链接（如 `https://www.mcmod.cn/class/3358.html`），只请求该允许的 class 页面，解析中文名、英文查询词和 CurseForge / Modrinth 链接，写入本地别名并立即注册到搜索索引；启动时自动加载，支持查看来源与移除。`AliasSeed` 增加按来源的 `curseforgeSlugs` / `modrinthSlugs`，`translatedResult` 会生成 `preferredSlugsByProvider`，Modrinth / CurseForge 置顶时各用自己来源的 slug；自定义别名优先于同词内置项。新增 IPC `search-aliases:list/import-mcmod/remove`、preload `window.ccl.searchAliases` 和设置页管理弹窗。实测：搜索「输入法」返回 IMBlocker / IMBlockerFabric 并显示中文名；导入 class 840 后搜索「通用拼音搜索」命中 Just Enough Characters 的 CurseForge 与 Modrinth 项目，重启仍生效；移除后搜索恢复为空；非 mcmod.cn 链接被拒绝。`npm run typecheck` 与 `npm run build` 通过；只读取用户主动粘贴的 class 页面，不批量扫描、不请求 MC百科搜索页。
- 0.19.1 拼音搜索与 CurseForge 中文噪声：内置词表加入 Just Enough Characters（通用拼音搜索，CurseForge slug `just-enough-characters` / Modrinth slug `justenoughcharacters`），别名「拼音 / 拼音搜索 / 拼音输入 / jech / jechars」。现象根因是 CurseForge 对未解析的中日韩搜索词不会真正过滤，而是回退成按热度排序的全量列表（实测 `searchFilter=拼音` 返回 total 10000，首项 GeckoLib），因此搜索「拼音」时 Modrinth 无结果、CurseForge 返回一堆热门 API/优化模组。修复：`searchCurseForgeMods` / `searchCurseForgeModpacks` 在 `expandSearchQuery` 未翻译出英文词且原文含 CJK 时直接返回空；翻译后无结果也不再回退原文中文查询。实测 1.21.1 NeoForge 搜索「拼音」：Modrinth 与 CurseForge 各返回 1 条 Just Enough Characters 并显示「通用拼音搜索」；「火星模组」「完全不存在的中文词」在 CurseForge 返回 0 条，不再出现热门模组噪声。`npm run typecheck` 与 `npm run build` 通过。
- 0.19.2 中文短词多候选：`fuzzyAliasEntries` 不再在多个中文别名分数接近时返回 null，而是保留前 6 个接近最高分的候选；`multiAliasResult` 保留原文查询（继续拿 Modrinth 标题/简介中真实含该词的项目），同时把多个已知项目按来源 slug 一起置顶。CurseForge 仍因中文过滤失效而跳过 API，只返回本地候选。实测「通用」在 1.21.1 NeoForge：Modrinth 返回 4 条（Mekanism/通用机械、Just Enough Characters/通用拼音搜索、Mekanical Create/通用动力、Universal Darkness/通用黑暗），CurseForge 返回 2 条（通用机械、通用拼音搜索）；不再只显示两条无关的 Modrinth 中文标题项目。`npm run typecheck` 与 `npm run build` 通过。
- 0.19.3 MC百科 class 页面转本地别名表：新增独立脚本 `scripts/mcmod-alias-import/index.mjs`（`npm run aliases:mcmod`），支持数字 ID、完整 class 链接、`--input` 文本列表、`--html-dir` 本地 HTML、`--output` / `--data-dir`、默认 700ms 请求间隔、8 秒超时、失败重试和与已有输出合并；只读取 class 页面，不请求搜索页、不遍历站内页面。输出格式为 `{version:1,items:[CustomSearchAlias]}`，默认 `mod-aliases.json`，最多 30000 条。App 侧 `customSearchAliases.ts` 新增 bulk 文件加载：启动时同时读取 `search-aliases.json`（界面管理，最多 200，优先级 2）和 `mod-aliases.json`（批量表，最多 30000，优先级 1），与内置词表（优先级 0）合并注册；`exactAliasEntry` 按优先级选择，用户别名覆盖批量表和内置项。批量表不在设置弹窗逐条渲染，避免几万行 DOM；重新生成后重启风信生效。实测脚本：840 + 3358 生成两条，再转换 4006 正确合并为 3 条；`--html-dir` 离线解析保存页面并恢复 `mcmod-<id>`。另生成 25000 条合成批量表测试启动与索引，替换一条真实 class 4006 后搜索「游戏中中文输入法冲突修复」能置顶 Modrinth `inputmethodblocker`，查询约 0.7 秒（含网络请求）。`npm run typecheck` 与 `npm run build` 通过；脚本和批量表都需遵守 MC百科 BY-NC-SA 3.0，不抓搜索页。
- 0.20.0 PCL 式中文本地长列表：`searchAliases` 新增 `substringAliasEntries`，中文查询（2 字以上）在精确别名之后先扫描所有内置/界面/批量别名的中文名称包含匹配，不再只保留最高分候选或只看前缀；最多 20 条，按“名称前缀、优先级（用户 > 批量 > 内置）、中文名长度、文件顺序”排序。`multiAliasResult` 保留中文原文查询（继续拿 Modrinth 标题/简介里真实含该词的项目），同时把本地候选逐个置顶；`applyModrinthPins` / `applyCurseForgePins` 的置顶上限从 6 提到 20，并改为 4 并发直接查询项目详情，给结果补齐图标、简介、下载量、来源。CurseForge 仍跳过中文 API 搜索，只返回本地候选。实测用 10 条真实 `通用*` 别名组成 `mod-aliases.json`：无版本过滤时 Modrinth 15 条、CurseForge 10 条；1.21.1 NeoForge 下 Modrinth 11 条、CurseForge 10 条，包含通用机械、通用机械发电机/工具、通用拼音搜索、应用能源：通用机械附属、通用机械附加、通用骨粉、精致存储：通用机械集成、妖怪之山通用库、通用附属等，结果带中文名、图标、简介、下载量和来源，单源查询约 1.6–2.1 秒。没有批量表时只覆盖内置约 100 个名称；`npm run typecheck` 与 `npm run build` 通过。同一版本为别名脚本增加 `--pcl-buf`：读取本机 PCL 的 `Resources/mcmod.buf`（gzip + protobuf），提取 `WikiId/ChineseName/CurseForgeSlug/ModrinthSlug`，离线生成 8976 条 `mod-aliases.json`，不联网、不分发；实测真实数据目录导入后，1.21.1 NeoForge 搜「通用」Modrinth 14 条、CurseForge 11 条，UI 已呈现 PCL 式长列表（通用机械、通用附魔、通用骨粉、通用终端、通用数据、通用拼音搜索等）。
- 0.21.0 中文排序、跨源去重与本地分页：`searchAliases` 的 `substringAliasEntries` 改为 PCL 式加权相似度排序，基础分 450；中文名完全一致 1000，名称前缀 800 + 匹配覆盖率 0–80，名称中间包含 620 + 覆盖率 0–80 + 匹配位置修正 0–40，再叠加短名称 0–20 和别名优先级（用户 2 / 批量 1 / 内置 0，每级 5 分，上限 20），依次按分数、优先级、名称长度、文件顺序排序。新增 `findLocalAliasMatches(query, provider, offset, limit, loader, kind)`：去掉「模组」后缀后在本地最多 200 个中文别名里按上述顺序取匹配项，按来源选 CurseForge / Modrinth slug（缺失时回退通用 slug），返回 `total`、当前页 `slugs` 与 `localizedNames`，供 `searchModrinthMods` / `searchCurseForgeMods` 分页使用；中文查询的本地结果每页 20 条，详情查询保持 4 并发，`totalHits` 使用本地总数，`nextOffset = offset + 20`，加载更多时继续按同一排序取下一批，不再固定只返回前 20 条。`ModrinthSearchView` / `ModSearchView` 新增可选 `nextOffset`，远端 API 路径也统一返回它；`DownloadsPage`、`ModsModal`、`InstanceContentModal`、`PresetModsModal` 的单源分页改为 `result.nextOffset ?? offset + result.hits.length`，避免本地结果与远端结果混用时跳条。跨源合并的 `mergedSearch` 去重键从项目 slug 改为 `${provider}:${slug}`，各 UI 的本地去重键同步改为 `${project.provider}:${project.slug}`；同一项目在 Modrinth 与 CurseForge 同时命中时保留两行并分别标注来源。实测真实 8976 条别名、1.21.1 NeoForge 搜索「通用」：本地共 62 条，Modrinth 第一页 12 条、`nextOffset=20`，第二页 10 条、`nextOffset=40`；CurseForge 第一页 11 条、第二页 11 条，单页查询约 2–4 秒。预设模组搜索「全部来源」首屏 31 行，底部显示「共约 124 个结果，已显示 31 个」；加载更多后 62 行且仍可继续，Modrinth 与 CurseForge 的同项目两行都保留。`npm run typecheck` 与 `npm run build` 通过。
- 0.22.0 拼音搜索：新增依赖 `pinyin-pro@3.29.5`（MIT），并在 `electron.vite.config.ts` 中用 `externalizeDepsPlugin({ exclude: ['adm-zip', 'pinyin-pro'] })` 把它打进主进程 bundle。`searchAliases` 新增 `PinyinForm` / `PinyinIndexEntry`、`normalizePinyinQuery`、`pinyinFormsFor`、`pinyinAliasIndex`、`pinyinEntryScore` 和 `findPinyinAliasMatches`：对别名表中所有含中文的名称/别名生成全拼、首字母和音节边界；支持全拼精确、全拼前缀、从音节边界开始的词中匹配、首字母精确/前缀；`ü` 统一为 `v`，查询会去掉大小写、空格、声调和标点。索引惰性构建并缓存在主进程，`registerCustomSearchAliases` 时失效；真实 8976 条别名、26713 个表单构建约 130ms。拼音分数：全拼精确 1000，全拼前缀 880+覆盖率，词中音节边界 700+位置修正，首字母精确 840，首字母前缀 760+覆盖率，再叠加名称长度与别名优先级；最多取 200 个候选，复用 `localAliasPage` 按 provider 拆 slug 和中文名，每页 20 条。为避免英文误判，2–3 个字母的查询只接受完整全拼或完整首字母；已知英文别名或 `GENERIC_INDEX`（如 `jei`、`fps`、`sodium`、`create`）仍走原 API 路径。`searchModrinthMods` / `searchCurseForgeMods` 在中文本地匹配为空时尝试拼音本地匹配，命中则直接返回本地候选（仍按游戏版本/加载器校验并补详情）。界面提示改为“支持中文、拼音或简写”。实测 1.21.1 NeoForge：`typyss` / `typy` / `tongyongpinyin` → 通用拼音搜索（各来源 1 条），`shurufa` → REI 输入法搜索 + 输入法冲突修复，`lvbaoshi` / `lǜbǎoshí` → 绿宝石工艺，`dongli` → 机械动力，`jixiedongli` 本地 199 条、首屏 Modrinth 14 / CurseForge 15；`JIXIEDONGLI`、`ji xie`、`jīxiè` 和带空格查询均正常；`map`、`mod`、`gun`、`lib` 回归为正常英文 API 搜索。下载中心 Mod 页输入 `typyss` 实测返回两行「通用拼音搜索」，分别标注 Modrinth 与 CurseForge。`npm run typecheck` 与 `npm run build` 通过。
- 0.23.0 服务器 MOTD 与在线玩家：`ServerStatus` 新增 `playersSample: ServerPlayerSample[]`，`serverPing.normalizeStatus` 解析 SLP `players.sample`，最多 24 个，名称去控制符并截断 32 字符，UUID 统一为 32 位小写，按 UUID/名称去重；没有样本或服务器离线时保留空数组。`ServersPage` 在详情中加入 MOTD 面板：按 Minecraft 颜色码显示彩色 MOTD、地址、ONLINE/OFFLINE/UNKNOWN 状态、实测延迟、人数、版本和协议；离线显示错误原因，未知显示等待探测。新增「在线玩家」区：展示公开样本的头像与名称，点击复制玩家名，头部显示公开样本数和总在线人数，并带单独刷新按钮；使用现有 `Avatar` 组件按 UUID 读取 Mojang 公开皮肤，离线 UUID/失败时回退本地像素头像。Hypixel 的 SLP 样本为 0，会显示「未公开名单」；本地 Paper mock 返回 8 个样本/42 在线，浅色与深色主题均验证；离线 `127.0.0.1:25598` 显示 OFFLINE 和连接拒绝原因。样式集中在 `servers.css` 的 `.dossier-screen*` / `.dossier-roster*` / `.dossier-player*`，复用纸墨主题变量。`npm run typecheck` 与 `npm run build` 通过。
- 0.23.1 服务器 MOTD 浅色纸面板与像素头像：`ServerMotd` 新增 `tone?: 'dark' | 'light'`，默认深色供添加/编辑弹窗的状态屏使用；详情面板传 `tone="light"`，使用独立浅色 Minecraft 调色板，白色文字映射为墨色，自定义 hex 颜色在浅纸面上自动压暗到可读亮度。`.dossier-screen` 从黑底终端改为浅色纸张面板：外层深线 + `::before` 内层细线形成双线框，深色主题下使用稍暗的纸色，仍是纸张卡片。回退头像从随机噪点改为 `PixelAvatar`：12×12 SVG，8 套手绘肤色/发色背景、4 种发型、5 种配饰（无/眼镜/耳机/帽子/围巾），按名字或 UUID 稳定生成；真实 Mojang 皮肤加载成功后仍优先显示。实测浅色、深色主题，8 人样本和 baka 真实样本显示正常，点击复制名称仍可用。`npm run typecheck` 与 `npm run build` 通过。
- 0.24.0 LittleSkin 玩家皮肤兜底：`skins.ts` 新增 `getPlayerSkinDataUrl(name, uuid)`，先按 UUID 查 Mojang；离线 UUID（UUID 版本 3）跳过 Mojang，或在 Mojang 无皮肤时按玩家名请求 `https://littleskin.cn/skin/<encodeURIComponent(name)>.png`。只接受 64×64 或 64×32 且带 PNG 签名的原始皮肤，缓存到 `cache/skins/littleskin-<sha1(name)>.png`（内存 10 分钟、磁盘 2 小时，404 仅内存负缓存）；名字限制 32 字符并过滤非法字符，只发送玩家名，不发送服务器地址或账户凭据。新增 IPC `servers:player-skin`、preload `servers.playerSkin(name, uuid)` 与 `PlayerAvatar` 组件；Mojang/LittleSkin 皮肤成功后用 `SkinAvatar` 渲染，仍失败才用 `PixelAvatar`。实测 `Notch`（无 UUID）走 LittleSkin，`jeb_`（Mojang UUID）走 Mojang，`PixelFox` 无皮肤回退像素头像，`Inkwell` / `PaperPlane` / `Windletter` 从 LittleSkin 取到皮肤，`Anonymous Player` 无记录时回退；服务器 roster 标题的 tooltip 说明皮肤来源。`npm run typecheck` 与 `npm run build` 通过。
- 0.24.1 公开皮肤兜底池：Mojang 与 LittleSkin 都没有记录时，`FALLBACK_SKINS` 从 MHF_Steve、MHF_Alex、jeb_、Grumm、LittleSkin Grumm、LittleSkin Herobrine 中按 `sha1(name + uuid)` 稳定挑选，不再直接显示像素头像；各候选仍走现有 Mojang/LittleSkin 缓存，失败自动尝试下一个，全部不可用才回退 `PixelAvatar`。选用 MHF 默认皮肤和干净公开皮肤，避免 Notch/Dinnerbone 等在 26px 下偏黑或空白；PixelFox、MoonCraft、Anonymous Player、NoSuchUser98765 均显示真实头像，重复请求结果稳定；Notch 仍优先使用 LittleSkin 精确皮肤，jeb_ 仍优先 Mojang。`npm run typecheck` 与 `npm run build` 通过。
- 0.52.0 KubeJS 标签生成器：新增 `KubeJsTagBuilder.tsx` + `kubejs-tag.css`，右栏增加「标签」页（第 6 个 tab；≤1180px 隐藏装饰图标以保证不溢出），组件常驻隐藏以保留草稿。标签类型可用 datalist 选 item/block/fluid/jei 或自定义；标签 ID 可手动输入或搜索索引已有标签，选择后显示索引中已有成员数和前 12 个成员图标/ID。操作模式支持添加成员、移除成员、清空标签；前两者用物品/标签选择器增删成员（最多 24），自动生成单成员字符串或多成员数组；清空只生成 removeAll。生成前校验类型、标签 ID、成员 ID；实时预览、插入光标/替换选区，不自动保存；标签搜索和成员搜索都支持索引未建立时手动输入，并可跳知识页。实测真实 miao 只读：`forge:ingots` 116 个成员，添加 iron_ingot + #forge:ingots/ironwood 生成多成员 add，切换 remove/removeAll 正常，生成代码预检 0 问题；成员图标、标签搜索结果和配方/标签草稿切换保留正常；未调用 AI、未保存真实脚本。安装包 `D:\WindletterOut\Windletter-Launcher-0.52.0-setup.exe`，SHA256 `0ad56c542f74bc9c485279a01fb64c598e470b1842f55f358188f06c01d57a3a`，安装后 ProductVersion 0.52.0.0；从 `D:/WindletterBuildTmp052` 打包并删除临时目录。只读资源预览和备份保留策略仍未做。
- 0.60.2 启动器自更新：`LauncherSettings` 新增 `autoCheckUpdates`（默认 true）和 `updateFeed`（默认空）；`LauncherUpdateState` / `LauncherUpdateInfo` / `LauncherUpdateProgress` 描述 idle/checking/up-to-date/available/downloading/verifying/ready/installing/cancelled/error 状态。新增 `src/main/core/updater.ts`：只允许 HTTPS（本机 localhost/127.0.0.1/[::1] 可用 HTTP），更新源支持目录或 `latest.json`；清单要求 schema 1、app=windletter、版本号、URL、大小（1MB–2GB）和 SHA-256，最多 20 条说明、5 个备用镜像、512KB 清单上限；版本比较支持 prerelease。下载复用 `downloadFile` 的 Range 断点与分片，按实际字节上报速度/百分比，取消保留 `.part`/`.part.segN`；完成后重新核对大小并流式计算 SHA-256，失败删除安装包；安装前再次校验，然后用 `--updated /S --force-run` 启动 NSIS 并退出。新增 IPC `updater:state/check/download/cancel/install`、preload `updater` 与事件 `updater:state`。更多页新增 `LauncherUpdateCard.tsx` + `launcher-update.css`：当前版本、启动检查开关、更新源输入、检查/下载/取消/安装、实测进度与 ETA、更新说明和发布页；启动 1.4 秒后静默检查，发现新版本时导航「更多」显示角标并 toast；游戏运行时禁用安装并提示不会关闭游戏。`net.ts` 的 UA 改为启动时写入真实版本。新增 `scripts/make-update-manifest.mjs` 与 `npm run update:manifest`。实测 0.60.0 → 0.60.1 → 0.60.2，本地限速源约 8MB/s 支持 Range：手动检查和 1.4 秒启动检查均命中清单；下载显示 22.4%、25.0 MB/111 MB、7.2 MB/s、剩余约 12 秒；取消留下 16 个分片，继续时从 1081344、8412160 等偏移续传，SHA-256 与清单一致；错误 SHA 在下载后被拒绝并删除，错误状态不显示虚假 100%；不可达地址显示友好错误；安装后启动器退出，NSIS 保留安装目录静默升级并在约 20 秒后自动打开 0.60.2，数据与配置保留、新版本再次静默检查；关闭启动检查后重启无清单请求。浅色/深色、1000/1180 布局与错误/取消/就绪状态正常。安装包 `D:\WindletterOut\Windletter-Launcher-0.60.2-setup.exe`，SHA256 `78601618f6940e5a84de8cb10e04950f08fb653a09bdc9166604df421370db68`；同目录 `latest.json` 为相对文件名清单，发布时与安装包一起上传到 HTTPS 目录。未做代码签名与增量更新。
- 0.59.0 AI 更新解读：`ContentUpdateChange` 增加可选 `provider`/`projectId`，更新记录写入来源；`ContentLedgerUpdateSummary` 增加 `changes`，`getLatestContentUpdate()` 暴露最近一次未回滚记录的变更/addedFiles。新增 `src/main/core/updateExplain.ts`：本地摘要按模组/资源包/光影/数据包分组列出 from→to；AI 启用时仅在显式 IPC 调用中读取最多 8 条更新日志（每条 1500、总计 12000 字符），payload 只有实例 gameVersion/loader/loaderVersion、更新时间和最多 24 项 kind/title/from/to/changelog，不含文件、账户或脚本；AI 禁用、超时、网络失败、HTTP 错误或无内容均降级本地摘要并带警告；返回 `ContentUpdateAiSummary`（summary/model/localOnly/warnings/sentBytes/generatedAt）。新增 IPC `ledger:explain-update`、preload `explainUpdate`。实例内容页在 `ledger.lastUpdate` 存在时显示「更新解读」，`ContentUpdateSummaryModal.tsx` + `update-explain.css` 显示更新时间/数量/回滚状态/变更列表，打开时不发请求；显式「用 AI 解读」后才请求，并显示模型/发送字节/警告；Esc 只关闭解读弹窗（外层 `closeOnEscape` 增加 `!updateSummaryOpen`）。实测隔离实例 3 项（2 模组+1 资源包）：打开弹窗 mock 请求 0，点击后 1，发送 623 B，payload 边界正确，mock 返回三段摘要和“缺少在线更新日志”警告；停 mock 后降级本地摘要+连接失败；关闭 AI 后本地摘要+未调用 AI；Escape/浅色深色/1000/1180 正常。打包解包版验证后安装，ProductVersion 0.59.0.0；安装包 `D:\WindletterOut\Windletter-Launcher-0.59.0-setup.exe`，SHA256 `7a7a5c2f6a303655f2645279908080a7433c93145f80b875e39904cec78b93f0`。
- 0.58.0 KubeJS 问题一键修复：`KubeJsIssue` 增加可选 `fix`（`KubeJsIssueFix`：`replace` 带 original/replacement/title，`move-file` 带 targetPath/title）。`kubeJsDiagnostics.ts` 的 IssueCollector 支持挂 fix，并为 `unknown-event-group`/`unknown-event`/`unknown-method` 的确定性 suggestion、`undefined-event` 的回调参数名、`wrong-side` 的 scripts 目录移动生成修复；未找到 ID、语法和自定义 JSON 不生成 fix。新增 `sideScriptPath()` 把 wrong-side 映射到 server/client/startup_scripts 同相对路径。渲染层 `KubeJsProblemsPanel` 支持当前文件「一键修复 N」：弹窗按项勾选、`applyFixItems()` 校验原文/范围/重叠并生成 after，复用 `DiffView` 预览；应用通过编辑器新增的 `applyChanges()` 一次事务修改，标签变脏但不自动保存，内容变化时拒绝覆盖。问题行显示「可修复」或「移动到 xxx_scripts」按钮；移动复用 `kubejsRename`，更新标签/当前路径/诊断/文件树，脏文件先提示保存。全项目模式提示修复在当前文件进行；使用说明补充一键修复与脚本侧移动。实测隔离夹具 fixable.js 4 项（ServerEvent→ServerEvents、event→e、recipe→recipes、shapped→shaped）：弹窗全选 +4/−4 diff，取消第 4 项后应用 3 处、磁盘不变；重检后出现 remov→remove、shapped→shaped 可继续修复；client_scripts/wrong.js 移动到 server_scripts/wrong.js 后文件树/标签更新且问题清空；undefined event 修复为 e 且未写盘；浅色/深色与 1000/1180 宽度正常。打包解包版验证后安装，ProductVersion 0.58.0.0；安装包 `D:\WindletterOut\Windletter-Launcher-0.58.0-setup.exe`，SHA256 `678b2e55d900f54ee5152e6461351a0f9c5ee764e343b482287ab119df82538e`。
- 0.57.0 统一备份保留与备份管理：`LauncherSettings` 新增 `kubeJsBackupLimit`（默认 50，1–500）、`contentBackupLimit`（默认 6，1–30）和 `backupMaxAgeDays`（默认 0 不限，0–3650），世界继续用 `worldBackupLimit`（1–30）。`worldVault.ts` 的 `WorldVaultContext` 增加 `maxAgeDays`；`pruneBackups` 同时按份数和天数删除并返回删除项；备份后仅清理对应 kind，恢复后改为三类分别清理，避免恢复安全备份挤掉手动备份；新增 `pruneWorldBackupsForInstance`、`listAllWorldBackups`。`packWorkshop.ts` 在每次 `backupKubeJsFile` 后按设置自动 `pruneKubeJsHistory`（新增 maxAge、删除字节、清理空 stamp 目录；扫描上限提高到 20 万，历史面板仍默认 3000）；`pruneKubeJsHistory` 结果增加 `bytes`。`contentLedger.ts` 的内容更新备份保留数改为设置值并支持 maxAge，返回删除数量/字节；新增 `forgetContentUpdateBackups` 供手动清理时同步移除 `content-updates.json` 回滚记录。新增 `src/main/core/backupManager.ts`：扫描每个实例 `backups/worlds|kubejs|content` 及未知旧目录，统计数量/大小/新旧时间；清理支持 `policy`（世界每类、KubeJS 每文件、内容每实例份数 + 全局天数）、`older-than`（默认 30 天）和 `all`，内容清理会同步回滚记录，未知目录只统计不删。新增 IPC `backups:overview`/`backups:cleanup`、preload `backups` 和类型 `BackupOverview`/`BackupCleanupRequest`/`BackupCleanupResult`。设置页「存档备份」改为「备份管理」，新增 KubeJS/内容份数与最长天数控件、入口按钮；新增 `BackupManagerModal.tsx` + `backup-manager.css`：总占用、三类选择卡、实例过滤、重新统计、三种清理（确认框）、实例占用列表；实例卡片操作区加入「备份管理」图标；KubeJS 历史清理弹窗改用统一设置。实测隔离夹具 2 实例/7 世界/5 KubeJS/5 内容/4.9 KB 其他，概览 17 份 28,071 B；7 天前清理删除 5 份 7,028 B；按策略再删 1 份内容并把回滚记录 4→2；内容全删后记录 0；世界自动备份 3→2、KubeJS 保存 4 次/文件→2、5 天前 KubeJS 旧快照下次保存自动删除；世界 policy 最长 1 天只留新备份；删除实例后备份目录全部消失；份数设置即时落盘；浅色/深色与 1000/1180 px 布局正常。打包解包版验证后安装，ProductVersion 0.57.0.0；安装包 `D:\WindletterOut\Windletter-Launcher-0.57.0-setup.exe`，SHA256 `9d7a45ae1933d4de62b2de0e50d58cfd4e92b5abc39f6253940847ec37ae6a61`。加载器回滚仍使用 versions 旧档案，可在首页清理中回收，不占 backups。
- 0.56.0 原版实例：新增 `VanillaInstanceRequest`、`instances:create-vanilla` IPC/preload `createVanilla` 与 store `createVanillaInstance`。`loaderInstances.ts` 把基础版本检查/下载抽成 `ensureBaseVersion`，新增 `assertVanillaProfile`（继承父版本的加载器档案拒绝创建）与共享的 `createInstanceRecord`；`createVanillaInstance` 在版本文件缺失时先调用既有 `installVanillaVersion`，完成后写入 `loader=vanilla`、`versionId=<gameVersion>`、`summary=Minecraft X · 原版` 的实例，只创建 `instances/<id>/minecraft/mods`。删除 `loader=vanilla` 实例时 `cleanupVersionsAfterInstanceDelete` 直接返回空，版本文件交给版本管理清理。下载页「原版（不装加载器）」改为创建独立实例，保留次级「只下载游戏文件，不创建实例」；状态区分已安装/不完整/需下载。实例页顶部与空状态新增「新建原版实例」，新组件 `VanillaInstanceModal.tsx` 支持已安装原版直接创建、在线版本（正式版/快照/全部筛选、搜索、40 条分页与总数、自定义名称）、缺失时提示先下载；实例卡片新增「原版」标签。`VersionPicker`、`HomePage`、`HomePageClassic` 的基础版本管理集合改为按当前版本文件夹匹配所有实例，原版实例接管的版本不再同时出现在版本列表；补全实例任务补 `instanceId`，store 在 install 任务完成后优先回到对应实例，避免当前目标跳到被隐藏的版本。`loaderLabel` 增加 `vanilla → 原版`。实测隔离数据目录 + 真实 26.3 版本文件：下载页与实例页两条创建路径、已安装/在线选择、筛选 40/102、搜索 1.21.1 3 条、分页、自定义名称、实例记录/目录、删除后版本保留、继承版本拒绝、补全后目标保持、版本列表去重、980/1000/1180 浅色与深色布局均正常。旧 alpha `rd-132211` 下载在 BMCLAPI/官方源均因上游 404 未完成（既有下载源问题）。打包解包版与安装版 0.56.0 验证通过，ProductVersion 0.56.0.0；安装包 `D:\WindletterOut\Windletter-Launcher-0.56.0-setup.exe`，SHA256 `ee435b4a48ebb8d01d3f8f0b86dae4904424dd055447faaeac32b90675d58c23`。
- 0.55.0 AI 配方 / 物品问答：新增 `src/main/core/kubeJsQa.ts` 和 `KubeJsQaPanel.tsx` + `kubejs-qa.css`，工作台右栏新增第 7 个「问答」标签（≤1180px 隐藏装饰图标，7 个标签在 330px 内不溢出），组件常驻隐藏保留对话。`getKubeJsQaContext()` 在静态索引里检索：从 `assets` 的 `zh_cn` 补齐原版中文名；按物品中文/英文/ID、配方 ID/type/输出/输入、标签成员和 tag 引用筛选，配方优先主物品与原版配方，标签问题只保留直接包含或引用了该物品标签的标签；最多 8 物品/10 配方/6 标签作为引用。新增 IPC `workshop:kubejs-qa`/preload `kubejsQa`；只把问题与检索片段发给已启用 AI（`max_tokens` 1200、temperature 0.15、60s 超时），请求不含账户、脚本或密钥。AI 未启用、网络失败、非 2xx 或格式异常时自动返回本地检索结果并给出提示；AI 回答提到索引外 ID 时会警告。UI 支持建议问题、Ctrl+Enter 提问、清空、物品图标、物品/配方/标签分组、复制 ID、只读提示；答案先显示，引用可滚动。说明弹窗增加「AI 配方 / 物品问答」第 10 个分区。实测真实 miao：铁锭问答 4/10/6 且优先原版熔炉/高炉；圆石 8/10/6；铁锭标签返回 balm:iron_ingots、forge:ingots、ae2:metal_ingots 等；粘贴配方 ID 只返回该配方；未知问题本地空结果。本地 127.0.0.1:9876 mock（未调用真实 AI、未读取真实 ai.json）：打开页面请求计数 0，点击提问后 1；请求只含 question/items/recipes/tags；未知 ID 警告、mock 停止后的本地降级均正常；打包解包版 0.55.0 验证通过。另修复知识页流体类动画贴图把图标撑成长条、遮挡多行的问题：`.kjs-index-tile` 固定 25×25 + `overflow:hidden`，`img` 改为 absolute 铺满并按首帧裁剪；ATM11 的 16×320 `molten_allthemodium_still.png` 实测图标 25×25、图片 24×24。安装包 `D:\WindletterOut\Windletter-Launcher-0.55.0-setup.exe`，SHA256 `bbeed60f8b1a481ee342306d0988a46dc94f90bbcd98eb4218de7521a9447d5f`；已安装并验证 ProductVersion 0.55.0.0，安装版问答页/7 个右栏标签/10 个说明分区/ATM11 图标 25×25 正常。剩余可选备份保留策略与自更新。
- 0.54.1 资源预览入口可发现性：实例卡片在「内容」旁新增「资源」按钮，直接打开实例内容的资源包标签；`InstanceContentModal` 新增 `initialTab` 参数，资源按钮传 `resourcepack`，普通「内容」仍保留上次标签。资源包/光影包/数据包行尾从单独眼睛图标改为带「预览」文字的按钮（主题色边框），点击进入 0.54.0 的只读预览。实测 miao 卡片显示「启动/内容/资源/存档/截图/目录」，点「资源」直接进入资源包标签，5 个资源包都显示「预览」按钮且能打开预览；打包解包版 0.54.1 验证通过。安装包 `D:\WindletterOut\Windletter-Launcher-0.54.1-setup.exe`，SHA256 `e5dbc098eaf1243484effb4f9b44950718c2be9810998f4935d507f9413eadf3`；当前运行的 0.54.0 未强制关闭，安装 0.54.1 后生效。只读资源预览完成；剩余可选备份保留策略与自更新。
- 0.54.0 只读资源预览：新增 `src/main/core/contentPreview.ts`、`ContentPackPreviewModal.tsx`、`content-preview.css`，实例内容页的数据包/资源包/光影包行增加预览按钮。后端只允许当前实例 `resourcepacks`/`shaderpacks`/`datapacks` 目录内的 ZIP，读取 `pack.mcmeta`（pack_format/描述/1.21 min-max）、根 `pack.png`、目录树和单文件；单 ZIP ≤256MB、图片/音频 ≤8MB、文本读取 ≤2MB 且预览前 256KB，目录单页 ≤1000 项，路径搜索 ≤100 条；IPC `ledger:preview-pack/dir/file/search` 只读并拒绝路径穿越，AdmZip 单缓存。UI 支持懒加载目录、路径搜索、文本/图片/音频/二进制预览、16px 贴图放大到 320px、棋盘格背景、复制路径、浅/深色主题，嵌套 Esc 只关闭预览层。实测真实 miao 1.20.1.zip（5.3MB、3,515 文件、20.3MB 解压后）读取 pack_format 15、合并描述和 640×640 pack.png；目录、pack.mcmeta、LICENSE/README、图片和 zh_cn 搜索（3,476 命中、前 100）正常；首次读取约 126ms、目录约 8ms、搜索约 9ms。夹具覆盖 1,109 文件、1,100 项目录截断、300KB 文本截断、16×16 图片放大、WAV 音频、光影/数据包、损坏 ZIP 与路径穿越拒绝；真实资源包 mtime 未变化、未解压、未写盘。安装包 `D:\WindletterOut\Windletter-Launcher-0.54.0-setup.exe`，SHA256 `fc3cc2684ea2e7c06ef7238ab607dca2b7938bf3e9a95e014002526165ad6913`，已安装并验证 ProductVersion 0.54.0.0；从 `D:/WindletterBuildTmp054` 打包并删除临时目录。只读资源预览完成；剩余可选备份保留策略与自更新。
- 0.53.1 KubeJS 工作台使用说明：新增 `KubeJsHelpModal.tsx` + `kubejs-help.css`，工作台左侧底部和标签栏右侧都有「说明」入口；说明分 9 个分区（快速开始、文件与标签、编辑与保存、实例索引、配方/标签生成、释意/问题/日志、AI 辅助、边界与排错、快捷键），左侧目录点击跳转、滚动自动高亮，顶部 3 条安全约定（本地优先/先备份/不自动保存），底部可关闭或「去知识页」。内容覆盖 P1–P4 的真实用法：索引缓存、模板/保存冲突/历史、配方导入与 event.remove、标签模式、AST 释意、问题/日志、AI 选区 diff、已知边界和快捷键。浅色/深色、1000/1180 CSS 宽检查无溢出；打包解包版 0.53.1 验证说明入口/跳转/滚动高亮/Esc 只关说明/去知识页。安装包 `D:\WindletterOut\Windletter-Launcher-0.53.1-setup.exe`，SHA256 `65c3acb653cb3b9968aba065165f5e246732a2a0a0306e015039a978ea942166`；已静默安装到 `D:\启动器测试\windletter-launcher`，ProductVersion 0.53.1.0；安装后再次验证说明入口、9 个分区、滚动高亮、Esc 只关说明、去知识页和版本显示均正常。
- 0.53.0 KubeJS 已有配方导入：索引升到 v10，`IndexRecipe` 增加 `jar`/`entry`，扫描 jar 和 kubejs/data 时记录来源；新增 `KubeJsRecipeDetail`、`getKubeJsRecipeDetail()`、`workshop:kubejs-recipe-detail` 和 preload `kubejsRecipeDetail`，只按索引登记的配方 ID 找源文件：jar 用 `jarPaths[jar]` + entry，kubejs/data 只允许 kubejs 根目录内的相对 entry，单文件上限 512 KB，不接受渲染进程传入的任意路径。新增 `src/renderer/src/lib/recipeImport.ts` 纯映射：3×3/自定义 pattern+key、shapeless、熔炉/高炉/烟熏/营火/切石、锻造、大网格（4–9，原 pattern 不足补空，超过 9 或原版 >3 回退）、机器/祭坛可视化（输入 ingredients/inputs/ingredient/input/cast，产物 result/output/results/outputs/mainOutput；支持输入 count 与数组/单值形状，其余字段进附加 JSON）；无法完整表达的 schema 原样放进自定义 JSON，并列出未保留/其余字段。右栏配方页新增导入搜索（产物图标、type、材料预览、12 条分页加载、总数和来源提示），导入后可继续改格子、材料、数量、type 和附加 JSON；大网格新增附加字段 JSON，机器/祭坛可视化新增输入数量和 cast/mainOutput 字段。导入后默认显示「先生成 event.remove 移除原配方」，可取消或点「不替换」；`injectRecipeRemove` 在预览和插入时把 `event.remove` 放到 ServerEvents.recipes 开头，实现真正替换而不是重复添加。实测真实 miao 只读重建索引 v10（34,324 配方，11 秒）：thermal:press 的 4 个输入 count、结果数组和 energy/conditions 完整保留；press_coin_die 转 3×3 并列出未保留的 category/show_notification；extendedcrafting 4 行×7 列转 7×7 大网格；tinkers casting_table 转 cast + fluid/cooling_time；mysticalagriculture 灌注转 8 材料祭坛；exdeorum 筛子保留 mesh/result_amount；mekanism 嵌套 input 回退自定义 JSON；kubejs/data 的 industrialforegoing:creative_ingot 可读取。导入后可改格子材料/输入数量/type/附加 JSON 并实时更新；event.remove 默认开启，取消/不替换只新增；插入后预检 0 错误、磁盘文件未写入，撤销后恢复干净；19 个映射夹具通过。未调用 AI、未保存真实脚本。安装包 `D:\WindletterOut\Windletter-Launcher-0.53.0-setup.exe`，SHA256 `766f76575d537b089251a86a5bd2f3904f147ee88a6e4588df91c051651f3aa6`，安装后 ProductVersion 0.53.0.0；从 `D:/WindletterBuildTmp053` 打包并删除临时目录。只读资源预览和备份保留策略仍未做。
- 0.51.0 机器/祭坛可视化：配方类型新增「机器 / 祭坛（可视化）」，模板切换自动填 `modid:machine_recipe`/`modid:ritual`、输入/输出字段和 energy/mana 附加字段；输入/产物都用物品/标签选择器与图标，可增删多个，数量 1–64；输入字段支持 ingredients/inputs/ingredient/input，产物字段支持 result/output/results/outputs，并可在数组/单值之间切换（选字段时按 s 结尾自动猜测，用户可覆盖）。附加字段 JSON 合并进 recipe，核心 type/输入/产物字段优先覆盖；生成前校验 type、材料/产物 ID、数量、选中数组和附加 JSON。复杂 schema 仍用「自定义 JSON（高级）」。实测真实 miao 只读：机器模板铁锭→铁块生成 ingredients 数组/result/energy；切祭坛后保留材料并生成 output/mana；附加 JSON 错误时显示错误并禁用应用；图标/数量/字段映射正常。未调用 AI、未保存真实脚本。安装包 `D:\WindletterOut\Windletter-Launcher-0.51.0-setup.exe`，SHA256 `85c1ca8dbda2c34f01cc26872bcaef9912dabfb57afa48bba7e5e48db07ad0c0`，安装后 ProductVersion 0.51.0.0；从 `D:/WindletterBuildTmp051` 打包并删除临时目录。标签生成器、只读资源预览和备份保留策略仍未做。
- 0.50.0 KubeJS 配方图标 + 大配方：配方页新增批量物品图标，`kubejsItemIcons` 按当前产物、材料、3×3/大网格、选择器结果和图例去重后分批（每批 ≤80）加载，模块级缓存按 `instance|id`；标签显示 `#` 块，缺图回退首字。新增「大网格（4×4–9×9）」：可编辑配方 `type`（默认 extendedcrafting:shaped_table）、尺寸 4–9、完整 N×N 网格（不自动裁剪）、右键清空、字母图例 A–Z，生成 `event.custom({ type, pattern, key: {A:{item}/{tag}}, result:{item,count} })`，并提示 tier/energy 等字段按模组补充。新增「自定义 JSON（机器/祭坛）」：直接编辑并校验 JSON，生成 `event.custom({...})`，提供机器/祭坛/重置模板，不猜测模组 schema；适合科技机器和魔法仪式等非标准配方。基础 8 种配方、插入光标/替换选区、不自动保存保持不变；大网格和自定义 JSON 同样支持。实测真实 miao 只读：选择器/输出/5×5 网格图标正常，标签 # 块正常；5×5 生成 pattern `"AB   "` 等 5 行、key A/B、result hopper；切 9×9 后 81 格尺寸正确；自定义 JSON 机器/祭坛模板和坏 JSON 校验正常；未调用 AI、未保存真实脚本。安装包 `D:\WindletterOut\Windletter-Launcher-0.50.0-setup.exe`，SHA256 `770355ec19e0c084c351a64be62b857ce6b951772063ca7cd8f91023179e50b2`，安装后 ProductVersion 0.50.0.0；从 `D:/WindletterBuildTmp050` 打包并删除临时目录。标签生成器、只读资源预览和备份保留策略仍未做。
- 0.49.0 KubeJS 配方生成器（P4）：新增 `KubeJsRecipeBuilder.tsx` + `kubejs-recipe.css`，工作台右栏新增「配方」标签（5 个标签在 304px 窄栏也不溢出），并保持组件常驻以便切换标签不丢草稿。支持 shaped/shapeless/smelting/blasting/smoking/campfireCooking/stonecutting/smithing；产物和材料通过 `workshop:kubejs-index-search` 搜索物品/标签（产物只允许物品，材料允许 `#tag`），也可在索引未建立或找不到时使用原样 ID；索引状态只读取，不自动建。产物数量 1–64，shaped 3×3 格子（右键清空、自动裁剪空行列、相同材料复用字母键），shapeless 可增删最多 9 行，锻造模板/底材/附加三行。代码客户端实时生成，纯 ID/标签写法同时兼容 1.20.1 与 1.21+（NBT/组件需手动补）；路径不在 server_scripts 时提示。仅提供「插入光标/替换选区」，插入使用新增的 `insertAtCursor`（有选区时也不删除原内容），替换使用 `replaceRange`，都不自动保存；无活动文件/无选区/校验失败时禁用。实测真实 miao 只读：搜索 hopper/oak_planks 和 #minecraft:planks，生成 shaped 数量 2、shapeless、熔炉、锻造代码；生成 shaped 经索引预检 0 问题；替换选区后只改编辑器、磁盘未变；空产物/空材料显示错误并禁用。未调用 AI，未保存真实脚本。安装包 `D:\WindletterOut\Windletter-Launcher-0.49.0-setup.exe`，SHA256 `a766bdf58b399a69d9d9c195a527eb85d1aaa7668c98d21f914c159cae2a5500`，安装后 ProductVersion 0.49.0.0；从 `D:/WindletterBuildTmp049` 打包并删除临时目录。标签生成器、只读资源预览和备份保留策略仍未做。
- 0.48.2 KubeJS AST 释意：新增 `src/main/core/kubeJsExplainAst.ts`，本地释意先用 `@babel/parser`（`errorRecovery`）解析；按事件回调上下文识别 ServerEvents/ClientEvents/StartupEvents/PlayerEvents/BlockEvents/ItemEvents/EntityEvents/LevelEvents/NetworkEvents/JEIEvents/REIEvents，解释 `event.remove({id/output/mod/type/input})`（含多行对象和数组）、shaped/shapeless/熔炼/高炉/烟熏/营火/切石/锻造/custom、`event.recipes.<mod>.<type>`、标签 add/remove/removeAll/get 以及 `get(...).add`、启动注册表 create、玩家 give/tell/stages/命令、cancel、LootJS、console、Java.loadClass；每条要点带行号/标题/详情，摘要按实际操作（而不是每条事件注册）汇总，并检查服务端/客户端/启动脚本侧、按模组删除范围、未命名事件参数、占位符和要点截断。`event.remove` 多行对象、`Item.of` 输出数量、custom type/result/ingredients 都能解析；超过 30 条时提示只展示前 30 条。语法错误或非 `.js` 文件回退到旧版逐行识别，并在 notes 中提示先修复语法；AI 讲解路径不变，面板本地标签改为「AST 释意」，副标题说明不发内容。实测真实 miao 只读：`recipes_remove.js` 15ms/30 条要点，摘要正确列出按输出/输入/类型/模组删除，4 条大范围提示；`startup_scripts/item.js` 8 个 create；`kubejs_craft.js` 识别熔炼/有序/无序/模组/custom 并显示产出与输入；点击要点跳到 L4。夹具覆盖标签集合、注册表、玩家、LootJS、console、Java.loadClass 和错误脚本侧；未调用 AI、未保存真实脚本。安装包 `D:\WindletterOut\Windletter-Launcher-0.48.2-setup.exe`，SHA256 `d65b6b65b4876602343e68e455ae2de978a972455dd040ea34414fb03c75eeaf`，安装后 ProductVersion 0.48.2.0；从 `D:/WindletterBuildTmp0482` 打包并删除临时目录。
- 0.48.1 KubeJS 工作台可读性：在 `kubejs-workbench.css` 末尾增加统一的 readability override，把原先 7–9px 的侧栏、文件树、标签、问题/日志正文、知识/释意/AI 右栏和状态栏字号提高到 9–12px；问题/日志正文约 11px，分组路径 10px，标签徽章 8.5–9px，空状态标题 13px；文件树行高 28px，模板/工具栏按钮 28px，检查按钮 26–29px。栏宽默认 `232 / 1fr / 360`，≤1180 为 `214 / 1fr / 330`，≤980 为 `196 / 1fr / 304`；问题页、知识页、AI 页和文件树在约 1168 CSS 宽（1752×1080 物理）下截图检查无横向溢出，编辑区仍保留主宽度；深/浅主题均检查。问题页 57 个文件检查 359 ms、18 条警告正常显示。未改代码字号（仍由编辑器字号 10–20 控制），未改历史弹窗的数据逻辑。安装包 `D:\WindletterOut\Windletter-Launcher-0.48.1-setup.exe`，SHA256 `6a08cd552876a37b7389657baa4278358c1767c1ac95e325b4c935f1df364505`，安装后 ProductVersion 0.48.1.0；从 `D:/WindletterBuildTmp0481` 打包并删除临时目录。
- 0.48.0 KubeJS AI 选区改写 + diff：`KubeJsAiRequest` 新增 `selection {startLine,endLine,text}`（`KubeJsAiSelection`）；`workshop:kubejs-ai` 校验并截断选区（≤12000 字符、行号归一到 ≥1），`generateKubeJsScript` 在选区模式下改用“只重写第 X–Y 行、只返回替换片段、不要完整文件/Markdown”的系统提示，payload 加入 selection，`max_tokens` 降到 1800；整份脚本模式保持原提示与 2400 tokens。CodeMirror 新增 `onSelection` 回调和 `selection()`/`replaceRange()` 句柄，Workbench 在 AI 页实时显示“选区 Lx–Ly · N 行”，没有选区时照旧生成整份脚本；生成时捕获选区（路径/偏移/文本），结果用逐行 diff（复用历史面板的 `DiffView`，含行号/增删统计）预览，只有「替换选区」会写入编辑器，「放弃」不动内容；应用前校验当前标签路径、偏移和选中文本，内容变化则拒绝并提示重新生成。应用只替换选区、不清空其他改动、不自动保存；切换文件会清空预览。修复 CodeMirror 选区层被默认聚焦样式覆盖的问题（选区颜色加 `!important`，浅色主题下选中文字可读）。实测：本地 `127.0.0.1:9876` mock（未调用真实 AI、未读取真实 ai.json）；选中 L2–L4 后点击前请求数 0，请求含选区行号/文本/路径与 `max_tokens:1800`；diff 显示 +1/-1，应用前编辑器不变，应用后只改选中配方块、标签页变为未保存、磁盘文件保持原内容；改坏选区后替换会提示“选区内容已经变化，请重新生成改写”；「放弃」不写入；取消选区后整份脚本生成/插入/替换正常；1280×720 与 1440×900 深/浅主题截图检查。仍未做 AST 释意升级；AI 仍未配置/未启用时不影响其他功能。安装包 `D:\WindletterOut\Windletter-Launcher-0.48.0-setup.exe`，SHA256 `2b8e65fd17b1585773bf7d3a5ea2486317b4a23ac1ab4fe447a13f0355dfa502`，安装后 ProductVersion 0.48.0.0；从 `D:/WindletterBuildTmp048` 打包并已删除临时目录。
- 0.47.0 KubeJS AST 语义预检、问题面板与日志定位：新增 `src/shared/kubejsKnowledge.ts` 维护事件组/事件名/常用方法、脚本侧和全局对象，编辑器补全与主进程预检共用，加入 JEIEvents/REIEvents、EntityEvents.spawned、`event.recipes` 等真实用法，避免把模组扩展当成拼写错误。新增 `src/main/core/kubeJsDiagnostics.ts`：用 `@babel/parser`（`errorRecovery`）解析 JS，返回语法错误；检查 ServerEvents/ClientEvents/StartupEvents 只能出现在对应脚本目录、未知事件组（仅距离 1 的拼写建议，避免把 JEIEvents 等扩展误报）、未知事件名/recipes/tags 方法、未定义 `event`（按函数作用域建议真实回调参数名）、KubeJS 5 的 onEvent 旧写法；索引就绪时校验 `Item.of`/`Ingredient.of`、shaped/shapeless/smelting 等配方的输出与输入、`event.remove({id/output/mod})`、tags 事件（非 item/block 的 JEI 标签类型跳过标签存在性检查），物品/配方/标签按 ID 每文件去重，提示“运行时注册需重建索引”；JSON 使用自写扫描器给出精确行/列的尾逗号、缺逗号、非法转义等中文错误。`workshop:kubejs-lint` 返回单文件问题，`workshop:kubejs-lint-project` 支持最多 400 个 `.js/.json`、未保存标签内容覆盖磁盘内容，返回逐文件问题/错误/警告/耗时；preload 暴露 `kubejsLint`/`kubejsLintProject`。编辑器 linter 改为 650 ms 防抖的异步 IPC（路径/文档变化时丢弃过期结果，失败回退 Lezer），状态栏显示错误/警告数量；新增 `KubeJsProblemsPanel.tsx` 问题页：当前文件 / 全项目、只看错误、全项目检查、按文件折叠、点击跳行，索引未就绪或 ID 检查时给出说明。新增 `src/main/core/kubeJsLogs.ts` 与 `workshop:kubejs-logs`：只读 `logs/kubejs/server|client|startup.txt|log` 和 `logs/latest.log` 末尾 2 MB，解析 KubeJS `file.js#行号`、latest.log 的 `[kubejs/]` 前缀、Java 堆栈脚本帧，支持含空格目录，自动映射到真实 KubeJS 文件；日志页展示时间/级别/来源/消息/文件行，展开可看脚本帧与原始堆栈，点击跳转，没有日志或没有报错时给出明确空状态。索引版本升到 9：标签成员也计入物品集合，真实 miao 物品从 37,810 增至 38,624，降低动态种子类误报；`getKubeJsIndexLookup` 提供只读 ID 集合，不触发重建。实测：真实 miao 57 个脚本全项目检查 0.29 秒、0 错误、18 警告（主要是已移除的 Thermal 齿轮等）、49 个文件通过；点击问题跳到 `adastra_craft.js` L8:10；夹具覆盖语法/JSON/脚本侧/未定义 event/未知组与方法/缺失 ID；日志夹具含空格路径和 Java 堆栈可定位 `nested.js:6`；真实 miao 无报错 20 ms 返回空。已知边界：ID 检查基于静态索引，运行时动态注册物品仍可能提示未找到（界面已说明）；P3 的 AI 选区改写 + diff、释意升级尚未做；真实 miao 只读、未保存，AI 未调用。`npm run typecheck` 与 `npm run build` 通过。索引指纹改为绝对路径，避免开发版/安装版或不同工作目录算出不同缓存；`package.json` 增加 `electronDist: node_modules/electron/dist`，打包不再访问 GitHub 下载 Electron。0.47.0 从 `D:/WindletterBuildTmp047` 打包（工作区内 `release/win-unpacked` 的 app.asar 会被宿主锁住），安装后 ProductVersion 0.47.0.0；新增 `@babel/parser` 依赖已加入 package.json/package-lock，主进程打包体积约 1.31 MB。
- 0.46.0 KubeJS 图标/补全/版本模板：索引新增模型/纹理收集（mod jar 与 kubejs/assets 的 PNG、item/block 模型 parent 链），物品记录 iconJar/iconTexture；`workshop:kubejs-item-icons` 批量返回 data URL，主进程按 jar 分组、AdmZip 6 个 LRU、512 个 data URL 缓存，散图从 kubejs/assets 读取。知识页按当前结果批量加载图标，动画纹理用 object-position 裁到首帧，无图标回退首字块。CodeMirror 补全：`ServerEvents/ClientEvents/StartupEvents` 事件名、`event.` 方法、全局对象，以及字符串上下文中的物品/配方/标签 ID（`event.add/remove` 首参为标签、`event.remove({id})` 为配方、其余 KubeJS 配方调用为物品），中文名作为 detail，异步查询索引失败时静默回退。模板扩到 15 个并加 category/tagNamespace/versionNote 元数据；Forge/NeoForge 1.20.1 及以下用 forge:，NeoForge/Fabric/1.20.5+ 用 c:，UI 按加载器/版本过滤并按分类 optgroup 展示，新增无序/熔炼/高炉/自定义物品/客户端 tooltip/LootJS。真实 miao 只读实测：索引 9.6 秒、缓存约 1.4 MB、图标批次 9 个约 91 ms，hopper/漏斗花/自定义 creative_ingot 图标正常；event./物品/配方补全均返回正确候选；Forge 1.20.1 显示并插入 forge: 模板，NeoForge 1.21.1 夹具显示 c: 模板。仍无拼音搜索、运行时脚本动态配方和原版中文名 assets 补齐；未调用 AI，未保存真实脚本。
- 0.45.0 KubeJS 实例索引原型：新增 `src/main/core/kubeJsIndex.ts`、`KubeJsKnowledgePanel.tsx`、`workshop:kubejs-index-status/build/cancel/search` IPC、preload `kubejsIndex*` 和进度订阅。索引只读扫描 `mods/*.jar`、找到的客户端 jar（外部 miao 的 `miao.jar`；受管实例沿 `inheritsFrom` 找父版本）、`kubejs/data` 的配方/标签、`startup_scripts` 的 `.create()` 物品；生成物品/配方/标签/模组/命名空间列表。缓存位于 `<data>/cache/kubejs/<instanceId>/<fingerprint>.json.gz`（当前约 1.3 MB），指纹包含 jar 名/大小/mtime、客户端 jar、kubejs/data 与 startup 脚本；旧缓存自动清理。搜索在主进程内做，物品支持中文名/英文名/ID，配方支持 ID/类型/产出/输入，标签支持 ID/类型；分页 30 条并返回总数，支持 `modId` 过滤；物品插入使用 CodeMirror 智能引号（已在字符串内则不重复加引号），删除配方代码只插入编辑器，绝不自动保存。知识页提供建立/取消/重建和真实进度（jar 数、物品/配方/标签数、字节、耗时），空查询显示提示；取消重建保留上一版索引。模组筛选改为点击时懒扫描，打开工坊默认 KubeJS，避免 308 个 jar 的模组报告阻塞索引页。真实 miao 只读实测：309 jar、37,810 物品、34,324 配方、3,425 标签、478 命名空间；首次 13 秒，缓存重启加载 205 ms，搜索 40–70 ms；`kubejs:creative_ingot`（启动脚本）与 `industrialforegoing:creative_ingot`（kubejs/data 配方）可检索；标签对象值、颜色/格式占位符、纯数字伪 ID 已清理。已知边界（P2 原型）：没有物品图标、拼音搜索、自动补全和版本模板；索引为静态快照，不包含运行时脚本动态新增的配方；客户端原版中文名依赖 jar 内语言文件，未从 assets 索引补齐。测试使用外部只读实例，缓存写入测试数据目录，未改 miao；未调用真实 AI。`npm run typecheck` 与 `npm run build` 通过。
- 0.44.0 KubeJS 工作台 P1：把原来的单文件 textarea 改成全屏三栏工作台，新增 `KubeJsWorkbench.tsx`、`KubeJsCodeEditor.tsx`、`KubeJsExplainPanel.tsx`、`KubeJsHistoryModal.tsx` 和 `kubejs-workbench.css`；`PackWorkshopModal` 只保留模组页，KubeJS 页进入全屏（Modal 新增 `full` 尺寸与 `closeOnEscape`）。编辑层接入 CodeMirror 6（basicSetup + JS/JSON 语言 + 自定义明暗主题/搜索中文化），支持行号、括号、自动闭合、查找替换、跳行（Ctrl+G）、换行与字号、Ctrl+S、Ctrl+Shift+S、Ctrl+W、Ctrl+Tab、F2 重命名；每个标签保留独立 EditorState（撤销/光标/滚动）。文件层支持真实目录树（空格目录、折叠、搜索过滤）、内联新建、重命名/移动、删除、打开目录；标签脏标记、关闭确认、按实例恢复打开的标签和当前文件。保存层：`kubejsSave` 改为返回 `KubeJsSaveResult`，支持 `expectedModified`/`force` 冲突检测（changed/deleted/exists）、BOM/CRLF 保留、未变更字节跳过写入；备份目录改为 `backups/kubejs/<毫秒+随机>/<relative>`，避免同秒覆盖。历史层新增 `kubejsHistory/Read/Restore/Clean`，列表、统一 diff（1600 行内）、恢复前再备份、按文件保留 50 份清理；右侧栏提供自动本地释意（点击行跳转）、显式 AI 深释意和 AI 写脚本预览（插入光标/替换当前文件，均不自动保存）。测试夹具覆盖：全屏布局 1280×720/1440×900、浅色/深色、真实 `craft custom/` 目录、多标签恢复、F2 重命名、内联新建、删除、Ctrl+S/Ctrl+Shift+S（保存全部不跳标签）、外部修改冲突重新加载与强制覆盖、BOM+CRLF 保存原样、未变更不新增备份、历史 diff/恢复/清理、路径穿越/无效历史版本/语法错误保存被拒、已删除文件冲突。AI 使用本地 mock，未调用真实服务。已知边界：P1 只做语法检查，不包含 P2 的实例物品/配方索引与补全；CodeMirror 面板已中文化，但深层编辑器行为仍按 CodeMirror 默认；原生 `window.confirm` 仍用于关闭/删除/恢复确认。`npm run typecheck` 与 `npm run build` 通过。
- 0.43.0 KubeJS 释意：新增 `src/main/core/kubeJsExplain.ts`、`KubeJsExplainModal.tsx`、`workshop:kubejs-explain` IPC 和 preload `kubejsExplain`。本地释意不联网，按行识别 ServerEvents/ClientEvents/StartupEvents 事件、`event.remove({id/output/mod})`、shaped/shapeless、标签 add/remove、LootJS、console，并检查脚本目录与事件类型不匹配、按模组删除范围过大、modid/recipe_id 等占位符。AI 释意只在用户点「AI 深度讲解」时调用已启用的 AI 配置，发送路径、脚本（最多 12000 字符）和实例版本，要求返回 JSON summary/points/notes，points 的 line 必须落在脚本行数内；结果只读展示，不保存脚本。工坊编辑器新增「释意」按钮，打开嵌套弹窗；本地释义立即显示，AI 可重新请求；嵌套弹窗捕获 Escape，只关闭释意层。夹具脚本（删除木棍配方、添加有序合成、标签）本地识别出 L2/L3/L4/L10/L11 共 5 个点并提示占位符；mock AI 返回总结、3 个逐行点和风险，界面显示 mock-explain；Esc 后工坊仍在。类型检查和构建通过。
- 0.42.0 整合包工坊：新增 `src/main/core/packWorkshop.ts`、`PackWorkshopModal.tsx`、`workshop.css`，实例卡片新增工坊图标。`serverPack.ts` 的 `ModMeta` 扩展 `requires`，Fabric/Quilt 读取 `depends`，Forge/NeoForge 解析 `[[dependencies.*]]` 的 mandatory/side；`classifyMod` 和 `readModMeta` 对外导出。工坊报告返回每个模组的 side、必需依赖、被谁需要、缺失依赖、重复 ID、依赖的客户端模组；夹具 9 个模组统计为 3 仅客户端/1 仅服务端/5 双端、2 缺依赖、2 重复 ID、1 客户端依赖（Drippy→FancyMenu）。筛选页支持搜索和全部/客户端/服务端/双端/未知/缺依赖/重复/客户端依赖筛选，批量全选/仅双端服务端/仅双端客户端/清空，导出只含勾选模组的 `.mrpack`，同时带 config/defaultconfigs、kubejs、scripts、资源包/光影/数据包，写入 `modrinth.index.json`（files 空）并推送 `workshop:export-progress`，不改原实例；夹具导出 3 个勾选模组，ZIP 未包含未选中的模组。KubeJS 页扫描 `kubejs/` 文件树、读写/新建/删除；保存前用 `vm.Script` 只编译不执行做 JS 语法检查、JSON.parse 做 JSON 检查、路径越界拒绝；保存/删除前把原文件备份到 `instances/<id>/backups/kubejs/<timestamp>/`；内置删除配方/按输出删/按模组删/有序合成/标签添加移除/启动日志模板；AI 按钮把实例模组 ID/名称、当前脚本和需求发送到用户已启用的 AI 配置，返回 JSON code/notes 只放进编辑器，不自动保存。夹具验证：读取 4 个 KubeJS 文件，AI mock 生成并 UI 保存成功，备份存在；坏 JS 被拒、`../evil.js` 被拒、删除前备份。界面在深色主题下检查两个页签，类型检查和构建通过。
- 0.41.0 服务端包验证：新增 `src/main/core/serverPackCheck.ts`、`ServerPackCheckModal.tsx`、`serverpack:inspect/verify/verify-cancel` IPC 与 `serverPacks.inspect/verify/cancelVerify/onVerifyProgress`。静态检查 ZIP 是否可读、路径是否安全、mods、server.properties、EULA、双平台启动脚本、脚本引用的 server.jar/加载器安装器、jar 清单、常见客户端模组、配置/说明和 Java；ZIP 条目不落地执行。启动测试先解压到 `<cache>/serverpack-check-<uuid>`，只改测试副本的 `eula=true` 与空闲 `server-port`；原版直接启动 server.jar，Fabric 在缺少 `fabric-server-launch.jar` 时运行 `fabric-installer.jar server -mcversion … -loader … -downloadMinecraft`，Forge/NeoForge 在缺少 run 脚本时运行 `--installServer`；启动阶段等待日志出现 `Done (`，2 秒后写 `stop`，45 秒未退强杀；服务器通过后会再直接运行导出包内的 `start-server.bat`（Windows）/`start-server.sh`（POSIX），再次等待 Done/stop，专门验证启动脚本本身；安装 15 分钟、启动 8 分钟超时。Forge/Fabric 已有 run/launch 文件时，静态检查不再因缺少安装器误报。全程捕获 stdout/stderr，行级节流推送进度与日志；退出/取消/卸载弹窗都会终止本轮测试，失败时保留最近日志到 `<data>/logs/serverpack-check/`，临时目录删除。Java 取实例 `javaMajor` 兼容的已检测运行时，并注入 `JAVA_HOME`/PATH 供 run.bat 使用；`JAVA_TOOL_OPTIONS` 强制 UTF-8 接收中文安装器输出。由于实际启动会执行包内 jar/run 脚本，界面要求先勾选「服务端包来源可信」；Quilt/OptiFine 只做静态检查。实测：原版假服务端 1.6 秒启动/stop/退出 0；真实 Fabric 1.21.1 + Loader 0.20.1 安装器下载并生成 fabric-server-launch.jar，约 1 分钟后 Done；真实 Forge 1.20.1-47.4.16 安装器下载/安装并启动到 Done（其 run.bat 末尾 pause 会让 stop 等待，现已定时送空行收尾）；坏 server.jar 静态拦截、挂起服务端取消并清理进程/临时目录均通过；直接运行导出脚本的夹具：正常 `start-server.bat`（含 pause）通过，故意写坏 `java -jra` 的脚本在服务器本体启动成功后单独判失败，Forge `run.bat`+`start-server.bat` 双层 pause 通过。真实 miao 420MB/308 模组客户端包暴露并修复了三个问题：`spawn cmd.exe ENOENT`（改用绝对 `cmd.exe`、PATH 同时补 System32/写 PATH+Path）；Drippy→FancyMenu、Essential、LootBeams、MaFgLib、MinecraftCapes、Tweakerge、Shut Up GL Error、JECharacters、IMBlocker 等 22 个客户端模组（已补入过滤，`ftb-essentials`/`inventoryessentials` 不误伤）；DONE 正则误中异常栈 `awaitDone(`（改为只匹配 `Done (x.xxxs)!`）。过滤后 286 模组包实测直接服务器 Done 47.039s、stop 0，导出的 `start-server.bat` 也 Done/stop 通过；pause 改为静默看门狗，避免正常服务器刷 `Unknown command`。用户旧的 miao 服务端包需要重新生成才会带上过滤结果。日志落盘，ZIP/原实例未改动。`npm run typecheck`、`npm run build` 通过。
- 0.40.0 整合包服务端制作：新增 `src/main/core/serverPack.ts` 和 `ServerPackModal`。扫描实例 `mods/*.jar`，读取 Fabric/Quilt `environment`、Forge id/name/version 和常见客户端模组清单，返回 side/reason/include；预览显示配置目录与是否支持自动启动器。生成任务按勾选把模组、config/defaultconfigs/serverconfig/scripts/kubejs、server-icon 写入 ZIP，生成 `server.properties`（MOTD/端口/人数/正版验证/视距）、`eula=false`、`start-server.bat/.sh` 和中文 README；排除 world/logs/crash-reports/资源包/光影。`includeBootstrap` 时原版从版本 JSON 下载 server.jar，Fabric 从 meta 下载 installer，Forge/NeoForge 从 Maven/CDN 下载 installer，原版/Fabric 按要求写入启动命令，Forge/NeoForge 首次运行 `--installServer` 后调用 run 脚本；Quilt/OptiFine 提示手动准备。任务 kind `serverPack`，用文件/字节进度，失败删除半成品 ZIP，临时目录清理。AI 建议按钮调用已启用 AI 服务，返回文件级客户端排除建议并应用到勾选。实测夹具识别 3/4 模组、ZIP 内容正确；Fabric installer 与正确启动参数写入，原版 mock server.jar 下载成功；AI mock 排除 unknown-mod；没有实际启动服务器。`npm run typecheck`、`npm run build` 通过。
- 0.39.0 JVM 参数预设：新增 `src/main/core/jvmPresets.ts`，内置「默认（清空）」「G1GC 平滑」「G1GC 低延迟」「ZGC 低延迟（Java 21+）」四套参数；自定义预设保存到 `<data>/jvm-presets.json`，与 config.json 分开，限制 20 条/名称 40 字符/参数 4000 字符。新增 `jvm:presets`、`jvm:save-preset`、`jvm:remove-preset` IPC 与 preload；内置预设不可修改/删除。`JvmPresetsModal` 提供预设列表、参数预览、套用、保存当前参数和删除自定义；设置页全局 JVM 参数旁入口套用后立即 `settings:update`，实例设置入口只改本地输入，随「保存实例」写入。预设弹窗在捕获阶段处理 Escape，避免嵌套时把实例设置一起关闭。实测四套内置模板、全局套用、实例套用+保存、自定义保存/重启读取/删除均通过；G1GC 平滑参数已写入夹具全局设置。`npm run typecheck`、`npm run build` 通过。
- 0.38.0 实例迁移/克隆：新增 `src/main/core/instanceTransfer.ts`。受管实例可迁移 `baseDir` 或克隆新实例；外部实例禁止迁移，只能克隆到受管目录；目标不能是官方启动器文件夹、外部 base 或源内容目录。克隆内容时 `mods/*.jar`、resourcepacks、shaderpacks 优先 `fs.link`，跨盘/不支持硬链接回退 `copyFile`；config/saves/screenshots 独立复制；logs/crash-reports 跳过。版本运行时只复制 `versions/<id>` 根文件（natives 由启动器重解压），并复制合并版本所需的 libraries、assets/indexes、assets/objects 和 log_configs，缺文件时明确失败而不是产出半残克隆。任务用 kind `instance`，按文件数/字节/速度报告进度；所有新文件记录在 `created`，失败或取消时逐个删除并移除新内容目录，迁移只在复制成功后才写 baseDir，克隆只在成功后写 instance.json。UI 新增 `InstanceTransferModal`（迁移/克隆模式、目标文件夹、名称、外部只读提示），实例卡片尾部增加迁移/克隆图标，卡片 meta 显示所属文件夹；store 完成/失败提示按标题区分迁移/克隆。实测：内部迁移 2 文件 102B，源 A 保留；同文件夹克隆 4 文件 53B，mods 硬链接、config 独立、logs 跳过；外部夹具克隆 8 文件 245B；真实 miao 克隆 4882 文件/1.31GB（逻辑）在首次 5 秒轮询内完成，308 个模组硬链接、源未改动；目标结构冲突时 baseDir 不变。`npm run typecheck`、`npm run build` 通过。
- 0.37.0 截图画廊：新增 `src/main/core/screenshots.ts`，按实例的 `gameDir/screenshots` 读取图片（外部实例使用 `external.gameDir`），支持 png/jpg/jpeg/webp，按 mtime 倒序返回名称、大小、时间、预览 URL 和缩略图 URL。注册受限 `windletter-shot://screenshot/<instanceId>/<name>` 协议：校验实例、文件名和扩展名，只允许该实例截图目录内的文件；`thumb=1` 通过 `nativeImage` 缩到 520px 并缓存为 JPEG（`<cache>/screenshots/<sha1>.jpg`），原图直出。新增 `screenshots:list/remove/copy/open` IPC 与 preload；删除走 `shell.trashItem` 回收站，复制用 Electron 45 的 `ClipboardItem` 写 PNG。`ScreenshotGalleryModal.tsx` 提供缩略图网格、原图预览、← → 切换、Esc 返回、复制图片、默认程序打开、打开截图文件夹和删除确认；空目录有专用空状态。实例卡片「存档」旁新增「截图」入口。CSP 增加 `windletter-shot:`。实测外部实例夹具 4 张截图：缩略图 520px、原图预览 1280×720、剪贴板读回 1280×720、删除后文件进入回收站且列表变 3 张；真实 miao 截图只读预览正常；打包版实例入口和缩略图正常。`npm run typecheck`、`npm run build` 通过。
- 0.36.1 游戏时长原生监视进程：新增 `build/playtime-watch.c` 与编译好的 16KB `build/playtime-watch.exe`（MinGW x64，等待目标 PID 退出后原子写入结束时间），通过 electron-builder `extraResources` 安装到 `resources/playtime-watch.exe`。游戏 spawn 增加 `detached: true`，退出启动器不再结束游戏。`startPlaySession()` 现在带 PID，返回完成文件路径；`startPlaytimeWatcher(pid, donePath)` 以 detached 方式启动助手。`playtime.json` 的 active 会话保存 PID；启动器下次打开时先读 `<data>/playtime-pending/<id>.done`，有完成时间就按真实结束时间落账；没有完成文件但 PID 仍存活则保留会话并继续心跳/5 秒轮询完成文件；PID 已退出才按最后心跳兜底。`finishPlaySession()` 也会等待并读取完成文件，然后清理。启动器退出后助手继续计时，重新打开时补进周报。实测助手工作集约 4.16MB、私有 0.61MB、CPU 空闲；sleep 60 秒夹具在退出启动器后游戏与助手均存活，60.07 秒写入完成，重新打开得到 60066ms 会话；打包版从 `resources` 启动助手，6 秒夹具记录 6076ms。`npm run typecheck`、`npm run build` 通过。
- 0.36.0 游戏时长周报：新增 `src/main/core/playtime.ts`，数据写在 `<data>/playtime.json`（`sessions` + `active`）。`startPlaySession()` 在游戏进程成功 spawn 后写入 active，并每 30 秒心跳；`finishPlaySession()` 在进程 exit 时按真实起止时间落一条会话并清 active。数据做字段清洗、最短 1 秒、单次最长 7 天、最多 20000 条；写入走队列 + 临时文件 rename。启动器上次没有正常退出时，下一次读取会把 active 用最后心跳补记，误差最多 30 秒。`launcher.ts` 接入 start/finish，退出后通过 `playtime:changed` 通知界面。新增 `playtime:report` IPC、`window.ccl.playtime.report/onChanged` 和 `PlaytimeReport`/`PlaytimeDay`/`PlaytimeInstanceStat`/`PlaytimeSessionView` 类型；`getPlaytimeReport()` 按本地周一至周日聚合，返回本周、上周、今天、累计、每日、实例排行和最近 12 条。界面新增 `PlaytimeBadge.tsx`：首页两种布局标题区显示本周徽章，运行中每秒刷新「本次 m:ss」，点击打开 `Modal` 周报，含汇总卡、7 日柱状图、实例排行、最近记录、刷新与空状态；`CommandPalette` 新增「查看游戏时长周报」。实测：8 条合成会话聚合（本周 4 小时 55 分/今天 2 小时 10 分/累计 6 小时 55 分/7 次/上周 2 小时）和中断 active 补记 30 分钟正确；清空后空状态正常；另用 `TrackTest`（sleep 6 秒）作为版本直接启动，游戏运行中徽章显示「本次 0:03」，退出码 0 后报告新增 6073ms 会话并刷新本周总时长。`npm run typecheck`、`npm run build` 通过。
- 0.35.2 实例页版本文件夹入口：实例页顶部操作行新增「版本文件夹」按钮（刷新、预设模组、扫描本地、导入整合包之前），点击同样派发 `windletter:version-folders`，打开选择器并展开文件夹面板，与首页版本栏共用一套切换逻辑。真实数据 0.35.2 实测按钮存在，点击后文件夹面板列出当前目录和官方目录；实例卡片与操作栏布局正常。`npm run typecheck`、`npm run build` 通过。
- 0.35.1 版本文件夹入口显性化：0.35.0 的文件夹栏藏在「切换目标/选择版本或实例」弹窗里，用户反馈「在哪呢，没看到」。现在精简主页和经典工作台的版本栏操作行都新增「文件夹」按钮，点击后打开选择器并自动展开文件夹面板；`CommandPalette` 的操作组新增「选择版本文件夹」，同样通过 `windletter:version-folders` 事件打开。`VersionPicker` 监听该事件并同时 `setOpen(true)`、`setFoldersOpen(true)`、重新读取文件夹。夹具实测按钮出现、点击后 `version-folder-bar` 与 `version-folder-panel` 均展开；安装后的 0.35.1 真实数据上确认文件夹面板列出当前目录和官方目录。`npm run typecheck`、`npm run build` 通过。
- 0.35.0 多版本文件夹：新增 `src/main/core/versionFolders.ts`，`officialGameDir()` 指向官方启动器 `.minecraft`，`mergeVersionFolders()` 把当前/官方/手动目录解析为绝对路径并按 Windows 大小写不敏感去重（最多 20 个），`listVersionFolders()` 返回每个目录的 `kind`（current/official/custom）、是否存在、版本数和实例数。`LauncherSettings.versionFolders` 持久化手动目录；`InstanceSummary.baseDir` 让内部实例记住创建/导入时的版本文件夹，`bindMissingInstanceBaseDirs()` 在首次切换前把旧实例补记为旧目录。`settings:update` 切换 `gameDir` 时检查游戏未运行、绑定旧实例、合并目录、清空 `lastVersionId`，切换后清 Java 缓存与版本缓存；新增 `versions:folders` IPC 与 preload。`VersionPicker` 顶部加入文件夹条：面板显示当前文件夹、官方启动器文件夹和已添加目录，可点击切换、移除自定义目录、添加已有文件夹或直接导入整合包；不在当前文件夹的内部/外部实例显示文件夹标签，并提示切换只影响之后下载的版本和直接启动的原版。删除实例后的自动清理和版本清理预览都只作用于实例绑定/当前文件夹。夹具 A=1.21.5+Fabric、B=1.20.1+Fabric 实测：A→B 后旧实例补记 A、A 绑定实例不动、版本列表切到 B 并清空上次选择，B→A 正常；官方文件夹可切换；大小写不同的重复路径会去重；删除 B 绑定实例只清理 B 的 1.20.1 与 Fabric 档案，A 的版本保留。安装后的 0.35.0 在真实数据上只读确认当前文件夹、官方文件夹与外部实例目录正常显示；`npm run typecheck`、`npm run build` 通过。
- 0.34.0 Ctrl+K 全局命令面板：新增 `CommandPalette.tsx`，全局监听 Ctrl/Cmd+K 和标题栏搜索按钮事件；命令由页面、实例、版本和操作四组组成。页面命令跳转启动/实例/服务器/下载/设置/更多；实例命令启动、打开目录、启动体检；版本命令启动原版/加载器档案和打开版本文件夹；操作包含安装/导入整合包、账户管理、日志控制台/文件夹、游戏目录、刷新、切换明暗主题和打开版本清理。支持中文/英文关键词、打分排序、↑↓ 循环、Enter 执行、Esc 关闭、鼠标悬停、选中项滚动进入视野和自动聚焦；背景命令面板不依赖额外 IPC。实测标题栏按钮和 Ctrl+K 均打开，首项为「前往启动」，输入「设置」Enter 跳转设置页，输入「清理」打开版本清理弹窗，Esc 和 Ctrl+K 切换关闭正常；样式在深色主题截图检查。
- 0.33.2 「配置缺失」目录改为默认不勾选：0.33.1 曾把它归入建议清理，容易误删；现在仍显示在独立组中供手动选择，自动/建议清理只处理加载器链。
- 0.33.1 版本清理补充：`buildVersionCleanupPreview` 会把 `versions` 下缺少 `<id>.json` 的文件夹列为「配置缺失」独立组（默认不勾选，避免误删可能仍有用途的目录）；`instances:remove` 返回本次自动清理的版本 ID 列表，删除完成 toast 显示具体版本名（最多 4 个）。
- 0.33.0 版本管理收尾：`InstalledVersion` 增加 `usedBy`，`versions:installed` 通过实例的 `versionId`/`gameVersion` 继承链标注占用；新增 `VersionCleanupModal` 和首页「清理」入口。`versions:cleanup-preview` 把未被任何实例、最近选择或正在运行版本引用的档案按继承关系分组：含加载器档案的组 `suggested=true` 默认勾选，独立原版组默认不勾选；每组统计目录大小。`versions:cleanup` 校验只能整组删除，先删子档案再删基础版本，并返回 removed/skipped；不会删除存档、模组、配置、libraries 或 assets。夹具验证 1.12.2/1.19.2/26.2 默认保留，1.20.2+0.15.7、1.21.5+0.16.13、26.3+0.19.5 默认清理，UI 勾选独立版本后成功删除；实例占用显示 sas→1.20.1+Forge、ATM10→1.21.1+NeoForge。
- 0.32.2 删除实例自动清理版本依赖：`instances:remove` 删除实例后调用 `cleanupVersionsAfterInstanceDelete()`。它收集被删实例的 `versionId` 和 `gameVersion` 的 `inheritsFrom` 链，再扫描剩余实例（外部实例若 baseDir 不同则跳过）和所有已安装版本档案；只删除不再被任何实例或档案引用的加载器/基础原版，先删子档案再判断基础版本，避免 1.20.1/1.21.1 这类被 Forge/NeoForge/Fabric 共享的基础版本被误删。UI 删除说明和完成 toast 改为「独占版本已自动清理，共享运行库与其他实例依赖保留」。夹具验证：删除 sas 清掉 `1.20.1-forge-47.4.28` 与 `1.20.1`，ATM10 的 `1.21.1`/`neoforge-21.1.116`、外部 miao、以及未引用的 1.19.2/26.3/Fabric 档案保留；两个实例共享一个 Fabric 档案时删除第一个保留，删除最后一个才清理。已有历史孤儿版本（本次更新前就删掉实例留下的）不会自动清理，需要手动处理。
- 0.32.1 实例卡片操作区修复：移除升级按钮后，实例网格曾被回退为 310px/280px，四个主操作按钮加体检/设置/删除图标在窄卡片中溢出，图标被裁掉。现在恢复 `minmax(420px,1fr)`（1080px 以下 360px），`.instance-actions` 允许 `flex-wrap`，按钮与 trailing 图标 `flex:0 0 auto`，尾部 `margin-left:auto`；实测 1180px 窗口卡片 554px、980px 窗口卡片 454px 时图标都在卡片内且单行显示，更窄窗口会整体换行而不是被遮挡。
- 0.32.0 移除整合包整包升级/回滚：用户确认该功能不再保留。删除了 `packUpgrade.ts`、`packStore.ts`、`PackUpgradeModal.tsx`，移除 `packs:*` IPC、preload `packs` API、`PackUpgrade*`/`PackPlan*`/`PackRollback*` 类型、实例 `hasPack` 字段、`pack` 任务类型、`assertNoPackUpgrade` 与启动/服务器/模组/加载器/设置/删除等互斥检查、`backups/packs` 说明和升级专用 CSS；安装整合包不再写 `pack.json`。故障医生不再读取整合包清单，重复模组仍按通用规则提示。整包升级的风险提示、跨版本手动模组隔离以及升级/回滚入口一并移除；加载器更新/回滚、实例补全文件、存档备份等独立功能保留。已有的 `pack.json` 与空的 `backups/packs` 目录视为遗留数据（不参与功能）；当前实例的存档/模组未清理。今后更新整合包请重新安装或导出后重新导入。
- 0.31.7 整包升级测试风险提示（已随 0.32.0 移除）：`PackUpgradeModal` 顶部新增常驻警告，明确「整包升级和回滚仍在验证阶段，尚未适配所有整合包，无法保证一定能做成；可能下载失败、文件冲突或导致实例无法启动；后续可能调整或移除」，并要求勾选「我已了解风险，并已手动备份重要存档」——未勾选时「开始升级」按钮禁用，底部提示同步变化，`startUpgrade` 也会再次校验。实例卡片的「升级」按钮 title 改为「整合包升级（测试功能，请先备份存档）」；回滚确认文案追加测试功能与手动备份提醒。弹窗打开时确认状态重置。样式新增 `.pack-upgrade-warning` / `.pack-upgrade-risk-check`，使用 warning 色而不影响现有布局。`npm run typecheck`、`npm run build` 通过。
- 0.31.6 跨版本升级隔离手动模组与回滚安全恢复：真实 FO 实例从 1.21.5 升级到 26.2 后，旧的 Fabric API 0.128.2、IMBlocker、MaLiLib、Tweakeroo 等手动模组仍留在 `mods`，Fabric 报 `Incompatible mods found` 并拒绝启动；回滚到 26.2 只是恢复整合包，不会处理这些模组，所以升级和回滚看起来都不正常。现在 `computeDiff` 会列出不在旧/新整合包 files 或 overrides 中的 `mods/*.jar`（`counts.userMods`）；只要 Minecraft 版本发生变化，`planQuarantine` 就为这些手动模组分配 `.jar.disabled` 名称并写入回滚快照。计划界面显示「会暂时禁用 N 个手动模组」的说明；执行时在下载、覆盖、删除之后统一改名，再写入新 `pack.json`。生成的名字会避开已有 `.disabled` 文件。`PackRollbackRecord.quarantines` 记录原名与禁用名。回滚时 `restoreQuarantinedMods` 先读取恢复后的整合包 mods ID，只有满足「目标 Minecraft 版本明确在 `depends.minecraft` 范围内」且「模组 ID 不与整合包重复」的文件才改回 `.jar`；范围缺失或冲突的保持禁用，任务结果会报告恢复/保持数量。夹具用真实 FO 26.2 的 7 个手动模组升级到 1.21.5，全部改为 `.disabled`；回滚到 26.2 恢复了 91 个快照文件，仅 JECharacters 重新启用，旧 Fabric API 因与整合包 0.161.0 重复、IMBlocker/MaLiLib/Tweakeroo 因版本范围不匹配、I18n/MinecraftCapes 因范围未知而保持禁用，提示「恢复了 1 个手动模组，6 个模组保持禁用」。故障医生新增 `mod-incompatible-manual` 汇总问题，读取 `pack.json` 排除整合包自带文件，并用 `isMinecraftVersionInRange` 判断 `depends.minecraft`/Forge versionRange；卡片提供逐个禁用和「全部禁用 N 个」按钮。`mod-duplicate` 也只显示非整合包文件的禁用按钮。`npm run typecheck`、`npm run build` 通过。
- 0.31.5 启动 Java 严格匹配与前置去重：此前启动只对 Forge/NeoForge 强制精确 Java，Fabric/Quilt 允许使用更高主版本；用户的全局 Java 是 Microsoft JDK 25，而 Fabulously Optimized 的 Minecraft 1.21.5 需要 Java 21，启动器仍选 Java 25，日志出现大量 `Unsupported class file major version 69`，Mixin 无法读取 JDK 25 class，最终 `Mixin transformation of net.minecraft.client.main.Main failed`。`launchGame` 现在对所有版本都按版本 JSON 的 `javaVersion.majorVersion` 精确选择 Java：全局 Java 25 与 21 不匹配时，在 `autoJava` 开启下自动回退到已检测的 Java 21（夹具实测选择 BellSoft `D:\New Folder\bellsoft jdk` 的 21.0.11），只有找不到对应版本时才按官方 runtime 补装。另修复预设/自动前置重复：自动解析出的前置现在带 `dependency` 标记，`installFiles` 在写入前读取现有 `mods/*.jar` 的模组 ID，若前置 ID 已由整合包或已有模组提供，就删除刚下载的重复 jar 并计入 skipped；夹具中已有 `fabric-api-0.119.9+1.21.5.jar`，安装依赖 Fabric API 的 MinecraftCapes 时下载的 `fabric-api-0.128.2+1.21.5.jar` 被删除，最终只新增 MinecraftCapes；Tweakeroo + MaLiLib 正常安装。故障医生读取 `pack.json`，`mod-duplicate` 改为 warning，且只把不在整合包清单里的重复文件放进禁用按钮（如只显示 `fabric-api-0.128.2+1.21.5.jar`），避免误禁用整合包自身的版本。`npm run typecheck`、`npm run build` 通过。
- 0.31.4 回滚启动档案自愈与重复运行库：整合包回滚原来只把 `instance.json` 的 `gameVersion`/`loaderVersion`/`versionId` 改回旧值，卸载或清理过 `versions/fabric-loader-0.15.3-1.20.2` 后启动会报「未找到版本 … 的配置文件」。现在 `ensureLaunchProfile()` 在回滚前先检查旧版原版 json/jar 与加载器档案：缺原版就重新安装，缺加载器就按回滚记录中的完整版本重装，成功后用实际安装的 `versionId`/`loaderVersion` 写回实例，再恢复整合包文件与 `pack.json`；检查在恢复文件之前完成，自愈失败不会留下半恢复状态，回滚快照也保留。手动回滚与升级失败自动恢复共用这套流程，`instances:repair`（实例设置「补全文件」）也改为补齐原版 + 加载器，而不再只补原版。加载器更新回滚也复用了同一函数。另修正版本继承的运行库合并：原来按完整 Maven 坐标（含版本）合并，Fabric 档案的 `asm:9.7.1` 与原版 1.21.5 的 `asm:9.6` 会同时进入 classpath，Fabric 启动报 `duplicate ASM classes`；现在按 `group:artifact:classifier:extension` 合并，子档案覆盖父档案、版本不同也去重，原生库不同 classifier 仍保留。同时启动日志的 `APP_VERSION` 从硬编码 `0.13.1` 改为 `app.getVersion()`。夹具实测：删除 1.20.2 原版与 Fabric 0.15.3 档案后回滚，任务补回原版/加载器、恢复旧 jar、删除升级新增 jar、实例回到 `fabric-loader-0.15.3-1.20.2` 且 `pack.json` 回到 v1；档案仍在时回滚瞬间完成；「补全文件」在档案删除后能重建 `fabric-loader-0.15.3-1.20.2`。真实 1.21.5 Fabric 档案合并后 classpath 只保留 asm 9.7.1，asm 9.6 消失。`npm run typecheck`、`npm run build` 通过。
- 0.31.3 NeoForge 版本后缀归一化：下载页的 NeoForge 版本列表返回的是后缀（如 `265`），`createLoaderInstance` 直接传给 `installLoaderProfile`；现代 NeoForge 的 `installForgeProfile` 把 `loaderVersion` 当作完整版本，安装器 URL 拼成 `.../neoforge/265/neoforge-265-installer.jar`，Maven 立即 404。截图中的「创建 NeoForge 1.21.1 实例」连续失败即此问题；`Create+`/`ATM10` 是从整合包清单安装的，清单里本来就是完整版本，所以此前没暴露。`resolveNeoForgeVersion` 现在统一输入：现代版本若没有 `21.1.` 前缀就补全成 `21.1.265`（完整版本保持不变），legacy 1.20.1 则去掉 `1.20.1-` 前缀；无指定版本时从 Maven 元数据取最新也返回完整版本。`loaderVersionKey()` 同时用于 `updateLoaderForInstance`/IPC 的「已是当前版本」判断和 `LoaderUpdateModal` 的当前标记，避免实例记录 `21.1.265` 与 UI 后缀 `265` 对不上。独立夹具（复制真实 1.21.1 原版 json/jar）用 `loaderVersion: '265'` 创建 NeoForge 成功：任务走完下载安装器/运行器/运行库，实例记录为 `loaderVersion: 21.1.265`、`versionId: neoforge-21.1.265`，不再 404。`npm run typecheck` 与 `npm run build` 通过。
- 0.31.2 同版本加载器多实例：下载页原来只要实例列表中已有相同 `gameVersion + loader` 的实例，就直接 toast「这个加载器实例已经存在」并 return，导致无法再建一个同版本 NeoForge/Fabric 实例。现在移除这个拦截；`selectedInstance` 改为 `loaderMatches` 列表，加载器行显示「已有 N 个 · 可再建」，底栏显示「已有 X，再创建会得到独立实例」，按钮变为「再创建一个」。主进程允许复用同一套 `versionId` 加载器档案（共享 libraries/version），实例目录仍然独立，mods/config/saves 互不影响。默认实例名用 `listInstances()` 去重，第二个自动成为 `1.21.1 Fabric 2`，第三个为 `3`。`instances:create-loader` 新增任务类型 `instance`（不再伪装成 modpack）：同一加载器/版本创建任务运行中时同标题任务直接复用，任务浮窗使用 Boxes 图标，完成 toast 为「实例已创建」；下载页用 `loaderTask`/`activeTask` 显示创建进度并禁用按钮，避免连点。实测在独立数据目录连续创建两个 Fabric 0.16.0 + 1.21.1 实例：名称 `1.21.1 Fabric` / `1.21.1 Fabric 2`，两者 `versionId` 都是 `fabric-loader-0.16.0-1.21.1`，基础游戏与加载器档案复用、实例目录独立。`npm run typecheck` 与 `npm run build` 通过。
- 0.31.1 故障医生重复目录与 Java 要求：ReplayMod 的 jar 内重复打包 `assets/` 目录，adm-zip 出于安全拒绝读取，原实现只在构造函数外包 try，`getEntries()`/`getEntry()` 的异常跑到 `runDiagnostics`，整个体检显示「ADM-ZIP: Duplicate entry name "assets/"」。现在按文件包住元数据和 Jar-in-Jar 读取：重复目录只生成 `mod-scan-skipped` 的 info「模组扫描已跳过」，不要求重新下载，也不再中断体检；预置模组扫描同样捕获。新增 `highestModJavaRequirement`，从启用模组的 `depends.java` / Forge `java` 依赖提取最高主版本，与版本默认 Java 比较；如果实例未指定满足要求的 Java，报 `java-mod-requirement`，详情给出模组名、要求版本、当前默认 Java、本机已检测的可用版本和「实例启动设置」操作提示。崩溃分析新增 `crash-java-mod`，匹配 Fabric 的 `Incompatible mods found`、中文「需要 … Java … 及以上版本」和英文 `requires Java N`；`readLatestCrash` 也会把含这些行的 `latest.log` 当作崩溃报告。只读夹具（真实 1.20.1-Fabric 0.20.1 的 ReplayMod/Zoomify）验证：体检不再抛 ADM-ZIP，显示 ReplayMod 跳过提示、Zoomify 要求 Java 21（本机 Java 21/25 可用），模拟日志返回 `crash-java-mod`；真实实例只读运行，未改模组。`npm run typecheck` 与 `npm run build` 通过。
- 0.31.0 整合包整包升级与回滚：安装 Modrinth / CurseForge / 本地整合包时写入 `instances/<id>/pack.json`，记录来源、项目/文件版本、每个清单文件的 SHA1 与覆盖文件的 SHA1/CRC32。实例卡片新增「升级」按钮，`PackUpgradeModal` 按来源列出 Modrinth / CurseForge 版本（类型、日期、MC、加载器、大小），本地包可选择新版 `.mrpack` / `.zip`；`packs:plan` 下载目标索引并计算新增/更新/移除/保留/冲突、下载量、存档数量和回滚快照大小，返回一次性 token，确认后才执行。执行前按 `autoWorldBackup` 备份存档（新增 `kind:'pack'`，失败阻止升级），建立 `backups/packs/rollback` 快照：被覆盖或删除的旧文件逐个复制，新增文件记录新 SHA1/CRC，回滚时只删除哈希仍匹配的新文件；必要时先安装目标原版与加载器，再下载清单文件、应用覆盖文件、写入 `pack.json` 与 `instance.json`。覆盖文件支持「保留本地修改」与「使用整合包版本」，默认保留；清单中已移除但本地改过的模组/覆盖文件保留。任何下载或应用失败、取消都会自动恢复旧文件与实例元数据；成功后弹窗出现「回滚」，一键恢复升级前的包清单、版本、加载器和文件。旧版本实例没有 `pack.json` 时明确提示重新安装/导入，外部实例不参与。夹具实测：本地 v1→v2 的 1 新增/1 更新/1 移除/1 保留/3 冲突、1 个手动模组保留、存档备份和 82 B 回滚快照计数正确；keep-local 保留用户配置、use-pack 覆盖配置；成功升级后回滚恢复旧 jar、删除新文件、恢复 `pack.json`/`instance.json` 并清理快照；把下载 URL 改成 404 后升级任务报错且自动恢复原文件、删除新配置，回滚记录清理。真实 Modrinth「FPS Modpack」读取 36 个版本，3.3→3.4 计划显示 9 新增/2 移除/13.5 MB 与 MC 26.2→26.3、Fabric 0.16.0→0.19.5；未执行该目标版本的原版/加载器完整下载升级。之后按代码审查补强了数据安全：升级下载对已存在目标强制核对 SHA1，不再只按大小跳过；删除旧文件前排除新版 files/overrides 仍占用的路径（大小写不敏感），删除失败不再吞掉而是中止并回滚；回滚恢复改为临时文件 + rename，避免覆盖全局 SHA1 缓存里的硬链接（夹具中把旧 jar 硬链到 `cache/objects`，升级再回滚后缓存内容未变）；用户手动文件占用新版模组路径时按冲突处理，keep-local 保留且不再登记进 pack.json，use-pack 才覆盖并可在回滚时恢复（实测 user.jar 15 B 保留、切换到 use-pack 后变为 38 KB、回滚又恢复 15 B）；同版本仅剩冲突时允许再次计划，并提示切换到「使用整合包版本」；回滚时升级新增的文件会无条件删除（实测升级后改写 new.cfg 仍被回滚删除）；回滚快照先写临时目录再原子替换旧快照；存档自动备份按 manual/loader/pack/restore 分类各自限量，包升级不会挤掉手动备份；升级期间禁止启动游戏、启动服务器、改实例设置/信息、删除实例、更新/回滚加载器、安装/启停/导入模组、内容更新/回滚与安装预设。`npm run typecheck` 与 `npm run build` 通过。
- 0.30.5 紧凑近方形三栏：0.30.4 的“均匀拉缝”在接近正方形的窗口里把卡片拉得东一块西一块（用户明确说不对）。现在 `availableHeight/availableWidth > 0.85` 时不再用 1060 画布+space-between，而是 `designWidth = availableWidth`，CSS 用 220px / minmax(0,1fr) / 240px 三列、紧凑卡片内边距、精简版本表（隐藏类型和最后启动），保留普通间距；`scale = min(1, availW/width, availH/content.scrollHeight)` 只负责把整体塞进高度。994×981 实测 scale 0.827、content 928×1060 设计像素→877px 显示高度，四张实例、右栏全部同屏，底部无空白、无夸张间隙；宽窗口继续 1680 画布。
- 0.30.4 近方形窗口留白：用户反馈 994×981 时下半部空白过多。`HomePageClassic` 现在根据 `availableHeight/availableWidth > 0.85` 选择画布：近方形/高窗口用 `designWidth=1060`，宽窗口用 1680；`content.minHeight = availableHeight/scale`，工作台 `flex:1`，左/中/右三列 `justify-content:space-between`，把多余高度分到卡片间距，不拉伸卡片本身。窄画布加 `is-narrow-canvas`，版本表只保留图标/名称/Java/操作四列（隐藏类型和最后启动），给中央留出空间。994×981 实测缩放约 0.87、底部空白接近 0；1180×760/980×660 宽窗口仍用 1680 画布+完整表列。
- 0.30.3 右栏比例修正：0.30.2 的缩放画布在 ≤1180px 时会继承 `@media (max-width:1180px)` 给 `.right-panel` 的 `align-items:start`，任务/日志/状态卡片被压成文字宽度（实测 980px 时右栏 174px，卡片只有 53/66/80px），看起来比例完全不对。`home-fit-content .right-panel` 现在强制 `align-items:stretch !important`，三张卡片撑满右栏；980×660 与 1180×760 截图确认比例和全屏一致。
- 0.30.2 工作台等比缩放：用户要的是“窗口缩小后也和全屏一样一次显示全部组件”，不是堆叠/滚动。`HomePageClassic` 外层加 `home-classic-fit`，内层 `home-fit-content` 固定 1680px 设计宽度并 `position:absolute`，`useLayoutEffect` + `ResizeObserver` 用 `scale = min(1, availableWidth/1680, availableHeight/content.scrollHeight)` 实时计算，`translateX` 水平居中；整页 `overflow:hidden`，不出现滚动条。`home-fit-content` 内用 `!important` 强制三栏布局/完整表格列/右栏，抵消视口 1180/1280 的媒体查询；标题栏不在画布内，保持正常字号和响应式收缩。实测 1706×983≈0.99、1440×720≈0.69、1180×760≈0.68、980×660≈0.56，四个尺寸一次显示左侧账户/Java、中央启动卡+版本+实例、右侧任务/日志/状态，无裁切/滚动；真实 4 实例/2 版本、浅色+自定义背景截图验证。精简主页仍按 0.30.1 的堆叠方案。代价：窗口越小组件和文字越小，980 宽度下已明显偏小；这是用户明确选择的完整同屏方案。
- 0.30.1 窗口适配：`workbench.css` 的 `.page--home` 改为页面级纵向滚动（`overflow-x:hidden; overflow-y:auto`），三栏不再依赖各自内部滚动；`.workbench-layout` 取消 `flex:1`，改为内容高度，旧的 `overflow-y:auto/display:none` 删除。断点：>1180 三栏；≤1180 两栏 `left/center` + 整行 `right`（任务/日志/状态变为三列卡片）；≤840 单栏 `center → left → right`（启动主卡优先，左栏卡片自动 `auto-fit minmax(220px,1fr)`，右栏单列）；≤720 头部按钮换行、focus 标题允许换行、section 操作换行。精简主页 ≤980 改为纵向堆叠，右侧活动栏变成小横排按钮；≤760 高度不足时关闭内部滚动由页面滚动。标题栏：`.titlebar-nav` 横向滚动 + 项 `white-space:nowrap`；≤900 隐藏品牌文字并收紧间距，≤700 隐藏导航文字只留图标（按钮补 `title`），≤620 隐藏主题/控制台工具，≤520 隐藏「更多」并把窗口按钮缩到 32px。实测 1600×900、1440×720、1180×760、980×660（BrowserWindow 最小尺寸）以及 840/820/600/500/400 模拟宽度，经典/精简两版都无面板被隐藏，页面整体滚动、无横向溢出；浅色主题截图检查。未改变真实数据。
- 0.30.0 存档仓库：新增 `src/main/core/nbt.ts`（最小 NBT 解析器，只读 level.dat 的 LevelName / LastPlayed / Version.Name / DataVersion）与 `src/main/core/worldVault.ts`。`WorldSummary` 列出每个 `saves/<folder>` 的名称、版本、大小、文件数、最后游玩、icon.png data URL、备份份数与总量；备份目录已存在但源世界被删的条目以 `present:false`「仅备份」出现。备份写入 `<instance>/backups/worlds/<world>/<id>/world` + `manifest.json`，用文件流、Transform 计数、实测 bytes/speed 和 activeFiles 推进；跳过 `session.lock`，逐文件保留 mtime，失败/取消删除半成品。每个世界按 `worldBackupLimit`（默认 10，1–30）保留最新备份，旧备份自动清理。恢复先把备份复制到 `saves/.windletter-restore-*`，当前世界存在时先写 `kind:'restore'` 安全备份，再改名交换并清理旧目录；失败会尝试回滚原名。`LoaderInstanceRequest` 无关；新增 `worlds:list/backups/backup/restore/delete-backup/open-folder` IPC、preload `window.ccl.worlds`、`TaskState.kind='world'`、任务图标和完成提示。实例卡片新增「存档」按钮，`WorldVaultModal` 提供世界列表、单个/全部备份、备份记录、恢复/删除确认、自动备份开关和进度条；设置新增「存档备份」页（自动备份开关、保留份数、说明）。`LauncherSettings.autoWorldBackup`（默认 true）和 `worldBackupLimit`（默认 10）；加载器更新/回滚前自动备份所有世界，失败阻止更新，进度按字节映射到任务 3–10% / 2–10%。实测：中文世界名、1.21.1 版本、2.1 MB 大小、图标和最后游玩正常；备份进度字节不超过总量且 session.lock 不入包；limit=3 连续 4 次只留 3 份；修改世界后恢复会生成「恢复前」安全备份并恢复内容；删除源世界后仍可恢复；UI 备份全部、恢复、删除、取消 300 MB 备份（无残留）、浅/深色主题和实例卡片入口均验证；加载器更新前自动备份生成 kind=loader，关闭开关后跳过，更新失败时备份仍保留。未测试超大世界/磁盘写满和真正进游戏。备份为未压缩完整副本，删除实例会一并删除。
- 0.29.1 OptiFine 预览构建：原来的实现只列正式版，导致 26.2 这类“官方只有 K2 测试版”的版本显示“暂无此版本”，而 PCL2/官网能看到 pre5/pre4/pre3。`optifine.ts` 现在同时解析 `preview_OptiFine_*` / `pre*` 条目，`LoaderVersionView` 新增 `channel`、`releasedAt`、`note`：有正式版时只列正式版；没有正式版时列出按版本排序的最新 3 个预览构建（对应 OptiFine 官网当前展示），从条目 `_id` 的 ObjectId 时间戳取 UTC 日期，`forge: "Forge N/A"` 标为「不兼容 Forge」。下载页行状态显示「3 个测试版可用」，版本行显示 `HD U K2 pre5` + 「测试版 · 2026/10/20 · 不兼容 Forge」，并加提示说明测试版不稳定/不兼容 Forge。安装器默认仍优先正式版；预览构建可使用同一静默安装链路。实测 26.2 列表恰为 pre5/pre4/pre3，日期与官网 20.10/16.10/15.10 一致；用 26.2 原版夹具安装 pre5 成功，生成 `26.2-OptiFine_HD_U_K2_pre5`、补丁 jar 与正确 classpath。26.3 仍无任何构建。
- 0.29.0 OptiFine 独立安装：新增 `src/main/core/optifine.ts`，通过 BMCLAPI `optifine/<mc>` 读取正式构建（过滤 `preview_`/`pre` 预览版），按 `type_patch` 生成 `HD_U_J9` 这类版式；下载 `optifine/<mc>/<type>/<patch>` 安装器，校验 ZIP 内含 `optifine/Installer.class` 后，用临时 `appdata/.minecraft` 目录 junction 指向游戏目录，再以 `-Djava.awt.headless=true -Duser.home=<temp> -cp OptiFine.jar optifine.Installer` 静默执行官方安装器。安装器需要 `launcher_profiles.json`，没有时先创建空档案；清理时先删 junction 再递归删除临时目录，删除失败则保留临时目录，绝不跟随链接删游戏目录。`InstanceLoader` / `LoaderInstanceRequest` / `loaders:versions` IPC 新增 `optifine`；`installLoaderProfile` 走独立分支并复用 Forge 安装锁；`loaderInstances` 的 Java 准备覆盖 OptiFine，但安装器允许使用较新 Java（Forge/NeoForge 仍精确匹配），启动仍按游戏版本要求准备 Java。下载页把原来写死的「OptiFine 无」换成真实行：查询中 / N 个版本可用 / 暂无此版本 / 读取失败可点击重试；没有构建时显示解释说明。版本列表显示 `HD U J9` 并标最新推荐，安装后为独立版本（不含 Forge）。实测：26.3 返回空并显示「暂无此版本」；1.21.11 返回 J9/J8；用独立夹具从 UI 安装 J9 用时约 3 秒，生成 `1.21.11-OptiFine_HD_U_J9` 版本 JSON、`libraries/optifine/OptiFine/.../OptiFine-*.jar` 与 `launchwrapper-of-2.3`，临时目录清理、原版 jar 保留；含中文与空格的游戏路径也完成安装。启动命令 classpath 包含补丁 jar、launchwrapper，参数包含 `--tweakClass optifine.OptiFineTweaker`。随后从 J9 更新到 J8 再回滚到 J9，实例记录、任务浮窗、回滚记录和实例页 OptiFine 标签均正常。未实际启动 OptiFine 游戏客户端（需要补全原版运行库/资源并登录账户）。
- 0.28.0 主题扩展：`AccentName` 增加 `pink`（樱粉）、`violet`（藤紫）、`red`（绛红）、`slate`（石墨），共八套；`config.ts` / `appearance.ts` / SettingsPage 的 ACCENTS 同步，base.css 与 paper.css 各补 light/dark 变量。设置页主题色区域自动换成 8 个色块，沿用按钮、开关、导航、预览和背景氛围的现有变量链路。实测樱粉在浅色主题下正确套用 `--accent: #c45a84`，8 个主题色名称均渲染；其他三套使用同一变量结构。
- 0.27.0 双主页布局：上一版三栏工作台恢复为 `pages/HomePageClassic.tsx`，旧 `RightPanel` 恢复为 `components/ClassicRightPanel.tsx`（两者保留原逻辑与样式），精简版继续使用 `HomePage.tsx` / `RightPanel.tsx`。`LauncherSettings` 新增 `homeLayout: HomeLayout`（`simple` 默认 / `classic`），`config.ts` 只接受这两个值；App 的 CurrentPage 根据设置选择页面；设置 → 外观主题新增「主页布局」Segmented，切换即时生效并持久化。两版共享账户、实例、版本、启动与自定义背景数据。已用 5 个真实版本和设置切换截图验证；classic 默认右栏保持旧行为。
- 0.26.0 首页精简：HomePage 从三栏工作台改为「主卡 + 一个列表 + 活动栏 + 状态条」。主卡只保留当前实例/版本、目标图标与元信息、账户/Java/内存三项并可点击进入管理、大号启动按钮；版本和实例合并为一个分段列表，默认实例、最近使用优先，版本表继续用 LibraryTable（表头排序、右键菜单、启动/目录/导入/删除保留），列表头提供导入/管理实例或刷新/安装加载器/安装版本。删除左侧账户/快速启动/Java/最新版本卡，删除右栏常驻的任务/日志/系统状态三卡；RightPanel 改为默认收起，只显示一个「活动」入口，展开后保留任务与日志，磁盘/游戏内存/下载速度移到底部状态条。旧 workbench 逻辑（recent/pinned/latest/filter/viewMode）已移除，RightPanel 的 status props 删除。用 0 实例/3 版本夹具验证主卡、版本切换、活动栏展开和状态栏；浅色/深色主题截图检查。
- 0.25.0 自定义背景：`LauncherSettings` 新增 `backgroundImage`（`custom-<timestamp>-<random>.<ext>`）、`backgroundDim`（0–80，默认 35）和 `backgroundBlur`（0–24，默认 0）；`config.ts` 只接受 `custom-*` 图片名并夹取数值。新增 `src/main/core/background.ts`：`pickCustomBackground` 用原生文件对话框选择 PNG/JPEG/WebP/GIF/BMP/AVIF（≤40 MB），复制到 `<data>/backgrounds/`；`pruneBackgrounds` 在设置变更后删除旧文件；注册 privileged `windletter-bg` scheme，并在 ready 后 `protocol.handle` 只读取 `backgrounds` 下合法文件名，返回对应 MIME 和 immutable 缓存头。`settings:choose-background` IPC 与 preload `settings.chooseBackground` 返回文件名；设置页 `自定义背景` 行提供预览、选择/更换/移除、遮罩和模糊滑杆。`App.tsx` 按设置渲染固定背景层 + `var(--bg)` 遮罩层，`html[data-custom-background="true"]` 将 body 纸纹透明化并把 `--surface/--surface-2/--surface-3/titlebar-bg` 改为半透明；`index.html` CSP 的 `img-src` 加入 `windletter-bg:`。用 1600×900 测试图验证浅色、深色、60% 遮罩、8px 模糊、协议加载和移除后恢复纸纹；设置页预览与滑杆可见。原生文件对话框未做自动化点击回归，文件复制/持久化/协议/渲染/清理已验证。`npm run typecheck` 与 `npm run build` 通过。

### 已实现但未完成端到端验证

- 微软正版登录：设备代码流、Xbox Live、XSTS、Minecraft 登录与令牌刷新均已实现；自有 Azure 应用已注册并完成到 `login_with_xbox` 的真实测试，目前按预期返回 403 `Invalid app registration`，AppID Review 已于 2026-10-24 提交，等待每周审核。
- 登录自检（0.4.2）：账户窗口可逐步查看 OAuth、Xbox Live、XSTS、Minecraft Services 登录与档案的状态码/错误码，并复制脱敏诊断；403 会直接标记为 allowlist 未通过。
- 任务暂停/继续/取消已在测试数据中走通「运行 → 暂停 → 继续 → 取消」；取消启动、结束游戏按钮仍需完整 UI 回归。
- Java 8/16/17 运行时下载：选择逻辑通用，实测覆盖 Java 21 / 25；Mojang 已不提供 Java 8 运行时，1.16.5 及更早的 Forge 包需要系统自备 Java 8。
- Quilt 在 Java 21 及以下版本的启动：安装已实测，启动只验证到 Java 25 的预检拦截。
- CurseForge 模组搜索/安装已接入（需自备 API key）；CurseForge 整合包搜索/安装也已接入，并用本地 mock 完成搜索、版本列表和安装验证，真实 CurseForge key 环境尚未回归。
- 中文/拼音本地搜索：每页先取 20 个别名候选，再按游戏版本/加载器过滤，单页可能少于 20 条；底部“共约”是候选数，“已显示”是通过校验的数量。完整功能见 0.21.0/0.22.0 记录，后续可改为“凑满一页兼容结果”。
- 本地导入的超大覆盖文件、极端 zip 结构、断网中断后的重试恢复：未做压力测试。

### 明确未实现

- 整合包整体升级与实例级模组依赖冲突检查。
- 安装包代码签名与增量/差分更新；自更新只校验清单和 SHA-256，未签名安装包可能触发 SmartScreen。
- 皮肤/披风渲染。
- 服务器端文件管理、RCON（服务器中心目前只做状态探测、实例绑定与一键进服）。
- macOS / Linux 打包与完整兼容。

---

## 3. 技术栈与构建

- Electron 45 / electron-vite 6 / Vite 8
- React 19 / TypeScript 7 / Zustand 5
- lucide-react、adm-zip、pinyin-pro
- CodeMirror 6（`@codemirror/*` + `codemirror`，渲染层 bundle，不依赖运行时模块）
- electron-builder 26 + NSIS

常用命令：

```powershell
npm run dev            # 开发模式
npm run typecheck      # 主进程 + 渲染进程类型检查
npm run build          # 产出 out/
npm run dist           # 产出 NSIS 安装包
```

### 打包注意事项

`package.json` 的 `build.files` 只包含 `out/**/*`。主进程用到的 `adm-zip` 与 `pinyin-pro` 都已被 Vite 打进 bundle（见 `electron.vite.config.ts` 的 `exclude: ['adm-zip', 'pinyin-pro']`），CodeMirror 也由渲染层 bundle，均不依赖运行时 `node_modules`。

0.44.0 安装 CodeMirror 时，仓库原有的 `npm install` 仍会因 `builder-util` 锁文件里的 `source-map-support@^0.8.19` 与镜像缺失的 `adm-zip@0.8.1` 失败。临时做法：在独立空目录安装 `@codemirror/*` 与 `codemirror`，把 `@codemirror`、`@lezer`、`@marijn`、`codemirror`、`crelt`、`style-mod`、`w3c-keyname` 复制进本项目 `node_modules`，并手动把依赖写进 `package.json` / `package-lock.json`。干净机器上如果先修好 `builder-util` 锁文件与 adm-zip 来源，可恢复普通 npm 安装。

**安装包输出约定：**统一输出到 `D:\WindletterOut`，构建完成后删除同目录的 `win-unpacked`、`.blockmap` 和旧版本安装包，只保留当前版本的 `Windletter-Launcher-<版本>-setup.exe` 与自更新清单 `latest.json`。不要再为每个版本创建 `D:\WindletterNNNOut`；旧目录已于 2026-10-28 清理。

**自更新清单：**安装包复制到 `D:\WindletterOut` 后运行：

```powershell
npm run update:manifest -- "D:\WindletterOut\Windletter-Launcher-<版本>-setup.exe" `
  --notes-file build/update-notes.txt --out "D:\WindletterOut\latest.json"
```

脚本读取 `package.json` 版本，写入 schema 1、发布时间、大小、SHA-256 和说明；默认 `url` 为同目录文件名。把安装包与 `latest.json` 一起上传到同一个 HTTPS 目录，在「更多 → 启动器更新」填写清单地址即可。`--base https://host/path/` 可生成绝对下载地址。没有固定发布域名前不要把测试 feed 写进默认设置；配置为空时启动器不会联网检查。

**新增主进程依赖时**，要明确选择：

- 希望 bundle：加入 `externalizeDepsPlugin` 的 `exclude` 列表；
- 希望外置：保持默认，并确认 electron-builder 会把对应依赖带进安装包。

图标：

- `build/icon.png` 是由内置 Logo 渲染出的 512×512 源图。
- `build/icon.ico` 是 256/128/64/48/32/16 多尺寸 ICO，`package.json` 的 `win.icon` 指向它。
- 如需换品牌，替换这两份文件即可。

### 网络受限时的打包

electron-builder 首次构建会从 GitHub 下载 NSIS / winCodeSign 工具。常规镜像方案：

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

旧机器上还遇到过 Windows 文件占用（`EPERM` / `EBUSY`）和工具体下载失败。可用下面两个规避手段：

1. **跳过 Electron 解压**：直接使用已安装的 Electron 目录。

```powershell
npx electron-builder --win nsis `
  --config.directories.output="C:/Temp/windletter-dist" `
  --config.electronDist="C:/path/to/project/node_modules/electron/dist"
```

2. **本地提供构建工具**：从 npmmirror 手动下载以下三个文件，用本地 HTTP 服务提供：

```text
winCodeSign-2.6.0/winCodeSign-2.6.0.7z
nsis-3.0.4.1/nsis-3.0.4.1.7z
nsis-resources-3.4.1/nsis-resources-3.4.1.7z
```

```powershell
$env:ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL="http://127.0.0.1:8899/b"
$env:ELECTRON_BUILDER_BINARIES_ALLOW_HTTP="true"
npx electron-builder --win nsis --config.electronDist=".../node_modules/electron/dist"
```

> 覆盖 URL 必须带一个无冒号的路径段（示例中的 `/b`）。electron-builder 会用 URL 最后一段作为缓存目录名，如果直接用 `127.0.0.1:8899`，Windows 会因目录名含 `:` 而创建失败。

安装包未配置代码签名证书，Windows SmartScreen 可能提示未知发布者。

### 公开源码、构建密钥与 GitHub 发布

0.60.3 起公开源码，采用 PCL2-CE 同款密钥注入：

- `src/main/core/buildSecrets.ts` 不含 key；`electron.vite.config.ts` 在构建时把 `WINDLETTER_CURSEFORGE_API_KEY` 和 `WINDLETTER_DEFAULT_UPDATE_FEED` 替换成常量。
- 本地构建通过环境变量提供 key；没有 key 时回退到用户自备 key 或 MCIM 镜像，不会崩溃。
- 0.60.3 先由本地构建后通过 GitHub API 上传；0.60.4 起 `.github/workflows/release.yml` 已启用，在 `v*` 标签上运行：npm 安装、准备 Electron 二进制、类型检查、注入 `CURSEFORGE_API_KEY` Secret、打包 NSIS、生成绝对地址清单并创建 Release。普通 PR 不读取 Secret。0.60.4 工作流成功，用时 1 分 32 秒；修复了 lockfile 无效版本、PowerShell 配置参数和 CI Electron 二进制缺失。
- `.env*`、`src/main/core/*.secret.*`、安装包输出和日志均在 `.gitignore`；发布前运行密钥扫描。
- 安全边界：注入后的 key 仍存在于主进程 bundle 和公开安装包，可被逆向提取；PCL2-CE 也是如此。需要让 key 对安装包也不可见时，必须改成服务端代理，不能依赖客户端加密。
- 旧 0.60.2–0.60.4 安装包已经带有旧 key；公开源码/公开发布前建议在 CurseForge 控制台轮换。自动 workflow 已启用，仓库 Secret `CURSEFORGE_API_KEY` 已配置；不要在新 Issue/PR/日志中粘贴 key。

0.60.4 起发布流程：更新 `build/update-notes.txt` 和版本号，提交后推送 `v*` 标签；Actions 使用仓库 Secret `CURSEFORGE_API_KEY` 构建并创建 Release。仓库为 `muyi0736/windletter`，更新源为 `https://github.com/muyi0736/windletter/releases/latest/download/latest.json`。签名和增量更新仍未做。

更新源容错（2026-10-30）：当前网络里 `github.com` 解析到 `20.205.243.166` 会超时，但 `api.github.com`、`raw.githubusercontent.com` 与其他 GitHub IP 正常。`make-update-manifest.mjs` 新增可重复的 `--mirror`，Actions 会为安装包写入 `ghfast.top` 与 `gh-proxy.com` 两条备用地址；0.60.4 Release 的 `latest.json` 已补上这两条。本机更新源暂设为 `https://ghfast.top/https://github.com/muyi0736/windletter/releases/latest/download/latest.json`，清单经镜像读取，安装包仍按清单 SHA-256 校验。注意镜像只作为 manifest 的传输通道，默认更新源仍为 GitHub。

0.60.5 GitHub API 更新源：

- `updater.ts` 识别 `github.com/<owner>/<repo>/releases/...` 或 `api.github.com/repos/.../releases/latest`，优先请求 `api.github.com` 的 latest release，版本取 `tag_name`、说明取 release body、大小取 asset `size`、SHA-256 取官方 `digest`（`sha256:...`）。
- 安装包候选包括官方 asset API（`Accept: application/octet-stream`）、`ghfast.top`、`gh-proxy.com` 和 github.com 浏览地址；有多个候选时用首字节测速排序，镜像只负责搬运，完整性仍由官方 digest 校验。`net.ts` 的探测、分片和单连接下载统一使用 asset API 的 Accept 头。
- API 失败（限流 60 次/小时、无 digest、网络错误）时自动回退 `latest.json`；两者都失败才报错。非 GitHub 更新源行为不变。
- 本地实测：2026-10-30 用临时 0.60.3 构建读取官方 0.60.4，清单约 1 秒返回；asset API 16 段下载实测 1–6 MB/s，取消后保留分片；镜像清单路径分段约 3.5 MB/s。
- 真实更新：0.60.4 通过镜像清单下载 0.60.5（111.4 MB，峰值约 5.2 MB/s），SHA-256 校验通过，NSIS 静默安装并自动重启，ProductVersion 变为 0.60.5.0，账户与数据保留。切回官方 GitHub 更新源后，0.60.5 检查命中 API 限流（测试期间共用掉 60 次/小时），自动回退 latest.json 并显示已是最新；限流复位后已确认 API 直连恢复。公开安装包 `D:\WindletterOut\Windletter-Launcher-0.60.5-setup.exe`，SHA256 `d373d1e995a34a52a4085fffe2a0d9444e0b595c1f5bd950a293195a6aebeeb8`。

0.60.6 更新缓存与来源标注：

- 新增 `cache/updater-release-cache.json`，按 GitHub API URL 保存 `etag`、`fetchedAt` 和完整 Release 信息；读取时重新校验版本、大小、SHA-256 与全部 HTTPS 地址。
- GitHub API 请求带 `If-None-Match`；304 直接复用已验证缓存并刷新 `fetchedAt`。实测 304 仍会消耗 1 次未认证 primary rate limit（55→54），只节省清单传输，不能当作“免额度”；真正减少请求的是下一步。
- 启动静默检查在缓存不足 10 分钟时直接复用，不发网络请求（实测额度 55→55）；手动“检查更新”永远走网络，因此能及时发现新版本。0.60.7 把静默检查窗口延长到 6 小时，并增加 API 限额退避。
- API 失败先回退 `latest.json`（8 秒超时），再失败则使用上次成功缓存；状态新增 `source: 'api' | 'manifest' | 'cache'`，界面分别显示无标签 / “清单回退” / “上次缓存”，`checkedAt` 使用缓存时间。缓存缺失且两条网络路径都失败才进入错误态。
- 实测：用不存在的仓库和 5 分钟前的缓存触发 404 + 404，成功回退缓存并显示“上次缓存 / 5 分钟前检查”；真实 API 首次 200 写入 ETag，手动再次检查 304 复用；`npm run typecheck`、`npm run build` 通过。0.60.6 由 Actions 发布，安装包哈希以 Release 页为准。

0.60.7 限流退避：

- `AUTO_CHECK_CACHE_MS` 改为 6 小时：启动静默检查在 6 小时内直接复用结果，不再请求；手动检查仍然走网络（除非处于限额退避）。
- 新增 `cache/updater-rate-limit.json`（schema 1、API URL、until）。403 + `X-RateLimit-Remaining: 0` 或 429 时读取 `Retry-After` / `X-RateLimit-Reset`，写入恢复时间；恢复前所有检查直接使用缓存，不发起请求。成功 200/304 清除退避文件。
- `LauncherUpdateState.rateLimitedUntil` 进入状态与 UI：显示“限额退避”徽章、恢复时间（如 `2026-10-30 21:53`），缓存结果仍可用于判断版本；无缓存时限流会直接显示带恢复时间的错误。限额退避最长记录 24 小时，防止异常 header 卡死。
- 实测：预置 1 小时后恢复 + 1 小时前缓存，检查返回 `source=cache`、`rateLimitedUntil` 正确，GitHub 额度 60→60（未发请求），界面显示“限额退避”；无缓存时返回“GitHub API 限额，10/30 21:23 后恢复”。1 小时前缓存在静默检查中复活（额度 60→60），手动检查走 API（60→59）。`npm run typecheck`、`npm run build` 通过。
- 0.60.7 由 Actions 发布；安装包哈希以 Release 页为准。

0.60.8 KubeJS 实际运行验证：

- KubeJS 工作台「问题」页新增「实际运行」；有未保存标签时先要求保存，避免验证读磁盘旧内容。
- `kubeJsRuntime.ts` 使用 `previewServerPack` 选出服务端兼容模组并强制带上 KubeJS（含 kubejs* 附属），通过 `createServerPack` 生成临时服务端包，再复用 `verifyServerPack` 启动真实服务端；结束后删除临时 ZIP，测试目录和进程由既有验证器清理。
- `KubeJsRuntimeModal` 显示阶段、百分比、取消、服务端检查项、KubeJS 错误/警告和完整日志；错误带 `server_scripts/foo.js:12` 时点击跳转编辑器。
- 只支持 Fabric / Forge / NeoForge；`client_scripts` 只在客户端执行，结果里单独提示数量。无服务端/启动脚本、没有 KubeJS 模组、加载器不支持等情况会在启动前直接返回明确原因。
- `kubeJsRuntimeLog.ts` 从服务端日志提取 KubeJS 脚本/配方/标签报错；日志级别优先按 `[main/ERROR]` / `[main/WARN]` 标签判定，避免把 “Failed to parse recipe” 这类 WARN 误判为错误。用真实 miao 服务端日志验证：50 条 WARN、0 条 ERROR（上限 50）。
- 已实测：工作台入口与弹窗、未保存拦截、无脚本错误路径、取消、IPC 进度、解析器；0.60.10 安装版对 miao（Forge 47.4.16 / 1.20.1 / 307 模组，服务端包 286 模组）完成完整启动验证：43 个服务端/启动脚本 + 2 个 client_scripts，服务端首次 `Done (66.246s)`，发送 stop 退出码 0，导出的 `start-server.bat` 再次启动并 stop；总耗时 749 秒（含首次 Forge 安装与服务端 jar 下载），解析到 50 条 KubeJS 配方回退 WARN、0 条 ERROR，判定通过。完整日志在 `data/logs/serverpack-check/kubejs-runtime-6a8af34e-6620-4c63-b461-c2e30098b0f8-2026-10-31_00-16-09.log`。0.60.8 由 Actions 发布，安装包哈希以 Release 页为准。

0.60.9 更新下载线路优化：

- `net.ts` 新增 `probeThroughput`：对每个候选线路并行发 4 个 Range 请求（总计约 256KB），只有全部返回 206 才计入吞吐量，按实测字节/毫秒排序；失败时回退原有的首字节延迟排序。这样会过滤“延迟低但并行分段失败”的镜像，避免下载退化成单连接。
- `DownloadOptions.probeBytes` 仅由更新下载传入（≥32MB 时 256KB）；普通模组/资源下载仍用原来的延迟探测，避免增加小文件开销。
- 实测：本地假清单同时给出 API asset、ghfast、gh-proxy 三个候选，4 路探测约 3 秒后选择 API asset，16 段分片正常，取消后保留 16 个分片；之前 ghfast 选中后退化成单连接。当前免费 GitHub 线路本身只有约 0.3–0.8 MB/s，探测只保证选对线路，不能突破网络上限；要进一步提速需要 R2/OSS 等独立 CDN。
- 0.60.9 由 Actions 发布，安装包哈希以 Release 页为准。

0.60.10 多线路并行下载：

- `net.ts` 新增 `downloadFileMultiSource`：先对每个候选地址做 `probeRange`（8 秒超时），只保留大小一致且支持 206 的线路；至少 2 条才启用。
- 分段数取 `min(24, max(segmentCount, sources × 8))`：两条线路 16 段、三条 24 段，按线路轮转分配；每段独立续传，源地址/ETag 写入 `.part.segments.json`（schema 2）。
- 单条线路返回 200（不支持 Range）、401/403/404/429（限额/失效）时标记该线路不可用，后续分段自动换到其他线路；网络错误重试并切换，5 次后失败；全部线路失败时清理分片并回退原有单线路逻辑。
- 合并后按大小/SHA1（若提供）校验，更新器再做 SHA-256；取消时保留分片，继续下载按分段偏移续传。
- 实测：两个本地 HTTP Range 服务共享一个 8MB 随机文件，清单同时列两条线路；下载使用 16 段、两端口各 8 段交替请求，合并后 SHA-256 与清单一致，任务到达 ready。`npm run typecheck`、`npm run build` 通过。
- 0.60.10 由 Actions 发布；安装包哈希以 Release 页为准。

0.60.11 启动日志可读性：

- 新模块 `src/main/core/gameLogFormat.ts`：`GameLogAssembler` 把 Mojang `client-1.12.xml` 中 `<LegacyXMLLayout />` 产生的多行 `<log4j:Event>` 聚合成一条 `GameLogEvent`，解析 timestamp、level、logger、thread、CDATA message 与 Throwable；缺失闭合标签、出现下一个 Event、超长畸形块都有原文兜底。EventSet 包装行会被忽略；Mod List / classloader 这类上千行事件不再按普通行数截断（上限 20000 行 / 8MB）。
- `launcher.ts` 的 stdout/stderr `createLineBuffer` 改走 assembler；`LaunchLogLine` 新增可选 `level / logger / thread / detail`。系统消息照旧。`launch-*.log` 从 UTC 改为本地时间，格式变为 `[HH:mm:ss] [LEVEL] [logger / thread] message`，异常堆栈另起行；`--accessToken ...` 统一脱敏为 `[REDACTED]`，不写入磁盘。
- `ConsoleDrawer` 重做：级别徽章（SYS/OUT/INFO/WARN/ERROR/FATAL），短 logger + 悬停完整来源/线程；「全部 / 警告+ / 错误」筛选（警告+ 含错误），连续重复日志折叠为 `×N` 并显示最近时间；多行长消息和异常堆栈用 `<details>` 折叠；筛选、折叠、自动滚动写入 `localStorage`（`ccl-console-*`）。右侧日志预览只显示首行并带级别颜色。
- 控制台颜色跟随明暗主题：浅色纸面主题下是半透明亮色面板，深色主题下是暗色面板；`paper.css` 只保留纸面圆角和字体，并略微提高头部 / 工具栏的不透明度，避免自定义背景穿透影响读日志。此前浅色主题深色头部配浅色正文的混搭已消除。
- 实测：真实 ATM11 日志（2026-10-30 16:18 UTC）1301 个事件、1009 INFO / 271 WARN / 21 ERROR、4 个堆栈、4658 行 stdout，解析后事件数和级别完全一致、0 条 XML 残留；自定义 `logfixture` 版本 + 离线账户真实启动，18 条日志、Mod List 多行、ERROR 堆栈、spark ×5、原始 stdout 和令牌脱敏全部正确；控制台两种主题、自定义背景下的浅色半透明面板、筛选、堆栈、长文本、偏好持久化均已检查。`npm run typecheck`、`npm run build` 通过。
- 0.60.11 随 v0.60.13 批量发布。

0.60.20 服务端包 Additional Files 补全：

- 原因：官方 API 的 `GET /v1/mods/{id}/files` 不含 “Additional Files / Server Packs”；服务端包只通过客户端文件的 `serverPackFileId` / `alternateFileId` 关联（ATM9 客户端 7097953 → 服务端 7097957；ATM10 多个客户端版本各有自己的 serverPackFileId）。因此旧逻辑只看到 API 偶然标记的 ATM10 8.4 一条。
- 服务端模式现在从所有客户端文件收集关联 ID（排除已在 `/files` 中的文件），最多 20 个，按客户端日期倒序；用 Electron `net.fetch` 读取 `https://www.curseforge.com/minecraft/modpacks/<slug>/files/<id>`（浏览器 UA，8s 超时），解析 Next.js RSC 里的文件对象（fileName/displayName/fileLength/dateCreated/releaseType/isClientCompatible/flavors），并发 4，结果缓存 30 分钟；`isClientCompatible:true` 的 alternate 客户端文件会被排除，失败时保留 API 标记的服务端包。
- 下载回退：`downloadCurseForgeServerPack` 先试 API（有 SHA1 时校验），失败或没有 URL 时复用网页缓存，用 CDN 规则 `files/<id/1000>/<id%1000>/<fileName>` 下载，按网页 fileLength 校验；网页不提供 SHA1，因此以大小+HTTPS CDN 为准；取消/失败清理分片。IPC 请求新增可选 `slug`，由 UI 项目数据传入，避免额外项目查询。
- 实测：ATM9 服务端 17 条（最新 Server-Files-1.1.1 1,138,394,395 B），ATM10 19 条（8.4–6.1）；冷加载 5.5s/4.4s，页面缓存后更快；UI 服务端弹窗 17/19 行，ATM9 从 UI 启动下载后总大小正确，取消无分片残留。`npm run typecheck`、`npm run build` 通过；未完整下载 1GB 级文件。0.60.20 为本地构建，公开 Release 仍为 0.60.13。

0.60.19 CurseForge 服务端包下载：

- 下载页 CurseForge 整合包卡片新增「服务端」按钮，打开版本弹窗的服务端模式；`curseforge:modpack-versions` 新增 `scope: 'client' | 'server'`，服务端模式只返回服务端包，并最多翻 8 页（每页 50）避免较早服务端包被挤出第一页；客户端模式仍只返回客户端包。`getCurseForgeFileInfo` 增加 `allowServerPack` 选项和 `isServerPack` 返回值，客户端安装入口继续拦截服务端包。
- 新增 `downloadCurseForgeServerPack()`（`curseforgePack.ts`）：复用文件信息、SHA1/大小校验，保存到 `downloads/serverpacks/<安全整合包名>/<ServerFiles>.zip`；任务显示实时速度/已传输/总大小，完成后 `shell.showItemInFolder` 打开文件夹；取消或失败清理 `.part*` 分片。IPC `curseforge:download-server-pack` 使用 `serverPack` 任务类型、`projectId` 去重；store 的任务完成/失败 toast 按标题区分“下载服务端包”和“制作服务端包”。
- UI：服务端弹窗标题带「服务端包」，副标题说明不会创建客户端实例，列表下方提示保存位置，按钮为「下载服务端包」；服务端列表为空时提示该整合包没有服务端包。卡片按钮在服务端任务运行时显示「下载中」并禁用。
- 验证：本地 HTTPS mock API/文件服务覆盖客户端/服务端列表、文件名兜底、922,394 字节下载、SHA1、ZIP 可读、重复任务复用、取消清理；真实 ATM10（925200）服务端列表 1 条（1.2GB ServerFiles-8.4），客户端 49 条（第一项客户端 8.4），共 521ms。下载页真实搜索 ATM10 后卡片与弹窗在深色/浅色下截图检查；未完整下载真实 1.2GB 文件。`npm run typecheck`、`npm run build` 通过。0.60.19 为本地构建，公开 Release 仍为 0.60.13。

0.60.18 CurseForge 服务端包过滤：

- 原因：`listCurseForgeModpackVersions` 直接拿 CurseForge files 接口的前 50 个文件，按 `fileDate` 倒序；ATM10 的 `ServerFiles-8.4.zip`（1.2GB，`isServerPack: true`）比客户端包晚发布 7 分钟，所以排在第一位。`DownloadsPage.openPackVersions` 默认选 `list[0]`，用户直接点安装就下载了服务端包。
- 修复：`CfFile` 增加 `isServerPack` / `serverPackFileId`；`listCurseForgeModpackVersions` 过滤服务端包，API 缺少字段时用 `ServerFiles` / `ServerPack` 文件名兜底（客户端包不会被误杀，因为镜像正常返回 `isServerPack: false`）；`getCurseForgeFileInfo` 在安装入口再次拦截并提示“不能作为客户端整合包安装”。版本列表的其他字段和排序不变。
- 验证：隔离开发实例 + CurseForge 镜像调用 ATM10（925200）：版本数 50→49，第一项为客户端 `All the Mods 10-8.4`（205,853,510 B），无 ServerFiles 行；直接安装服务端文件 9366998 时任务在文件信息阶段失败，缓存目录无下载文件。`npm run typecheck`、`npm run build` 通过；未完整下载客户端整合包（约 206MB）。0.60.18 为本地构建，公开 Release 仍为 0.60.13。

0.60.17 整合包安装阶段并行：

- `importModpack` 不再串行执行「原版 → 加载器 → 整合包下载」：原版和加载器安装使用 `stageSignal` 在前台执行，`runPack()` 同时做本地复用、源站测速和包文件下载；两段通过 `stageAbort` 互相中止。任务进度由 `main / parallel / foreground / lastPack` 协调，安装段结束后自动把主进度切到整合包下载（64% 起），最后解压 overrides 到 100%。
- `TaskParallelState` 随 `TaskProgressInfo.parallel` → `TaskState.parallel` 传到界面；`TaskDock` 在主进度条下显示第二条“下载整合包文件 / 本地复用 / 测速”进度和文件数、速度。CurseForge 安装与批量本地导入的进度包装器也透传 `parallel`。任务完成、失败、取消、暂停后清空并行状态。
- 错误处理：整合包段失败会中止安装段并优先返回包错误；安装段失败会中止包段并返回安装错误；外层取消优先返回 `CancellationError`。`packPromise` 在创建时立即 `.catch()` 记录错误，避免后台段先失败造成未处理拒绝；失败清理沿用 0.60.16 的版本目录基线。
- 验证：当前 `modpacks.ts` 接入桩 I/O 覆盖 7 种时序（安装 500ms + 包 1200ms 总 1277ms；安装 900ms + 包 200ms 总 953ms；包/安装先后失败；取消；双向成功后的错误），`npm run typecheck`、`npm run build` 通过。真实应用隔离数据 + 1.20.1 + Modrinth CDN 夹具观察到安装 10%、包下载 50% 同时进行，取消后并行进度清空、实例和新版本目录清理、共享缓存保留；1180/1000 宽度、浅色/深色界面已检查。未完成一次真实整合包全量安装。
- 0.60.17 为本地构建，公开 Release 仍为 0.60.13，待下次批量同步。

0.60.16 整合包安装失败清理：

- 新增 `packCleanup.ts`。`importModpack` 开始安装前读取共享 `versions` 下的目录基线；失败/取消时对比当前目录，只删除本次新建、名称属于该 gameVersion 或 loader/loaderVersion、且未被已注册实例引用的版本目录，包括只下载了一半、还没有版本 JSON 的目录。清理后 `invalidateVersionCache()`。
- 共享 `libraries` / `assets` 属于可复用缓存，不删除；无法读取基线或清理失败时保留副本，不覆盖原始安装错误。并发安装同版本时以已注册实例引用为保护。
- 夹具：基线 `keep-base`，新建 `fake-game`、`neoforge-1.2.3`、`unrelated-new`、被实例引用的 `used-neoforge-1.2.3`；只删除前两个，其余保留；不存在 versions 目录返回空且不抛错。`npm run typecheck`、`npm run build` 通过；未跑真实失败安装的完整调用链。
- 0.60.16 为本地构建，公开 Release 仍为 0.60.13。

0.60.15 残留游戏进程检测：

- 新增 `runningGame.ts`：游戏进程 spawn 成功后写入 `running-game.json`（PID、instanceId、名称、versionId、gameDir、startedAt）；退出时按 PID 清理，避免旧记录误删新会话。
- 启动器重启后 `RunningGameNotice` 调用 `running-game:inspect`：先用 `process.kill(pid,0)` 确认存活，再用 PowerShell `Get-CimInstance Win32_Process` 读取进程名/命令行；PowerShell 不可用时回退 `tasklist`。命令行必须包含记录的 gameDir 或 versionId 才提示；PID 已死、命令行不匹配或记录损坏时自动清理。macOS/Linux 读取 `/proc`（如果有）。
- 提示条显示实例/版本、PID、启动时间；可“保留运行”（只隐藏，记录保留，下次启动仍会提示）或“结束进程”（ConfirmDialog 二次确认，`taskkill /pid /t /f`）。
- 实测：可控 Node 假进程带 `--gameDir` / `--version`，重启后提示出现；保留后记录保留；页面刷新提示再次出现；结束进程后 PID 消失、记录删除、提示消失；错误 gameDir 的进程不提示并清理记录。`npm run typecheck`、`npm run build` 通过。
- 0.60.15 为本地构建，公开 Release 仍为 0.60.13。

0.60.14 整合包源站测速：

- 新增 `packSources.ts`：从每个候选源站（镜像、官方、CurseForge 备用 CDN）各取一个 ≥512KB 的文件样本，用 4 路 Range 共 256KB 实测吞吐量，按 bytes/ms 从高到低排序，再用 `sortUrlsBySourceSpeed()` 重排每个下载任务的 URL。只有一个源站、没有合适样本或全部探测失败时保留原顺序；取消抛 `CancellationError`。
- `importModpack` 在本地复用之后、下载之前调用；任务显示“测速下载线路 · 主机 X MB/s · 主机 Y MB/s”，随后进入“下载整合包文件 · 本地复用 N”。探测失败不会阻塞安装。
- 实测：两个本地限速 HTTP 源共享 2MB 文件，慢源 100ms/16KB、快源 20ms/16KB，探测得到 1.76 / 0.52 MB/s，快源排序第一；单源返回空数组。`npm run typecheck`、`npm run build` 通过；未用真实整合包冷装复测。
- 0.60.14 为本地构建，公开 Release 仍为 0.60.13，下次源码同步时一并更新。

0.60.13 一键进服 Quick Play：

- 症状：服务器中心“启动并进服”只启动游戏，没有进入服务器。真实 ATM11 日志显示游戏打印 `Completely ignored arguments: [--server, e75f3.mc5173.cn, --port, 52460]`；新版 Minecraft / NeoForge 已不再识别旧版 `--server` / `--port`。
- `version.ts` 新增 `hasQuickPlayMultiplayer()`，检查版本（含继承合并后的 NeoForge/Forge 参数）是否包含 `--quickPlayMultiplayer`。有服务器目标且支持 Quick Play 时，启用 `is_quick_play_multiplayer`，把 `${quickPlayMultiplayer}` 填成 `host:port`；游戏参数里已有 `--quickPlayMultiplayer`，不再追加旧参数。旧版本没有该入口时仍回退 `--server` / `--port`。
- IPv6 使用 `[host]:port`；不启用 `--quickPlayPath`，避免传入空路径。`featuresForSettings` 的其他行为不变，库/JVM 规则仍使用原 features。
- 实测：真实 NeoForge 26.1.2 解析后参数含 `--quickPlayMultiplayer e75f3.mc5173.cn:52460`，无 `--server` / `--port`；IPv6 为 `[::1]:25565`；合成旧版 JSON 回退旧参数；无服务器目标时不传进服参数。2026-10-31 01:47 安装版 0.60.13 通过 `servers.launch` 实际启动 ATM11 进 AVT：日志 `Connecting to e75f3.mc5173.cn, 52460`，随后接收到服务器同步配置（Refurbished Furniture、Silent Gear 96 traits / 159 materials），SLP 显示 1/10 在线、样本 MUYI1028，未出现 `Completely ignored arguments`；测试日志 `data/logs/launch-2026-10-30T17-41-06-555Z.log`。测试结束后通过启动器结束游戏并关闭。`npm run typecheck`、`npm run build` 通过。
- 0.60.13 随本次批量发布到 GitHub Release。

0.60.12 整合包本地复用与下载并发：

- 新增 `src/main/core/packReuse.ts`。安装整合包前按 `mods` / `resourcepacks` / `shaderpacks` / `datapacks` 扫描本机实例；如果实例是 external 类型，还会扫描 `external.baseDir` 本身和同级 `versions/*`，因此 PCL2 / HMCL 里其他版本的 mods 也能复用；最后扫描共享 `gameDir` 及其 versions。根目录上限 240，扫描文件上限 60k，目录深度 2，跳过 `.part` / `.disabled` / 符号链接。
- 只复用 basename 和大小完全一致、且 SHA1 校验通过的候选；命中后先 `fs.link`，跨卷或权限失败再 `fs.copyFile`，复制后再校验 SHA1。复用失败、扫描失败或单个文件被锁不会让安装失败；取消会抛 `CancellationError`。
- 整合包任务新增阶段：先显示“查找本地模组”，复用过程显示“本地复用 · x/y”，下载阶段显示“下载整合包文件 · 本地复用 N”。复用文件会被 `runDownloadPool` 当作已存在文件计入当前/总量，所以进度不会重复计算。
- 下载层 `DownloadOptions.hostConcurrency` 和 `runDownloadPool` 同名选项可覆盖单主机并发；整合包文件安装使用 `min(64, max(32, downloadConcurrency))`，默认 32，其他下载仍保持默认 16。
- 实测：真实 ATM11 的 3 个 jar 硬链接复用成功（源/目标同 inode，5,999,917 字节）；错误 SHA1 不落盘；取消返回 `CancellationError`。按当前 5 个实例收集到 15 个根目录、扫描 1188 个文件、1 个命中；ATM11 的 299 个文件 / 706.4 MB 与其他实例只有 2 个同名同大小文件 / 2.2 MB，所以当前重装 ATM11 本身收益有限，冷下载主要靠并发提升。限速本地服务器 32 个 1 MB 文件：单主机 16 并发 14.2 秒 / 2.25 MB/s，32 并发 7.1 秒 / 4.52 MB/s。`npm run typecheck`、`npm run build` 通过。
- 0.60.12 随 v0.60.13 批量发布。

---

## 4. 目录与模块职责

```text
src/
  main/
    index.ts          窗口、生命周期、全部 IPC handler、关闭时的游戏提示
    core/
      config.ts       配置文件、设置默认值/清洗、账户持久化、路径
      auth.ts         离线账户、微软设备代码流、令牌刷新
      mojang.ts       版本清单/版本 JSON/Java 运行时清单与缓存
      mojangTypes.ts  Mojang 元数据类型
      source.ts       官方与 BMCLAPI URL 映射、平台键
      net.ts          fetch 封装、下载、SHA1、断点续传、分主机并发、停滞切换、取消
      contentCache.ts SHA1 内容缓存、硬链接复用、跨卷复制回退
      downloadPool.ts 并发下载、跳过已存在文件、实时进度
      progress.ts     进度比例工具
      rules.ts        库规则判断
      version.ts      版本继承合并、classpath、JVM/游戏参数
      versions.ts     已安装版本扫描、删除、detect loader
      installer.ts    原版安装/补全编排
      java.ts         Java 扫描、探测、选择、运行时安装
      launcher.ts     启动状态机、natives、进程、日志、停止
      tasks.ts        后台任务管理（install/java/modpack/loader/preset）
      instances.ts    实例元数据、目录、列表、删除、最近启动时间
      loaders.ts      Fabric / Quilt 加载器版本解析、profile 安装、运行库下载
      modpacks.ts     .mrpack 解析、原版/加载器编排、模组下载、overrides 解压
      modrinth.ts     Modrinth 搜索、整合包版本选择、.mrpack 下载
      mods.ts         模组搜索/版本列举/指定版本安装与下载、必需依赖解析、实例模组管理
      localPacks.ts   本地整合包扫描、外部启动器实例解析、导入时补齐运行环境与复制内容
      curseforge.ts   CurseForge API 封装、模组搜索、文件列表、指定 fileId 选择
      contentLedger.ts 内容账本、SHA1/CF 指纹识别、更新检查、备份/安全更新/回滚与 changelog
      presetMods.ts   预设模组持久化、jar 元数据识别、兼容版本检查、按预设补齐安装
      searchAliases.ts 常用模组中文名/简称/缩写索引、加载器变体、搜索查询转换与中文名查询
      customSearchAliases.ts 自定义中文搜索别名持久化、启动加载与搜索索引注册
      mcmodAlias.ts   用户粘贴 MC百科 class 链接后的标题/CurseForge/Modrinth 链接解析
      loaderInstances.ts 在原版上创建加载器实例、为现有实例安装并切换加载器版本
      skins.ts        微软账户皮肤读取、校验与磁盘/内存缓存
      serverPing.ts   Minecraft Server List Ping、SRV、MOTD/图标/在线人数解析
      servers.ts      服务器书签持久化、CRUD、状态刷新与一键进服
  preload/
    index.ts          contextBridge 暴露 window.ccl
    index.d.ts        Window 全局类型
  renderer/
    index.html        CSP 与入口
    src/
      App.tsx         启动屏、页面切换、主题应用
      store.ts        Zustand 全局状态与 IPC 事件订阅
      components/     标题栏、任务浮窗、日志控制台、账户、版本选择、故障医生、通用 UI
      pages/          启动、实例、服务器、下载、设置、更多
      styles/         base.css（令牌/通用）、components.css、pages.css、instances.css、paper.css（纸墨设计层）、servers.css、doctor.css
      lib/            format、clipboard
  shared/
    types.ts          主进程/渲染进程共享的完整契约（LauncherApi 等）
build/                应用图标
docs/                 交接与维护文档
```

### 界面系统（0.3.0）

- 设计方向：纸墨极简。暖白纸面 / 石墨暗色，细 hairline 分割线，单一低饱和青绿点缀；不使用发光、彩色渐变和厚重阴影。
- 令牌集中在 `styles/paper.css` 的 `:root` 与 `[data-theme="dark"]`；四套主题色映射为低饱和的青/蓝/绿/陶土。
- 字体：`Segoe UI Variable` 做界面，`Cascadia Mono` 做 8–9px 的标签、计数和路径；标题使用 display 字体与更紧的字距。
- 主操作使用墨色/骨白实底，行级操作使用 hairline 描边；卡片圆角 8–10px，主面板 16px。
- 启动动画在 `components/SplashScreen.tsx` + `paper.css` 的 `.splash` 段：线稿方块、逐字字标、扫描进度线；最短展示 900ms，完成后淡出。`prefers-reduced-motion` 下跳过描边与逐字动画并缩短等待。
- 上次主题/主题色缓存在 `localStorage`（`ccl-theme` / `ccl-accent`），用于在配置读取前决定启动动画首帧，避免明暗闪烁。
- 新页面优先复用 `.card`、`.button`、`.text-input`、`.badge`，避免重新引入旧的渐变和 glow 样式。

### IPC 契约

唯一权威定义：`src/shared/types.ts` 中的 `LauncherApi`。  
界面侧只通过 `window.ccl` 调用，preload 中按域组织：`window`、`app`、`settings`、`updater`、`auth`、`versions`、`instances`、`presets`、`searchAliases`、`mods`、`modrinth`、`localPacks`、`java`、`launch`、`tasks`、`logs`、`servers`、`diagnostics`、`ledger`。

主进程 IPC channel 集中在 `src/main/index.ts` 的 `registerIpc()`。

事件是单向推送：

- `window:maximized`
- `auth:changed`
- `tasks:update`
- `launch:state`
- `launch:log`
- `updater:state`

渲染进程在 `store.ts` 的 `wireEvents()` 中统一订阅，只执行一次。

### 一次启动的完整链路

1. 原版：`window.ccl.launch.start(versionId)`；实例：`window.ccl.instances.launch(instanceId)`。
2. `launcher.ts` 进入 `preparing` 状态，创建日志文件。
3. 如果是实例，读取 `instance.json`，把 `minecraft/` 作为游戏目录，共享目录仍是设置中的游戏目录。
4. `version.ts::resolveVersion()` 从共享目录读取版本 JSON，沿 `inheritsFrom` 合并（Fabric/Quilt profile → 原版）。
5. 校验账户；微软账户必要时刷新令牌。
6. `java.ts::ensureJavaForVersion()` 扫描 Java，不够则下载运行时。
7. `prepareNatives()` 解压 natives 到共享 version 目录。
8. `version.ts::buildLaunchCommand()` 生成 classpath 与参数；`baseDir` 用于资源/运行库，`gameDir` 指向实例目录。
9. 检查 classpath 中每个文件是否存在，缺失则提示补全。
10. spawn 游戏进程，转发 stdout/stderr 到日志；进入 `running`。
11. 退出时进入 `exited`，刷新版本/实例列表，异常退出自动打开日志。

### 实例与整合包链路

- 本地导入：`instances:import-file` 打开文件选择器 → `modpacks.ts::importModpack()`。
- 在线安装：`instances:install-modrinth` → 可传 `versionId` 指定整合包版本；未指定时 `modrinth.ts::pickModpackVersion()` 选择最新稳定版 → 下载 `.mrpack` → `importModpack()`。
- 安装顺序：解析索引 → 安装原版 → 安装加载器 profile 与运行库 → 下载模组文件（SHA1 校验）→ 解压 `overrides/` 与 `client-overrides/` → 写入 `instance.json`。
- 实例目录：`<数据目录>\instances\<id>\instance.json` 与 `minecraft/`。
- 共享内容：原版 `versions/<id>`、`libraries`、`assets`、Java runtime。一个整合包实例的模组/配置/存档不会影响另一个实例。
- 加载器 profile 也写入共享 `versions/`；UI 会隐藏被实例引用的加载器 profile，避免版本列表重复。

### 任务系统

`tasks.ts` 的 `taskManager` 负责任务生命周期。安装、Java 下载与整合包安装通过 `run()` 回调上报进度；`task.status` 只会是 `running/done/error/cancelled`。渲染进程 `store.ts` 在任务结束后 10 秒移除卡片，并用 toast 汇总结果。整合包任务完成后会刷新版本与实例列表，并自动选中新实例。

新增后台任务类型时，需要同步：

- `shared/types.ts` 的 `TaskState.kind`
- `TaskDock` 的图标与文案
- `store.ts` 的任务完成处理分支

---

## 5. 持久化数据与迁移

### 旧机器上的数据位置

| 数据 | 路径 |
| --- | --- |
| 启动器配置、账户令牌 | `<数据目录>\config.json` |
| 预设模组 | `<数据目录>\preset-mods.json` |
| 中文搜索别名（界面导入） | `<数据目录>\search-aliases.json` |
| 中文搜索别名（脚本批量表） | `<数据目录>\mod-aliases.json` |
| 缓存（版本清单等） | `<数据目录>\cache\` |
| 启动日志 | `<数据目录>\logs\` |
| Java 运行时 | `<数据目录>\runtime\` |
| 整合包实例 | `<数据目录>\instances\` |
| 游戏目录（共享资源） | 默认 `<数据目录>\minecraft`，可在设置中修改 |

安装版的数据目录跟随安装盘：`join(dirname(process.execPath), '..', 'WindletterData')`。例如程序在 `D:\启动器测试\windletter-launcher`，数据在 `D:\启动器测试\WindletterData`。可用 `WINDLETTER_DATA_DIR` 覆盖；源码开发模式仍使用 `%APPDATA%\Windletter`。

### 新设备不会自动带走

- 账户（包括旧机器上的测试账户 `CyanTester`）
- 已安装版本、整合包实例、Java 运行时、存档
- 已有账户的微软登录令牌（新设备需要重新登录；内置 Client ID 会随安装包提供）

根据合规和体积考虑，交接压缩包**不包含** `config.json`、游戏目录或 Java 运行时。新设备请重新添加账户、下载版本即可；也可以手动复制 `.minecraft` 后再用「补全文件」校验。

### 安全说明

- 微软 access token / refresh token 目前以明文保存在 `config.json`。
- 交接或备份时不要携带 `config.json`。
- 后续建议接入 Electron `safeStorage` 加密令牌，或抽取到系统凭据管理器。

---

## 6. 已知问题与技术债

按优先级排列：

1. **微软正版登录受 allowlist 限制**。Minecraft Services 目前只放行白名单内的 Entra Client ID；新注册应用在最后一步会返回 403。AppID Review 已于 2026-10-24 提交，审核按周进行；获批前用账户窗口的「登录自检」确认状态（403 = 未通过，五步全绿 = 已放行）。0.4.9 起内置 Client ID，界面不再提供填写入口，外部启动器桥接也已从 UI 移除；allowlist 通过前，正版登录仍会停在最后一步。
2. **Forge / NeoForge 安装依赖官方 installer**。已通过真实运行 installer 实现，安装期间会备份/恢复原版 jar；NeoForge 官方 Maven 在部分网络不可达，默认改用 `neoforged.forgecdn.net` 并改写 installer 内嵌地址。安装失败时错误信息会带 installer 尾部日志。
3. **Quilt 在 Java 25 上不可用**。Quilt Loader 0.20.0-beta.9 仍使用 ASM 9.5，无法读取 Java 25 的 class 文件（major 69）。`modpacks.ts` 会在导入 26.x 的 Quilt 整合包时提前拦截；等 Quilt 上游升级 ASM 后需要移除该限制并回归测试。
4. **整合包仅支持安装与版本选择**。下载中心可拉取 Modrinth 整合包的全量版本并指定安装；整包升级/回滚已在 0.32.0 移除，更新整合包请重新安装或导出后重新导入。
5. **Windows 专用代码**：classpath 用 `;` 拼接；停止进程使用 `taskkill`；打包目标只有 NSIS。移植到 macOS/Linux 需要改用 `path.delimiter`、进程组 kill，并补充平台打包配置。
6. **启动器重启后失去正在运行的游戏句柄**。关闭启动器时游戏会继续运行，但新开的启动器不知道旧 PID，无法从界面结束它。
7. **下载层已支持缓存与续传，但仍有边界**：缓存默认上限 4 GB 并按 mtime LRU 清理，可在设置调整或关闭；跨卷缓存会复制文件；服务器忽略 `Range` 时只能从头重下；没有跨进程下载锁；也没有自动源测速与动态并发。4 MB 以上文件会使用 4–8 路分段下载，单个文件会占用多个连接，服务器限流或分段支持不佳时会回退单连接；分段失败会按段重试并从断点继续，但真实 CDN 的长时间中断恢复仍需回归。
8. **切换游戏目录会让已有实例失效**。实例只保存实例目录，启动时仍从设置中的共享游戏目录读取 `versions/libraries/assets`；切换 `gameDir` 后需要重新安装原版/加载器，或把旧目录的资源迁移过去。后续应把共享资源根目录与实例绑定或做迁移提示。
9. **Natives 仍按加载器 profile 共享**。同一 profile 的多个实例共用 `versions/<profile>/natives`，当前单实例运行没有问题；将来支持多开时需要按实例隔离。
10. **Java 运行时官方下载较慢**。BMCLAPI 不镜像 runtime 对象文件，所以 `runtimeFileCandidates()` 让官方地址优先；国内网络首次准备 Java 可能需要等待。
11. **配置与缓存错误大多静默处理**，排查问题时应优先看用户数据目录和主进程控制台。
12. **测试覆盖仍然很少**。`npm run test:download` 已覆盖中断续传、SHA1、缓存硬链接、停滞切换和分主机并发，但还没有统一测试运行器；`.mrpack` 校验、路径安全、加载器 profile 合并仍依赖人工回归。建议后续把这些逻辑抽成纯函数并接入 Vitest。
13. **未启用代码签名**，安装包可能触发 SmartScreen。
14. **`.mrpack` 安全边界**：路径做了越界与盘符检查，下载只允许 HTTPS 公网地址，覆盖文件有单文件/总量上限；但尚未做完整 fuzzing，也未接入杀毒扫描。
15. **样式分层较多**：`base/components/pages/instances/paper` 五层 CSS 叠加，新增组件时容易发生覆盖冲突。后续可在稳定后合并为基础令牌 + 组件样式两层，并把 `paper.css` 中的设计令牌抽成独立主题文件。
16. `tasks.ts` 中 `updateStatus()` 当前未使用，可删除或接入任务状态变更。
17. **外部实例的边界**：各盘符 `.minecraft\versions` 下带 `mods` 的版本包会以 external 实例引用原目录，不复制文件；游戏、模组、存档与原启动器共享，删除实例只移除引用。Forge / NeoForge 启动要求精确 Java 主版本，缺少时会自动下载运行时，但也会优先检测 `.minecraft\runtime` 中现成的运行时。CurseForge / Prism / MultiMC / Modrinth App 实例仍采用复制导入，超大实例的复制阶段只有阶段性进度。批量添加按顺序执行，遇到错误会停止，已完成的项目会保留。`.mrpack` 文件默认走第三方 MCI Modrinth 镜像，官方 CDN 作为回退；镜像为第三方服务，可用性和隐私策略不受本项目控制，可在设置中关闭。
18. **CurseForge 整合包安装的边界**：需要用户自己的 API key；安装时会对 manifest 中每个文件单独请求 CurseForge API，大包会较慢并可能触发限流。任意必需文件的 `downloadUrl` 为 null 时会中止并提示手动页面，不做 CDN 拼接绕过。当前只下载 manifest 列出的文件，不额外解析模组依赖。
---

## 7. 后续路线

整合包首期（本地 `.mrpack`、Modrinth、Fabric/Quilt、实例）已经落地。下一步建议按以下顺序推进：

### 7.1 Forge / NeoForge 支持（已完成）

- 已接入 Modrinth 的 Forge / NeoForge 整合包。
- `loaders.ts` 负责获取 installer、准备 Java、运行 installer、备份/恢复原版 jar、解析生成的 profile。
- NeoForge 使用 forgecdn 镜像并改写 installer 内嵌的官方 Maven 地址；legacy 1.20.1 profile 会重命名以避免与 Forge 冲突。
- UI 的 `supported` 判断已覆盖 Fabric / Quilt / Forge / NeoForge。

### 7.2 整合包版本安装（整包升级已移除）

- 安装前选择具体版本（Modrinth / CurseForge）已完成。
- 整包升级/回滚、跨版本手动模组隔离、升级风险提示及相关 IPC/类型/UI 已在 0.32.0 全部移除；保留整合包版本选择安装、加载器更新/回滚、存档备份、补全文件与实例内启停模组。

### 7.3 可靠性

- HTTP Range 断点续传，尤其是原版资源与 Java runtime。
- 安装事务化：共享文件可以复用，但实例目录应在失败/取消时完整回滚（当前已回滚实例目录）。
- 记录并恢复正在运行的游戏 PID，或至少在重启后提示「上次游戏可能仍在运行」。
- 切换游戏目录时迁移/校验已有实例的共享资源依赖。

### 7.4 测试

- 纯逻辑单元测试：`.mrpack` 索引校验、路径安全、版本继承、参数占位符、加载器选择。
- 集成测试：本地 HTTP 模拟 Modrinth API 与文件下载，覆盖成功、校验失败、取消、404。
- 人工回归：原版安装/启动、Fabric 整合包、Quilt 1.21.x、Forge/NeoForge、含 `client-overrides` 的包、实例删除与共享版本保护。
- 为 ES/类 Linux 保留 `path.delimiter` 与进程组终止的测试位。

### 7.5 安全

- 使用 `safeStorage` 加密微软令牌。
- 对 `.mrpack` 做 fuzzing；限制索引文件数量/大小与 URL 域名策略。
- 发布前接入代码签名。

---

## 8. 新设备接手检查清单

- [ ] 解压源码包，确认目录包含 `src/`、`package.json`、`package-lock.json`、`docs/`、`build/`。
- [ ] Node.js ≥ 22，执行 `npm ci`。
- [ ] `npm run typecheck` 通过。
- [ ] `npm run dev` 能打开启动器。
- [ ] 添加离线账户并安装一个原版版本。
- [ ] 实际启动成功、日志控制台有输出。
- [ ] 进入「实例」→ 从 Modrinth 安装一个 Fabric 整合包并启动成功。
- [ ] 导入一个本地 `.mrpack`，确认 `overrides` 与 `client-overrides` 已写入实例目录。
- [ ] 删除测试实例，确认共享原版文件/运行库仍在。
- [ ] 如需微软登录，账户窗口直接登录（Client ID 已内置）；若报 403，用「登录自检」确认 allowlist 状态。
- [ ] 如需打包，先试 `npm run dist`，失败再看第 3 节镜像/占用规避方案。
- [ ] 不要复制旧机器的 `config.json`，除非明确需要迁移微软登录凭据。
- [ ] 旧机器如仍有 `javaw.exe`（验证时启动的实例），在游戏内正常退出即可。

---

## 9. 快速索引

| 想改什么 | 从哪里开始 |
| --- | --- |
| 新增设置项 | `shared/types.ts` → `config.ts` 默认值/清洗 → `store.ts` → 设置页 |
| 新增页面 | `PageKey` → `TitleBar` 导航 → `App.tsx` → 新页面 + CSS |
| 调整下载源 | `core/source.ts`、`core/mojang.ts`、`network` 相关 |
| 调整下载缓存/续传 | `core/contentCache.ts`、`core/net.ts` |
| 清理内容缓存 | 删除 `<数据目录>\cache\objects` |
| 调整启动参数 | `core/version.ts::buildLaunchCommand()` |
| 改启动状态/日志 | `core/launcher.ts` + `store.ts::wireEvents()` |
| 改 Java 匹配 | `core/java.ts` + `selectJavaRuntime()` |
| 改整合包导入 | `core/modpacks.ts`、`core/instances.ts`、`pages/InstancesPage.tsx` |
| 改 Modrinth 搜索/安装 | `core/modrinth.ts`、`main/index.ts` 的 `instances:*` / `modrinth:*` |
| 加 Forge 加载器 | 新建 `core/loaders/forge.ts`，接 `modpacks.ts` 的加载器分支 |
| 改实例启动目录 | `core/launcher.ts` 的 `gameDir` / `baseDir`，`core/version.ts` 的 `BuildCommandOptions` |
| 安装包配置 | `package.json` 的 `build` 字段 |
| 品牌图标 | `build/icon.png` / `build/icon.ico`、`components/visuals.tsx` |

有疑问时优先阅读：`src/shared/types.ts`、`src/main/index.ts`、`src/renderer/src/store.ts`。这三个文件能还原大部分系统行为。
