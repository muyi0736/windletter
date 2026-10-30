import { useEffect, useRef, useState } from 'react'
import { PackagePlus, RefreshCw } from 'lucide-react'
import { useLauncher } from './store'
import { applyAccent, applyTheme, customBackgroundUrl } from './lib/appearance'
import { TitleBar } from './components/TitleBar'
import { CommandPalette } from './components/CommandPalette'
import { ToastStack } from './components/ToastStack'
import { TaskDock } from './components/TaskDock'
import { ConsoleDrawer } from './components/ConsoleDrawer'
import { ManualPackModal } from './components/ManualPackModal'
import { JavaIssueModal } from './components/JavaIssueModal'
import { FaultDoctorModal } from './components/FaultDoctorModal'
import { AccountModal } from './components/AccountModal'
import { VersionPicker } from './components/VersionPicker'
import { PresetModsModal } from './components/PresetModsModal'
import { PresetCheckModal } from './components/PresetCheckModal'
import { SplashScreen } from './components/SplashScreen'
import { Logo } from './components/visuals'
import { HomePage } from './pages/HomePage'
import { HomePageClassic } from './pages/HomePageClassic'
import { InstancesPage } from './pages/InstancesPage'
import { ServersPage } from './pages/ServersPage'
import { DownloadsPage } from './pages/DownloadsPage'
import { SettingsPage } from './pages/SettingsPage'
import { MorePage } from './pages/MorePage'

function CurrentPage() {
  const page = useLauncher((state) => state.page)
  const homeLayout = useLauncher((state) => state.settings?.homeLayout ?? 'simple')
  switch (page) {
    case 'instances':
      return <InstancesPage />
    case 'servers':
      return <ServersPage />
    case 'downloads':
      return <DownloadsPage />
    case 'settings':
      return <SettingsPage />
    case 'more':
      return <MorePage />
    default:
      return homeLayout === 'classic' ? <HomePageClassic /> : <HomePage />
  }
}

export default function App() {
  const initialize = useLauncher((state) => state.initialize)
  const booted = useLauncher((state) => state.booted)
  const bootError = useLauncher((state) => state.bootError)
  const page = useLauncher((state) => state.page)
  const theme = useLauncher((state) => state.settings?.theme)
  const accent = useLauncher((state) => state.settings?.accent)
  const backgroundImage = useLauncher((state) => state.settings?.backgroundImage)
  const backgroundDim = useLauncher((state) => state.settings?.backgroundDim ?? 35)
  const backgroundBlur = useLauncher((state) => state.settings?.backgroundBlur ?? 0)
  const memorySaver = useLauncher((state) => state.settings?.memorySaver)
  const consoleOpen = useLauncher((state) => state.consoleOpen)
  const presetManagerOpen = useLauncher((state) => state.presetManagerOpen)
  const setPresetManagerOpen = useLauncher((state) => state.setPresetManagerOpen)
  const importLocalArchives = useLauncher((state) => state.importLocalArchives)
  const toast = useLauncher((state) => state.toast)
  const [minimumElapsed, setMinimumElapsed] = useState(false)
  const [splashLeaving, setSplashLeaving] = useState(false)
  const [splashDone, setSplashDone] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    const timer = setTimeout(() => setMinimumElapsed(true), reduceMotion ? 220 : 900)
    return () => clearTimeout(timer)
  }, [reduceMotion])

  const splashReady = booted && minimumElapsed

  useEffect(() => {
    if (!splashReady || splashDone) return
    const hold = setTimeout(() => setSplashLeaving(true), reduceMotion ? 80 : 280)
    const finish = setTimeout(() => setSplashDone(true), reduceMotion ? 260 : 880)
    return () => {
      clearTimeout(hold)
      clearTimeout(finish)
    }
  }, [splashReady, splashDone, reduceMotion])

  useEffect(() => {
    if (!bootError) return
    setSplashLeaving(true)
    setSplashDone(true)
  }, [bootError])

  const showSplash = !splashDone && !bootError

  useEffect(() => {
    if (!theme) return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    applyTheme(theme)
    if (theme === 'system') {
      const apply = () => applyTheme(theme)
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
    return undefined
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.memorySaver = memorySaver === false ? 'false' : 'true'
  }, [memorySaver])

  useEffect(() => {
    if (accent) applyAccent(accent)
  }, [accent])

  const backgroundUrl = customBackgroundUrl(backgroundImage)

  useEffect(() => {
    document.documentElement.dataset.customBackground = backgroundUrl ? 'true' : 'false'
    return () => {
      document.documentElement.dataset.customBackground = 'false'
    }
  }, [backgroundUrl])

  useEffect(() => {
    const hasFiles = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current += 1
      setDragging(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent) => {
      event.preventDefault()
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return
      const paths = files
        .map((file) => {
          try {
            return window.ccl.app.getPathForFile(file)
          } catch {
            return ''
          }
        })
        .filter(Boolean)
      const archives = paths.filter((path) => /\.(?:mrpack|zip)$/i.test(path))
      if (archives.length === 0) {
        toast('info', '只支持 .mrpack / .zip', '请拖入 Modrinth 整合包或包含 modrinth.index.json 的 zip')
        return
      }
      if (archives.length < paths.length) {
        toast(
          'info',
          `已忽略 ${paths.length - archives.length} 个不支持的文件`,
          '当前支持 .mrpack 和整合包 .zip'
        )
      }
      void importLocalArchives(archives)
    }
    const reset = () => {
      dragDepth.current = 0
      setDragging(false)
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('blur', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('blur', reset)
    }
  }, [importLocalArchives, toast])

  return (
    <div
      className={`app-shell ${consoleOpen ? 'console-open' : ''} ${
        backgroundUrl ? 'has-custom-background' : ''
      }`}
    >
      {backgroundUrl && (
        <>
          <div
            className="custom-background"
            style={{
              backgroundImage: `url("${backgroundUrl}")`,
              filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : undefined
            }}
            aria-hidden="true"
          />
          <div
            className="custom-background-veil"
            style={{ opacity: Math.max(0, Math.min(80, backgroundDim)) / 100 }}
            aria-hidden="true"
          />
        </>
      )}
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <span className="drop-icon">
              <PackagePlus size={34} />
            </span>
            <strong>松开以导入整合包</strong>
            <span>.mrpack / 整合包 .zip · 支持一次拖入多个文件</span>
          </div>
        </div>
      )}
      {showSplash ? (
        <SplashScreen leaving={splashLeaving} ready={splashReady} />
      ) : (
        <>
          <TitleBar />
          <CommandPalette />

          {bootError ? (
            <main className="boot-screen boot-screen--error">
              <div className="boot-error-card">
                <Logo size={46} />
                <h2>启动器初始化失败</h2>
                <p>{bootError}</p>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw size={15} />
                  重新加载
                </button>
              </div>
            </main>
          ) : (
            <main className="app-main">
              <div className="page-transition" key={page}>
                <CurrentPage />
              </div>
            </main>
          )}

          <TaskDock />
          <ConsoleDrawer />
          <ManualPackModal />
          <JavaIssueModal />
          <FaultDoctorModal />
          <AccountModal />
          <VersionPicker />
          <PresetModsModal
            open={presetManagerOpen}
            onClose={() => setPresetManagerOpen(false)}
          />
          <PresetCheckModal />
          <ToastStack />
        </>
      )}
    </div>
  )
}
