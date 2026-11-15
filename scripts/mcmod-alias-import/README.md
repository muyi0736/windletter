# MC百科别名导入

把 MC百科 class 模组页转成启动器可用的 `mod-aliases.json`（中文名 + 搜索词 + CurseForge/Modrinth 链接）。只读 class 页，不抓搜索页；请求间隔默认 700ms。内容按 MC百科 BY-NC-SA 3.0 使用。

## 用法

```bash
npm run aliases:mcmod -- 840 3358                 # 数字 ID 或链接
npm run aliases:mcmod -- --input classes.txt      # 文本文件，每行一个
npm run aliases:mcmod -- --html-dir ./saved       # 离线解析本地 HTML
npm run aliases:mcmod -- --pcl-buf C:\PCL\mcmod.buf   # 读本机 PCL 快照，不联网
```

加 `--data-dir <WindletterData>` 直接写入数据目录，重启启动器生效；默认输出 `./mod-aliases.json`。

## 说明

- 批量表最多 30000 条，启动时自动加载；界面别名 `search-aliases.json` 最多 200 条。
- 只保存名称和链接，不下载模组文件；无 CurseForge/Modrinth 链接的条目跳过。
- `--pcl-buf` 结果仅供本地个人使用，不要随安装包/仓库/镜像分发。