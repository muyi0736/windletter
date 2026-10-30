import { useEffect, useState } from 'react'
import {
  BookOpen,
  Boxes,
  Cpu,
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
import { useLauncher } from '../store'
import { cleanError } from '../lib/format'
import { Badge, IconButton } from '../components/ui'
import { LauncherUpdateCard } from '../components/LauncherUpdateCard'
import { Logo } from '../components/visuals'

function openExternal(url: string) {
  void window.ccl.app.openExternal(url)
}

export function MorePage() {
  const appInfo = useLauncher((state) => state.appInfo)
  const settings = useLauncher((state) => state.settings)
  const openConsole = useLauncher((state) => state.openConsole)
  const toast = useLauncher((state) => state.toast)
  const [latestPath, setLatestPath] = useState<string | null>(null)

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

  const openLogFolder = () => {
    void window.ccl.logs.openFolder().catch((error) => {
      toast('error', '无法打开日志文件夹', cleanError(error))
    })
  }

  return (
    <div className="page page--more">
      <header className="page-head more-head">
        <div className="page-head-copy">
          <span className="page-eyebrow">
            <Info size={14} />
            更多
          </span>
          <h1>工具、日志与关于</h1>
          <p>快速打开运行文件，查看启动环境，或者了解更多关于风信的信息。</p>
        </div>
        <Badge tone="neutral" className="more-version-badge">
          风信启动器 v{appInfo?.version ?? '—'}
        </Badge>
      </header>

      <div className="more-scroll">
        <div className="more-grid">
          <section className="more-card card more-about">
            <div className="more-about-head">
              <Logo size={54} />
              <div>
                <h2>风信启动器</h2>
                <span>WINDLETTER</span>
              </div>
              <Badge tone="accent">v{appInfo?.version ?? '—'}</Badge>
            </div>
            <p className="more-about-text">
              风有信，月无边。一个专注于原版与整合包的 Minecraft 启动器，用现代桌面技术实现版本管理、实例隔离、文件补全、Java
              自动准备与多账户登录，界面灵感来自 PCL2 的易用体验。
            </p>
            <div className="more-feature-chips">
              <span>
                <Boxes size={13} />
                原版与整合包实例
              </span>
              <span>
                <Sparkles size={13} />
                官方源与 BMCLAPI
              </span>
              <span>
                <Cpu size={13} />
                Java 运行时管理
              </span>
              <span>
                <ShieldCheck size={13} />
                微软正版登录
              </span>
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

          <section className="more-card card">
            <header className="more-card-head">
              <span className="more-card-icon">
                <Terminal size={17} />
              </span>
              <div>
                <h3>日志与诊断</h3>
                <p>启动失败时，日志通常能说明原因</p>
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
            </div>
          </section>

          <section className="more-card card">
            <header className="more-card-head">
              <span className="more-card-icon">
                <FolderOpen size={17} />
              </span>
              <div>
                <h3>文件位置</h3>
                <p>打开游戏或配置所在位置</p>
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

          <section className="more-card card">
            <header className="more-card-head">
              <span className="more-card-icon">
                <Monitor size={17} />
              </span>
              <div>
                <h3>运行环境</h3>
                <p>当前启动器与系统信息</p>
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
        </div>
      </div>
    </div>
  )
}
