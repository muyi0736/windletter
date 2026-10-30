import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AccountsPayload,
  ContentUpdateProgress,
  FileFilter,
  KubeJsIndexProgress,
  LaunchLogLine,
  LaunchState,
  LauncherApi,
  LauncherUpdateState,
  MsDeviceCode,
  MsPollResult,
  ServerPackVerifyProgress,
  TaskState,
  WorkshopExportProgress
} from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: LauncherApi = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (cb) => subscribe<boolean>('window:maximized', cb)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
    restart: () => ipcRenderer.invoke('app:restart'),
    releaseMemory: (scope) => ipcRenderer.invoke('app:release-memory', scope),
    releaseMemoryElevated: () => ipcRenderer.invoke('app:release-memory-elevated'),
    openPath: (path) => ipcRenderer.invoke('app:open-path', path),
    revealPath: (path) => ipcRenderer.invoke('app:reveal-path', path),
    pickDirectory: (title, defaultPath) =>
      ipcRenderer.invoke('app:pick-directory', title, defaultPath),
    pickFile: (title, filters?: FileFilter[]) => ipcRenderer.invoke('app:pick-file', title, filters),
    pickSaveFile: (title, defaultPath, filters) =>
      ipcRenderer.invoke('app:pick-save-file', title, defaultPath, filters),
    getPathForFile: (file) =>
      webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
    icon: (url) => ipcRenderer.invoke('app:icon', url),
    imageDataUrl: (path) => ipcRenderer.invoke('app:image-data-url', path),
    diskSpace: () => ipcRenderer.invoke('app:disk-space'),
    cacheStats: () => ipcRenderer.invoke('app:cache-stats'),
    clearCache: () => ipcRenderer.invoke('app:clear-cache')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    chooseBackground: () => ipcRenderer.invoke('settings:choose-background')
  },
  updater: {
    state: () => ipcRenderer.invoke('updater:state'),
    check: (silent) => ipcRenderer.invoke('updater:check', silent === true),
    download: () => ipcRenderer.invoke('updater:download'),
    cancel: () => ipcRenderer.invoke('updater:cancel'),
    install: () => ipcRenderer.invoke('updater:install'),
    onState: (cb) => subscribe<LauncherUpdateState>('updater:state', cb)
  },
  auth: {
    list: () => ipcRenderer.invoke('auth:list'),
    addOffline: (name) => ipcRenderer.invoke('auth:add-offline', name),
    setActive: (id) => ipcRenderer.invoke('auth:set-active', id),
    remove: (id) => ipcRenderer.invoke('auth:remove', id),
    startMicrosoft: (clientId) => ipcRenderer.invoke('auth:ms-start', clientId),
    pollMicrosoft: (sessionId): Promise<MsPollResult> =>
      ipcRenderer.invoke('auth:ms-poll', sessionId),
    cancelMicrosoft: (sessionId) => ipcRenderer.invoke('auth:ms-cancel', sessionId),
    skin: (uuid) => ipcRenderer.invoke('auth:skin', uuid),
    onChanged: (cb) => subscribe<AccountsPayload>('auth:changed', cb)
  },
  versions: {
    installed: () => ipcRenderer.invoke('versions:installed'),
    manifest: (source) => ipcRenderer.invoke('versions:manifest', source),
    install: (id) => ipcRenderer.invoke('versions:install', id),
    remove: (id) => ipcRenderer.invoke('versions:remove', id),
    cleanupPreview: () => ipcRenderer.invoke('versions:cleanup-preview'),
    cleanup: (ids) => ipcRenderer.invoke('versions:cleanup', ids),
    folders: () => ipcRenderer.invoke('versions:folders'),
    openFolder: (id) => ipcRenderer.invoke('versions:open-folder', id),
    exportJson: (id) => ipcRenderer.invoke('versions:export-json', id)
  },
  instances: {
    list: () => ipcRenderer.invoke('instances:list'),
    importFile: () => ipcRenderer.invoke('instances:import-file'),
    installModrinth: (request) => ipcRenderer.invoke('instances:install-modrinth', request),
    installCurseForge: (request) =>
      ipcRenderer.invoke('instances:install-curseforge', request),
    createLoader: (request) => ipcRenderer.invoke('instances:create-loader', request),
    createVanilla: (request) => ipcRenderer.invoke('instances:create-vanilla', request),
    updateLoader: (request) => ipcRenderer.invoke('instances:update-loader', request),
    loaderRollbackState: (id) =>
      ipcRenderer.invoke('instances:loader-rollback-state', id),
    rollbackLoader: (id) => ipcRenderer.invoke('instances:rollback-loader', id),
    loaderVersions: (gameVersion, loader) =>
      ipcRenderer.invoke('loaders:versions', gameVersion, loader),
    remove: (id, deleteExternalFiles) =>
      ipcRenderer.invoke('instances:remove', id, deleteExternalFiles === true),
    openFolder: (id, kind) => ipcRenderer.invoke('instances:open-folder', id, kind),
    updateSettings: (id, patch) => ipcRenderer.invoke('instances:update-settings', id, patch),
    updateMeta: (id, patch) => ipcRenderer.invoke('instances:update-meta', id, patch),
    exportScript: (id) => ipcRenderer.invoke('instances:export-script', id),
    repair: (id) => ipcRenderer.invoke('instances:repair', id),
    exportModpack: (id, options, path) =>
      ipcRenderer.invoke('instances:export-modpack', id, options, path),
    onExportProgress: (cb) => subscribe<{ done: number; total: number; bytes: number }>('instances:export-progress', cb),
    launch: (id) => ipcRenderer.invoke('instances:launch', id),
    transfer: (request) => ipcRenderer.invoke('instances:transfer', request)
  },
  serverPacks: {
    preview: (instanceId) => ipcRenderer.invoke('serverpack:preview', instanceId),
    suggest: (instanceId) => ipcRenderer.invoke('serverpack:ai-suggest', instanceId),
    create: (request) => ipcRenderer.invoke('serverpack:create', request),
    inspect: (instanceId, path) => ipcRenderer.invoke('serverpack:inspect', instanceId, path),
    verify: (request) =>
      ipcRenderer.invoke('serverpack:verify', request.instanceId, request.path),
    cancelVerify: () => ipcRenderer.invoke('serverpack:verify-cancel'),
    onVerifyProgress: (cb) =>
      subscribe<ServerPackVerifyProgress>('serverpack:verify-progress', cb)
  },
  workshop: {
    report: (instanceId) => ipcRenderer.invoke('workshop:report', instanceId),
    exportPack: (request) => ipcRenderer.invoke('workshop:export-pack', request),
    onExportProgress: (cb) =>
      subscribe<WorkshopExportProgress>('workshop:export-progress', cb),
    kubejsFiles: (instanceId) =>
      ipcRenderer.invoke('workshop:kubejs-files', instanceId),
    kubejsRead: (instanceId, path) =>
      ipcRenderer.invoke('workshop:kubejs-read', instanceId, path),
    kubejsSave: (request) => ipcRenderer.invoke('workshop:kubejs-save', request),
    kubejsRemove: (instanceId, path) =>
      ipcRenderer.invoke('workshop:kubejs-remove', instanceId, path),
    kubejsRename: (request) => ipcRenderer.invoke('workshop:kubejs-rename', request),
    kubejsHistory: (instanceId) =>
      ipcRenderer.invoke('workshop:kubejs-history', instanceId),
    kubejsHistoryRead: (instanceId, stamp, path) =>
      ipcRenderer.invoke('workshop:kubejs-history-read', instanceId, stamp, path),
    kubejsHistoryRestore: (request) =>
      ipcRenderer.invoke('workshop:kubejs-history-restore', request),
    kubejsHistoryClean: (instanceId, keep) =>
      ipcRenderer.invoke('workshop:kubejs-history-clean', instanceId, keep),
    kubejsIndexStatus: (instanceId) =>
      ipcRenderer.invoke('workshop:kubejs-index-status', instanceId),
    kubejsIndexBuild: (instanceId) =>
      ipcRenderer.invoke('workshop:kubejs-index-build', instanceId),
    kubejsIndexCancel: () => ipcRenderer.invoke('workshop:kubejs-index-cancel'),
    kubejsIndexSearch: (request) =>
      ipcRenderer.invoke('workshop:kubejs-index-search', request),
    kubejsRecipeDetail: (instanceId, recipeId) =>
      ipcRenderer.invoke('workshop:kubejs-recipe-detail', instanceId, recipeId),
    kubejsItemIcons: (instanceId, ids) =>
      ipcRenderer.invoke('workshop:kubejs-item-icons', instanceId, ids),
    onKubejsIndexProgress: (cb) =>
      subscribe<KubeJsIndexProgress>('workshop:kubejs-index-progress', cb),
    kubejsLint: (request) => ipcRenderer.invoke('workshop:kubejs-lint', request),
    kubejsLintProject: (request) =>
      ipcRenderer.invoke('workshop:kubejs-lint-project', request),
    kubejsLogs: (instanceId) => ipcRenderer.invoke('workshop:kubejs-logs', instanceId),
    kubejsTemplates: () => ipcRenderer.invoke('workshop:kubejs-templates'),
    kubejsAi: (request) => ipcRenderer.invoke('workshop:kubejs-ai', request),
    kubejsQa: (request) => ipcRenderer.invoke('workshop:kubejs-qa', request),
    kubejsExplain: (request) => ipcRenderer.invoke('workshop:kubejs-explain', request)
  },
  jvm: {
    presets: () => ipcRenderer.invoke('jvm:presets'),
    savePreset: (input) => ipcRenderer.invoke('jvm:save-preset', input),
    removePreset: (id) => ipcRenderer.invoke('jvm:remove-preset', id)
  },
  playtime: {
    report: () => ipcRenderer.invoke('playtime:report'),
    onChanged: (cb) => subscribe('playtime:changed', () => cb())
  },
  screenshots: {
    list: (instanceId) => ipcRenderer.invoke('screenshots:list', instanceId),
    remove: (instanceId, name) => ipcRenderer.invoke('screenshots:remove', instanceId, name),
    copy: (instanceId, name) => ipcRenderer.invoke('screenshots:copy', instanceId, name),
    open: (instanceId, name) => ipcRenderer.invoke('screenshots:open', instanceId, name)
  },
  backups: {
    overview: () => ipcRenderer.invoke('backups:overview'),
    cleanup: (request) => ipcRenderer.invoke('backups:cleanup', request)
  },
  worlds: {
    list: (instanceId) => ipcRenderer.invoke('worlds:list', instanceId),
    backups: (instanceId, worldFolder) =>
      ipcRenderer.invoke('worlds:backups', instanceId, worldFolder),
    backup: (instanceId, worldFolder) =>
      ipcRenderer.invoke('worlds:backup', instanceId, worldFolder ?? null),
    restore: (instanceId, worldFolder, backupId) =>
      ipcRenderer.invoke('worlds:restore', instanceId, worldFolder, backupId),
    deleteBackup: (instanceId, worldFolder, backupId) =>
      ipcRenderer.invoke('worlds:delete-backup', instanceId, worldFolder, backupId),
    openFolder: (instanceId, kind) =>
      ipcRenderer.invoke('worlds:open-folder', instanceId, kind)
  },
  diagnostics: {
    run: (instanceId) => ipcRenderer.invoke('diagnostics:run', instanceId),
    markKnownGood: (instanceId) => ipcRenderer.invoke('diagnostics:mark-known-good', instanceId),
    ignoreIssue: (instanceId, issueId) =>
      ipcRenderer.invoke('diagnostics:ignore-issue', instanceId, issueId),
    clearIgnored: (instanceId) => ipcRenderer.invoke('diagnostics:clear-ignored', instanceId)
  },
  ai: {
    getConfig: () => ipcRenderer.invoke('ai:get-config'),
    updateConfig: (patch) => ipcRenderer.invoke('ai:update-config', patch),
    analyze: (instanceId) => ipcRenderer.invoke('ai:analyze', instanceId)
  },
  servers: {
    list: () => ipcRenderer.invoke('servers:list'),
    add: (input) => ipcRenderer.invoke('servers:add', input),
    update: (id, input) => ipcRenderer.invoke('servers:update', id, input),
    remove: (id) => ipcRenderer.invoke('servers:remove', id),
    ping: (id) => ipcRenderer.invoke('servers:ping', id),
    pingAll: () => ipcRenderer.invoke('servers:ping-all'),
    probe: (address) => ipcRenderer.invoke('servers:probe', address),
    playerSkin: (name, uuid) => ipcRenderer.invoke('servers:player-skin', name, uuid),
    launch: (id) => ipcRenderer.invoke('servers:launch', id)
  },
  presets: {
    list: () => ipcRenderer.invoke('presets:list'),
    add: (input) => ipcRenderer.invoke('presets:add', input),
    remove: (provider, projectId) => ipcRenderer.invoke('presets:remove', provider, projectId),
    setAutoInstall: (enabled) => ipcRenderer.invoke('presets:set-auto', enabled === true),
    check: (instanceId) => ipcRenderer.invoke('presets:check', instanceId),
    install: (request) => ipcRenderer.invoke('presets:install', request)
  },
  searchAliases: {
    list: () => ipcRenderer.invoke('search-aliases:list'),
    importMcmod: (url) => ipcRenderer.invoke('search-aliases:import-mcmod', url),
    remove: (id) => ipcRenderer.invoke('search-aliases:remove', id)
  },
  mods: {
    search: (provider, query, instanceId, offset, kind) =>
      ipcRenderer.invoke('mods:search', provider, query, instanceId, offset, kind),
    install: (request) => ipcRenderer.invoke('mods:install', request),
    searchCatalog: (provider, query, gameVersion, loader, offset, kind) =>
      ipcRenderer.invoke('mods:search-catalog', provider, query, gameVersion, loader, offset, kind),
    versions: (provider, projectId, kind) => ipcRenderer.invoke('mods:versions', provider, projectId, kind),
    download: (request) => ipcRenderer.invoke('mods:download', request),
    list: (instanceId) => ipcRenderer.invoke('mods:list', instanceId),
    remove: (instanceId, file) => ipcRenderer.invoke('mods:remove', instanceId, file),
    toggle: (instanceId, file, enabled) =>
      ipcRenderer.invoke('mods:toggle', instanceId, file, enabled),
    importFiles: (instanceId) => ipcRenderer.invoke('mods:import-files', instanceId),
    openFolder: (instanceId) => ipcRenderer.invoke('mods:open-folder', instanceId)
  },
  ledger: {
    scan: (instanceId, force) => ipcRenderer.invoke('ledger:scan', instanceId, force === true),
    check: (instanceId, force) => ipcRenderer.invoke('ledger:check', instanceId, force === true),
    update: (request) => ipcRenderer.invoke('ledger:update', request),
    rollback: (instanceId) => ipcRenderer.invoke('ledger:rollback', instanceId),
    onProgress: (cb) => subscribe<ContentUpdateProgress>('ledger:progress', cb),
    changelog: (provider, projectId, versionId) =>
      ipcRenderer.invoke('ledger:changelog', provider, projectId, versionId),
    explainUpdate: (instanceId) => ipcRenderer.invoke('ledger:explain-update', instanceId),
    previewPack: (instanceId, kind, file) =>
      ipcRenderer.invoke('ledger:preview-pack', instanceId, kind, file),
    previewDir: (instanceId, kind, file, path) =>
      ipcRenderer.invoke('ledger:preview-dir', instanceId, kind, file, path),
    previewFile: (instanceId, kind, file, path) =>
      ipcRenderer.invoke('ledger:preview-file', instanceId, kind, file, path),
    previewSearch: (instanceId, kind, file, query) =>
      ipcRenderer.invoke('ledger:preview-search', instanceId, kind, file, query)
  },
  modrinth: {
    search: (query, offset) => ipcRenderer.invoke('modrinth:search', query, offset),
    versions: (projectId) => ipcRenderer.invoke('modrinth:versions', projectId)
  },
  curseforge: {
    searchModpacks: (query, gameVersion, loader, offset) =>
      ipcRenderer.invoke('curseforge:modpacks', query, gameVersion, loader, offset),
    modpackVersions: (projectId) =>
      ipcRenderer.invoke('curseforge:modpack-versions', projectId)
  },
  localPacks: {
    scan: (extraPath) => ipcRenderer.invoke('local-packs:scan', extraPath),
    import: (request) => ipcRenderer.invoke('local-packs:import', request),
    importMany: (requests) => ipcRenderer.invoke('local-packs:import-many', requests)
  },
  java: {
    detect: (refresh) => ipcRenderer.invoke('java:detect', refresh),
    downloadForVersion: (versionId) => ipcRenderer.invoke('java:download-for-version', versionId),
    assignments: () => ipcRenderer.invoke('java:assignments'),
    applyAssignments: (list) => ipcRenderer.invoke('java:apply-assignments', list)
  },
  launch: {
    start: (versionId) => ipcRenderer.invoke('launch:start', versionId),
    cancel: () => ipcRenderer.invoke('launch:cancel'),
    stop: () => ipcRenderer.invoke('launch:stop'),
    getState: () => ipcRenderer.invoke('launch:get-state'),
    getLogs: () => ipcRenderer.invoke('launch:get-logs'),
    onState: (cb) => subscribe<LaunchState>('launch:state', cb),
    onLog: (cb) => subscribe<LaunchLogLine>('launch:log', cb)
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    cancel: (id) => ipcRenderer.invoke('tasks:cancel', id),
    pause: (id) => ipcRenderer.invoke('tasks:pause', id),
    resume: (id) => ipcRenderer.invoke('tasks:resume', id),
    onUpdate: (cb) => subscribe<TaskState>('tasks:update', cb)
  },
  logs: {
    openFolder: () => ipcRenderer.invoke('logs:open-folder'),
    latestPath: () => ipcRenderer.invoke('logs:latest-path'),
    readLatest: () => ipcRenderer.invoke('logs:read-latest')
  }
}

contextBridge.exposeInMainWorld('ccl', api)

export type { MsDeviceCode }
