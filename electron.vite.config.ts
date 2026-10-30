import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // 共享 CurseForge key 只在构建时注入，不进入公开源码。
    // 发布构建由 GitHub Actions 的 CURSEFORGE_API_KEY Secret 提供。
    define: {
      __WINDLETTER_CURSEFORGE_API_KEY__: JSON.stringify(
        process.env.WINDLETTER_CURSEFORGE_API_KEY?.trim() ?? ''
      ),
      __WINDLETTER_DEFAULT_UPDATE_FEED__: JSON.stringify(
        process.env.WINDLETTER_DEFAULT_UPDATE_FEED?.trim() ?? ''
      )
    },
    plugins: [externalizeDepsPlugin({ exclude: ['adm-zip', 'pinyin-pro'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
