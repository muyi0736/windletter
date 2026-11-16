import { useEffect, useState } from 'react'
import {
  BookOpen,
  Boxes,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  HardDrive,
  Heart,
  Info,
  Monitor,
  ShieldCheck,
  Sparkles,
  Terminal
} from 'lucide-react'
import type { DiskUsageReport } from '@shared/types'
import { useLauncher } from '../store'
import { cleanError, formatBytes } from '../lib/format'
import { IconButton, Spinner } from '../components/ui'
import { LauncherUpdateCard } from '../components/LauncherUpdateCard'
import { DownloadLogsModal } from '../components/DownloadLogsModal'
import { Logo } from '../components/visuals'

function relToBase(path: string, bases: string[]): string {
  const norm = path.replace(/\\/g, '/')
  for (const base of bases) {
    const bn = base.replace(/\\/g, '/').replace(/\/$/, '')
    if (norm.startsWith(bn + '/')) return norm.slice(bn.length + 1)
  }
  return norm
}

function groupOrphans(
  entries: { path: string; size: number }[],
  bases: string[]
): { key: string; count: number; size: number }[] {
  const map = new Map<string, { count: number; size: number }>()
  for (const entry of entries) {
    const key = relToBase(entry.path, bases).split('/').slice(0, 3).join('/')
    const group = map.get(key) ?? { count: 0, size: 0 }
    group.count += 1
    group.size += entry.size
    map.set(key, group)
  }
  return [...map.entries()]
    .map(([key, group]) => ({ key, ...group }))
    .sort((a, b) => b.size - a.size)
}

function openExternal(url: string) {
  void window.ccl.app.openExternal(url)
}

