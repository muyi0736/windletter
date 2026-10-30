// 构建时由 electron.vite.config.ts 注入；公开源码中不保存真实 key。
// GitHub Actions 发布构建从 CURSEFORGE_API_KEY Secret 读取。
// 注意：注入后的 key 仍存在于安装包/主进程 bundle 中，无法抵御逆向提取；
// 需要真正保护 key 时应使用服务端代理。
declare const __WINDLETTER_CURSEFORGE_API_KEY__: string
declare const __WINDLETTER_DEFAULT_UPDATE_FEED__: string

export const BUNDLED_CURSEFORGE_API_KEY =
  typeof __WINDLETTER_CURSEFORGE_API_KEY__ === 'string'
    ? __WINDLETTER_CURSEFORGE_API_KEY__.trim()
    : ''

/** CI 构建默认指向 GitHub Releases；源码/本地构建可为空。 */
export const DEFAULT_UPDATE_FEED =
  typeof __WINDLETTER_DEFAULT_UPDATE_FEED__ === 'string'
    ? __WINDLETTER_DEFAULT_UPDATE_FEED__.trim()
    : ''
