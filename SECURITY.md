# 安全说明

## 不要提交的内容

- `ai.json`、`config.json`、日志、账户令牌和任何 API key
- `WINDLETTER_CURSEFORGE_API_KEY` 等构建密钥，或包含密钥的 `.env`
- 本地安装包、运行目录、截图和测试数据

`.gitignore` 已排除 `.env*`、`*.pem`、`src/main/core/*.secret.*`、安装包输出和日志。

## CurseForge 共享 key

共享 key 不在源码中。发布构建由 GitHub Actions Secret `CURSEFORGE_API_KEY` 注入，本地构建通过环境变量提供。注入后的 key 会进入主进程 bundle 和公开发布的安装包，无法抵御逆向提取；PCL2-CE 采用相同边界。需要让 key 对安装包也不可见时，必须使用服务端代理，不能依赖客户端加密或混淆。

## 用户数据

用户自己的 AI key 通过 Electron `safeStorage`（Windows DPAPI）加密保存。用户自己填写的 CurseForge key 目前保存在本机 `config.json`，不要分享该文件。启动器不会上传账户令牌、存档、脚本或本地路径。

## 报告问题

请通过 GitHub Security Advisory 私下报告漏洞，不要在公开 Issue 中粘贴 key、令牌、账户信息或完整日志。
