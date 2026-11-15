<p align="center">
  <a href="https://github.com/muyi0736/windletter/releases/latest">
    <img src="docs/assets/readme/banner.png" width="880" alt="月月月启动器 Windletter — 风有信，月无边">
  </a>
</p>

<p align="center">
  <a href="https://github.com/muyi0736/windletter/releases/latest"><img src="docs/assets/readme/btn-download.png" width="260" alt="下载最新版"></a>&nbsp;&nbsp;
  <a href="docs/HANDOFF.md"><img src="docs/assets/readme/btn-handoff.png" width="260" alt="交接文档"></a>&nbsp;&nbsp;
  <a href="docs/CHANGELOG.md"><img src="docs/assets/readme/btn-changelog.png" width="260" alt="版本记录"></a>
</p>

**月月月启动器**（Windletter）—— 一个受 PCL2 启发的 Minecraft Java 版启动器。Electron + React + TypeScript，界面与动效原创。

<p align="center"><sub><b>v0.60.60</b> · Windows 10/11 x64 · MIT</sub></p>

## 功能

- **实例**：原版 / Fabric / Quilt / Forge / NeoForge / OptiFine；整合包导入、迁移、克隆，自动 Java。
- **下载**：Modrinth + CurseForge 双源，中文 / 拼音搜索，分片续传、测速选源、镜像回退。
- **内容**：模组 / 资源包 / 光影 / 数据包管理，备份、快照、回滚、存档仓库。
- **KubeJS**：全屏编辑器、配方 / 标签生成、语义预检、一键修复、临时服务端验证。
- **服务器**：状态 / MOTD / 在线玩家、一键进服、服务端包制作与验证。
- **体验**：双主题八色、自定义背景、Ctrl+K、时长周报、截图画廊、省内存。

## 下载与安装

Windows 10/11 x64，到 [Releases](https://github.com/muyi0736/windletter/releases/latest) 下载安装包，双击安装即可。数据默认放在安装目录旁的 `WindletterData`。

## 本地开发

需要 Node.js 22+。

```bash
npm install
npm run dev        # 开发
npm run typecheck  # 类型检查
npm run dist       # 打包安装包
```

## 文档

- [docs/HANDOFF.md](docs/HANDOFF.md) — 交接与架构
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — 版本记录
- [SECURITY.md](SECURITY.md) — 安全与密钥边界

## 许可与致谢

MIT。非官方第三方软件，与 Mojang / Microsoft / Modrinth 无关联；在线游戏需正版 Minecraft。
灵感来自 [PCL2](https://github.com/Hex-Dragon/PCL2)；元数据来自 Mojang / Modrinth / CurseForge，镜像由 BMCLAPI 提供。