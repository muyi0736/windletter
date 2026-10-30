# MC百科 class 页面 → 本地别名表

这个脚本只读取 **MC百科 class 模组页**，解析中文名、英文查询词和 CurseForge / Modrinth 链接，输出风信可以加载的 `mod-aliases.json`。

它不请求 MC百科搜索页，也不遍历站内页面。每个联网请求之间默认等待 700ms；请只转换自己需要的页面，并遵守 MC百科的使用条款。MC百科内容按 BY-NC-SA 3.0 使用。

## 用法

```bash
# 数字 class ID 或完整链接都可以
npm run aliases:mcmod -- 840 3358
node scripts/mcmod-alias-import/index.mjs https://www.mcmod.cn/class/840.html

# 从文本文件读取（每行一个链接/ID，# 开头为注释）
npm run aliases:mcmod -- --input classes.txt

# 直接写进风信数据目录，重启风信后生效
npm run aliases:mcmod -- --input classes.txt --data-dir "D:\启动器测试\WindletterData"

# 解析本地保存的 HTML，不联网
npm run aliases:mcmod -- --html-dir ".\saved-mcmod-pages"

# 覆盖而不是合并默认输出
npm run aliases:mcmod -- 840 --no-merge

# 把你自己 PCL 里的离线翻译快照转成批量表（不联网）
npm run aliases:mcmod -- --pcl-buf "C:\PCL\mcmod.buf" --data-dir "D:\启动器测试\WindletterData"
```

常用参数：

```text
--input <文件>     文本文件，每行一个 class 链接或数字 ID
--html-dir <目录>  读取本地 .html 文件
--pcl-buf <文件>   读取本地 PCL 的 mcmod.buf，提取中文名和项目链接
--output <文件>    默认 ./mod-aliases.json
--data-dir <目录>  写入 <目录>/mod-aliases.json
--delay <毫秒>     请求间隔，默认 700
--timeout <毫秒>   单页超时，默认 8000
--no-merge         不合并已有条目，直接覆盖
```

## 输出格式

```json
{
  "version": 1,
  "items": [
    {
      "id": "mcmod-840",
      "chinese": "通用拼音搜索",
      "query": "Just Enough Characters",
      "aliases": ["JECh"],
      "curseforgeSlugs": ["just-enough-characters"],
      "modrinthSlugs": ["justenoughcharacters"],
      "sourceUrl": "https://www.mcmod.cn/class/840.html",
      "addedAt": 1793088975051
    }
  ]
}
```

风信启动时会自动读取数据目录下的 `mod-aliases.json`，与界面导入的 `search-aliases.json` 合并；批量表不显示在别名管理弹窗里，重新运行脚本后重启风信即可刷新。

## 注意

- 默认输出 `mod-aliases.json` 用于批量表，最多 30000 条；`search-aliases.json` 仍由界面管理，最多 200 条。
- 脚本不会下载模组文件，只保存搜索所需的名称和链接。
- 如果页面没有 CurseForge / Modrinth 链接，该条目会被跳过；可以在 `--html-dir` 模式下离线检查原因。
- `--pcl-buf` 读取的是你自己本机 PCL 资源里的 `mcmod.buf`，生成结果仅供本地个人使用；不要把它随安装包、源码仓库或公开镜像分发。PCL 和 MC百科的数据各自受其许可约束。
