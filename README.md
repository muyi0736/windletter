# 风信启动器

**Windletter Launcher** —— 风有信，月无边。一个受 PCL2 易用体验启发的 Minecraft Java 版启动器，使用 Electron、React 与 TypeScript 构建，界面、插画与动效均为原创。

[下载最新版](https://github.com/muyi0736/windletter/releases/latest) · [交接文档](docs/HANDOFF.md) · [版本与验证记录](docs/CHANGELOG.md) · [安全说明](SECURITY.md)

## 功能概览

**游戏与实例**：原版、快照与远古版本；Fabric / Quilt / Forge / NeoForge / OptiFine。支持整合包搜索、`.mrpack` / ZIP 导入、原版实例、多版本文件夹、同一加载器多实例、实例迁移与克隆。自动准备 Java，提供启动前体检、崩溃分析和五步登录自检。

**下载与搜索**：PCL2 式下载中心，Modrinth 与 CurseForge 双源合并；中文名、常用简称、全拼和拼音首字母搜索，带总数与分页。4 MB 以上文件自动分片，断点续传、候选线路测速、镜像回退，并提供下载代理和缓存管理。

**内容与备份**：在实例内搜索安装模组、资源包、光影与数据包；内容账本通过 SHA1 / CurseForge 指纹识别文件。更新前自动备份和快照，失败自动回滚；另有预设模组、存档仓库、加载器更新与回滚、统一备份管理和只读资源预览。

**KubeJS 工作台**：全屏编辑器、真实目录树、多标签与历史 diff；实例物品 / 配方 / 标签索引和图标；配方、标签、机器 / 祭坛可视化生成与已有配方导入；AST 语义预检、问题一键修复和日志定位；可生成临时服务端实际运行验证，检查脚本、配方和标签注册报错；AI 释意、选区改写与配方问答，均显式触发并支持本地降级。

**服务器**：服务器档案、彩色 MOTD、延迟与在线玩家（Mojang / LittleSkin 皮肤）、绑定实例一键进服；可制作整合包服务端包，并做静态检查和真实启动验证。

**桌面体验**：纸墨极简双主题与八套主题色、自定义背景、1680px 工作台等比缩放、`Ctrl+K` 命令面板、游戏时长周报、截图画廊、启动动画与省内存模式。

## 下载与安装

Windows 10/11 x64。安装包由 GitHub Actions 构建并发布到 [Releases](https://github.com/muyi0736/windletter/releases/latest)。

安装版把配置、账户和日志放在安装目录旁的 `WindletterData`，游戏目录默认是其中的 `minecraft`；可用 `WINDLETTER_DATA_DIR` 覆盖数据目录。源码开发模式使用 `%APPDATA%\Windletter`。

启动器在「更多 → 启动器更新」检查新版本；发布构建的默认更新源为：

```text
https://github.com/muyi0736/windletter/releases/latest/download/latest.json
```

安装包必须通过大小与 SHA-256 校验，下载支持取消和断点续传；NSIS 静默升级后自动重启。安装包未做代码签名，Windows 可能显示 SmartScreen 提示。

## 本地开发

环境要求：Windows 10/11 x64、Node.js 22 或更高版本、npm。

```bash
npm install
npm run dev
```

检查与构建：

```bash
npm run typecheck
npm run test:download   # 本地 HTTP 冒烟：断点续传、SHA1、缓存硬链接、停滞切换、分主机并发
npm run build
npm run dist            # 生成 NSIS 安装包
```

Electron 或 electron-builder 的二进制下载被网络阻断时，可以使用镜像后重试：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" npm run dist
```

## 发布与更新

推送 `v*` 标签会触发 [`.github/workflows/release.yml`](.github/workflows/release.yml)：类型检查、准备 Electron 二进制、注入构建密钥、打包 NSIS、生成绝对地址 `latest.json` 并创建 GitHub Release。工作流只在标签上运行，普通 PR 不读取 Secret。

本地生成更新清单：

```bash
npm run update:manifest -- <安装包路径> \
  --notes-file build/update-notes.txt \
  --out release/latest.json
```

清单需要 `schema`、`app`、`version`、`url`、`size`、`sha256`，更新源只接受 HTTPS（本机 `localhost` 例外）；加 `--base https://…/` 可生成绝对下载地址，`--mirror <地址>` 可重复添加安装包备用线路。完整格式与校验规则见 [docs/HANDOFF.md](docs/HANDOFF.md)。

GitHub 更新源会自动改用官方 `api.github.com` Release API：版本、更新说明、安装包大小和 SHA-256 都来自官方元数据，安装包从 GitHub asset API 或测速选出的镜像线路下载，完整性仍按官方 SHA-256 校验。启动检查会复用 6 小时内的结果，API 请求使用 ETag 条件请求；遇到限额时会记录恢复时间，在恢复前不再请求，界面显示“限额退避”和恢复时间。API 不可用时先回退 `latest.json`，仍失败则使用上次成功缓存，并标注“清单回退”或“上次缓存”。GitHub 直连受限时也可以手动把更新源改为镜像清单，例如 `https://ghfast.top/https://github.com/muyi0736/windletter/releases/latest/download/latest.json`（或把前缀换成 `https://gh-proxy.com/`）。

## 公开源码与密钥

共享 CurseForge key 不进入仓库，发布构建时由 Vite `define` 注入；GitHub Actions 从仓库 Secret `CURSEFORGE_API_KEY` 读取。注入后的 key 仍存在于主进程 bundle 和安装包中，可以被逆向提取；需要真正保密时应改用服务端代理。没有注入 key 的源码构建可在设置中填写自己的 key，或切换到 MCIM 镜像。更多边界见 [SECURITY.md](SECURITY.md)。

## 已知限制

- 安装包未签名、无增量更新，每次更新下载完整安装包。
- 整合包整体升级已移除，需要重新安装或导出后重新导入；实例内单个内容支持安全更新与回滚。
- 服务器中心负责状态探测、实例绑定与一键进服，不包含 RCON 或服务端文件管理。
- CurseForge 作者关闭第三方分发时，相关文件需要手动下载导入。

## 文档

- [docs/HANDOFF.md](docs/HANDOFF.md)：环境准备、模块地图、IPC 契约、实例 / 整合包链路、验证范围与后续路线。
- [docs/CHANGELOG.md](docs/CHANGELOG.md)：各版本功能说明与实测记录。
- [SECURITY.md](SECURITY.md)：密钥边界、用户数据与漏洞报告。
- [scripts/mcmod-alias-import/README.md](scripts/mcmod-alias-import/README.md)：MC百科 class 页面转 `mod-aliases.json` 的批量脚本。

## 项目结构

```text
src/
  main/        Electron 主进程：下载、安装、Java、账户、启动、实例、更新
  preload/     contextBridge 类型化 API
  renderer/    React 界面（主页、实例、下载、设置、更多）
  shared/      主进程与渲染进程共享类型
scripts/       下载冒烟测试、更新清单、MC百科别名导入
build/         应用图标与更新说明
docs/          交接文档与版本记录
```

## 安全与声明

- 账户访问令牌与刷新令牌保存在本机配置文件中，不会上传到第三方服务器；配置文件目前未加密，请注意保护。
- 启动器不会下载或分发 Minecraft 游戏资源本体，所有资源均从官方源或公开镜像获取。
- 整合包元数据与文件来自 Modrinth 公开 API 与 CDN；内容归各自作者所有，请遵守对应许可。
- 本项目是非官方第三方软件，与 Mojang Studios、Microsoft、Modrinth 无关联，也未被其认可或赞助。
- 在线游戏需要拥有正版 Minecraft Java 版。离线账户仅建议用于本地测试与个人存档。

## 许可证

本项目以 [MIT License](LICENSE) 开源。Minecraft、Mojang 与 Microsoft 的相关名称和资源归其各自权利人所有。

## 致谢

- 界面与交互灵感来自 [PCL2](https://github.com/Hex-Dragon/PCL2) 与 [PCL2CE](https://github.com/PCL-Community/PCL2-CE)。
- 版本元数据来自 Mojang Piston Meta，镜像加速由 [BMCLAPI](https://bmclapidoc.bangbang93.com/) 提供。
- 使用 Electron、React、TypeScript、Vite、Zustand 与 Lucide 构建。