export function MorePage() {
  const appInfo = useLauncher((state) => state.appInfo)
  const settings = useLauncher((state) => state.settings)
  const openConsole = useLauncher((state) => state.openConsole)
  const toast = useLauncher((state) => state.toast)
  const [latestPath, setLatestPath] = useState<string | null>(null)
  const [downloadLogsOpen, setDownloadLogsOpen] = useState(false)
  const [disk, setDisk] = useState<DiskUsageReport | null>(null)
  const [diskBusy, setDiskBusy] = useState(false)
  const [cleanBusy, setCleanBusy] = useState<'libraries' | 'assets' | null>(null)

  useEffect(() => {
    void window.ccl.logs
      .latestPath()
      .then((path) => setLatestPath(path))
      .catch(() => setLatestPath(null))
  }, [])

  const openPath = (path?: string | null) => {
    if (!path) return
    void window.ccl.app.openPath(path).catch((error) => {
      toast('error', '无法打开文件夹', cleanError(error))
    })
  }

  const scanDisk = async () => {
    setDiskBusy(true)
    try {
      setDisk(await window.ccl.app.diskUsage())
    } catch (err) {
      toast('error', '磁盘扫描失败', cleanError(err))
    } finally {
      setDiskBusy(false)
    }
  }

  const cleanDisk = async (scope: 'libraries' | 'assets') => {
    if (!disk || cleanBusy) return
    const entries = scope === 'libraries' ? disk.orphanLibraries : disk.orphanAssets
    const bytes = scope === 'libraries' ? disk.orphanLibrariesBytes : disk.orphanAssetsBytes
    if (entries.length === 0) return
    if (!window.confirm(`确认删除 ${entries.length} 个未被任何版本引用的${scope === 'libraries' ? '运行库' : '资产'}文件（约 ${formatBytes(bytes)}）？删除后不可恢复。`)) return
    setCleanBusy(scope)
    try {
      const result = await window.ccl.app.diskClean(scope)
      toast('success', '清理完成', `删除 ${result.removed} 个文件，释放 ${formatBytes(result.freedBytes)}`)
      setDisk(await window.ccl.app.diskUsage())
    } catch (err) {
      toast('error', '清理失败', cleanError(err))
    } finally {
      setCleanBusy(null)
    }
  }

  const openLogFolder = () => {
    void window.ccl.logs.openFolder().catch((error) => {
      toast('error', '无法打开日志文件夹', cleanError(error))
    })
  }

  return (
    <div className="page page--more">
      <header className="page-head more-head">
        <div className="page-head-copy">
          <h1>更多</h1>
        </div>
      </header>

      <div className="more-scroll">
        <div className="more-grid">
          <section className="more-card card more-about">
            <div className="more-about-head">
              <Logo size={54} />
              <div>
                <h2>月月月启动器</h2>
                <span>月无边</span>
              </div>
            </div>
            <div className="more-links">
              <button
                type="button"
                className="link-button"
                onClick={() => openExternal('https://github.com/Hex-Dragon/PCL2')}
              >
                <ExternalLink size={13} />
                PCL2 项目
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => openExternal('https://github.com/PCL-Community/PCL2-CE')}
              >
                <ExternalLink size={13} />
                PCL2CE 项目
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => openExternal('https://www.minecraft.net/zh-hans')}
              >
                <ExternalLink size={13} />
                Minecraft 官网
              </button>
            </div>
          </section>

          <LauncherUpdateCard />

          <section className="more-card card more-logs">
            <header className="more-card-head">
              <span className="more-card-icon">
                <Terminal size={17} />
              </span>
              <div>
                <h3>日志与诊断</h3>
              </div>
            </header>
            <div className="log-path-box">
              <FileText size={14} />
              <span title={latestPath ?? undefined}>
                {latestPath ? latestPath.split(/[\\/]/).pop() : '还没有生成启动日志'}
              </span>
            </div>
            <div className="more-card-actions">
              <button type="button" className="button button--primary button--sm" onClick={() => openConsole('file')}>
                <Terminal size={14} />
                查看最近日志
              </button>
              <button type="button" className="button button--soft button--sm" onClick={openLogFolder}>
                <FolderOpen size={14} />
                日志文件夹
              </button>
              <button
                type="button"
                className="button button--soft button--sm"
                onClick={() => setDownloadLogsOpen(true)}
              >
                <Download size={14} />
                下载日志
              </button>
            </div>
          </section>

          <section className="more-card card more-files">
            <header className="more-card-head">
              <span className="more-card-icon">
                <FolderOpen size={17} />
              </span>
              <div>
                <h3>文件位置</h3>
              </div>
            </header>
            <div className="more-path-list">
              <div className="more-path-row">
                <button type="button" className="more-path-main" onClick={() => openPath(settings?.gameDir)}>
                  <span className="more-path-icon">
                    <HardDrive size={14} />
                  </span>
                  <span className="more-path-copy">
                    <strong>游戏目录</strong>
                    <span title={settings?.gameDir}>{settings?.gameDir ?? '正在读取…'}</span>
                  </span>
                </button>
                <IconButton label="打开游戏目录" onClick={() => openPath(settings?.gameDir)}>
                  <FolderOpen size={14} />
                </IconButton>
              </div>
              <div className="more-path-row">
                <button type="button" className="more-path-main" onClick={() => openPath(appInfo?.configDir)}>
                  <span className="more-path-icon">
                    <FileText size={14} />
                  </span>
                  <span className="more-path-copy">
                    <strong>配置目录</strong>
                    <span title={appInfo?.configDir}>{appInfo?.configDir ?? '正在读取…'}</span>
                  </span>
                </button>
                <IconButton label="打开配置目录" onClick={() => openPath(appInfo?.configDir)}>
                  <FolderOpen size={14} />
                </IconButton>
              </div>
            </div>
          </section>

          <section className="more-card card more-runtime">
            <header className="more-card-head">
              <span className="more-card-icon">
                <Monitor size={17} />
              </span>
              <div>
                <h3>运行环境</h3>
              </div>
            </header>
            <dl className="runtime-grid">
              <div>
                <dt>Electron</dt>
                <dd>{appInfo?.electron ?? '—'}</dd>
              </div>
              <div>
                <dt>Chromium</dt>
                <dd>{appInfo?.chrome ?? '—'}</dd>
              </div>
              <div>
                <dt>Node.js</dt>
                <dd>{appInfo?.node ?? '—'}</dd>
              </div>
              <div>
                <dt>系统</dt>
                <dd>
                  {appInfo ? `${appInfo.platform === 'win32' ? 'Windows' : appInfo.platform} · ${appInfo.arch}` : '—'}
                </dd>
              </div>
              <div>
                <dt>物理内存</dt>
                <dd>{appInfo?.totalMemoryGb ?? '—'} GB</dd>
              </div>
              <div>
                <dt>下载源</dt>
                <dd>{settings?.source === 'official' ? 'Mojang 官方' : 'BMCLAPI 镜像'}</dd>
              </div>
            </dl>
          </section>

          <section className="more-card card more-credit">
            <header className="more-card-head">
              <span className="more-card-icon">
                <Heart size={17} />
              </span>
              <div>
                <h3>致谢与声明</h3>
                <p>站在优秀的开源项目与社区肩上</p>
              </div>
            </header>
            <ul className="credit-list">
              <li>
                <BookOpen size={14} />
                界面与交互灵感来源于 <strong>PCL2</strong> 与 <strong>PCL2CE</strong>，在此感谢原作者与社区。
              </li>
              <li>
                <Globe size={14} />
                版本元数据来自 Mojang Piston Meta；镜像加速由{' '}
                <button type="button" className="link-button link-button--inline" onClick={() => openExternal('https://bmclapidoc.bangbang93.com/')}>
                  BMCLAPI
                </button>{' '}
                提供。
              </li>
              <li>
                <Boxes size={14} />
                使用 Electron、React、TypeScript、Vite、Zustand 与 Lucide 构建。
              </li>
              <li>
                <ShieldCheck size={14} />
                本启动器是非官方第三方软件，与 Mojang Studios、Microsoft 无任何关联，也未被其认可或赞助。
              </li>
            </ul>
            <p className="more-disclaimer">
              游玩 Minecraft Java 版需要拥有正版账户。离线模式仅用于本地测试与个人存档；请勿将启动器用于任何侵犯版权的用途。所有游戏资源均从官方源或公开镜像获取，不随本软件分发。
            </p>
          </section>

          <section className="more-card card more-disk">
            <div className="more-disk-head">
              <div className="more-card-head">
                <HardDrive size={16} />
                <h2>磁盘空间</h2>
              </div>
              <button type="button" className="button button--soft button--sm" disabled={diskBusy} onClick={() => void scanDisk()}>
                {diskBusy ? <Spinner size={12} /> : <HardDrive size={12} />}
                {disk ? '重新扫描' : '扫描占用'}
              </button>
            </div>
            <p className="more-card-desc">
              统计游戏目录占用，并找出未被任何已安装版本引用的运行库 / 资产文件；清理前可展开查看具体文件与分组。
            </p>
            {disk && (
              <div className="disk-report">
                <div className="disk-chips">
                  <span className="disk-chip"><em>版本文件</em><b>{formatBytes(disk.versionsBytes)}</b></span>
                  <span className="disk-chip"><em>运行库</em><b>{formatBytes(disk.librariesBytes)}</b></span>
                  <span className="disk-chip"><em>资产</em><b>{formatBytes(disk.assetsBytes)}</b></span>
                  <span className="disk-chip"><em>Java 运行时</em><b>{formatBytes(disk.runtimeBytes)}</b></span>
                  <span className="disk-chip"><em>实例数据</em><b>{formatBytes(disk.instancesBytes)}</b></span>
                </div>
                <p className="disk-basis">
                  引用依据：{disk.bases.length} 个版本文件夹 · {disk.versionsChecked} 个版本 JSON（含继承链与 natives 分类器）。
                  孤儿文件 = 未被其中任何版本引用；正在被已安装版本使用的文件不会出现在下面。
                </p>
                {(['libraries', 'assets'] as const).map((scope) => {
                  const entries = scope === 'libraries' ? disk.orphanLibraries : disk.orphanAssets
                  const bytes = scope === 'libraries' ? disk.orphanLibrariesBytes : disk.orphanAssetsBytes
                  const groups = groupOrphans(entries, disk.bases)
                  return (
                    <div className="disk-scope" key={scope}>
                      <div className="disk-scope-head">
                        <span>
                          {scope === 'libraries' ? '孤儿运行库' : '孤儿资产'} <b>{entries.length}</b> 个 · {formatBytes(bytes)}
                        </span>
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          disabled={cleanBusy !== null || entries.length === 0}
                          onClick={() => void cleanDisk(scope)}
                        >
                          {cleanBusy === scope ? <Spinner size={12} /> : null}
                          清理
                        </button>
                      </div>
                      {entries.length > 0 && (
                        <>
                          <div className="disk-groups">
                            {groups.slice(0, 6).map((group) => (
                              <span className="disk-group" key={group.key} title={group.key}>
                                {group.key}… {group.count} 个 · {formatBytes(group.size)}
                              </span>
                            ))}
                          </div>
                          <details className="disk-list">
                            <summary>查看文件列表（{entries.length}）</summary>
                            <ul>
                              {entries.slice(0, 300).map((entry) => (
                                <li key={entry.path}>
                                  <span>{relToBase(entry.path, disk.bases)}</span>
                                  <em>{formatBytes(entry.size)}</em>
                                </li>
                              ))}
                            </ul>
                            {entries.length > 300 && (
                              <p className="disk-list-more">仅显示前 300 条，共 {entries.length} 条。</p>
                            )}
                          </details>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
      <DownloadLogsModal open={downloadLogsOpen} onClose={() => setDownloadLogsOpen(false)} />
    </div>
  )
}
