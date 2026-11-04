import { createRoot } from 'react-dom/client'
import App from './App'
import { applyAccent, applyTheme } from './lib/appearance'
import './styles/base.css'
import './styles/components.css'
import './styles/pages.css'
import './styles/instances.css'
import './styles/paper.css'
import './styles/workbench.css'
import './styles/servers.css'
import './styles/doctor.css'
import './styles/playtime.css'
import './styles/screenshots.css'
import './styles/transfer.css'
import './styles/jvm.css'
import './styles/serverpack.css'
import './styles/workshop.css'
import './styles/kubejs-workbench.css'
import './styles/kubejs-recipe.css'
import './styles/kubejs-tag.css'
import './styles/kubejs-help.css'
import './styles/kubejs-qa.css'
import './styles/content-preview.css'
import './styles/backup-manager.css'
import './styles/update-explain.css'
import './styles/launcher-update.css'
import './styles/translation.css'
import './styles/refresh.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少应用挂载点')

// 在 React 读取配置前先套用上次的主题，避免启动动画首帧闪烁。
applyTheme(null)
applyAccent(null)

// 软件渲染下全屏模糊和整页位移非常吃合成器；提前标记，CSS 走轻量动效。
try {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl')
  const ext = gl?.getExtension('WEBGL_debug_renderer_info')
  const renderer = ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') : ''
  document.documentElement.dataset.renderer =
    !renderer || /swiftshader|basic render driver|software|llvmpipe/i.test(renderer)
      ? 'software'
      : 'hardware'
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
} catch {
  document.documentElement.dataset.renderer = 'software'
}

createRoot(container).render(<App />)
