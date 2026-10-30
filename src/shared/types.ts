export type ThemeMode = 'light' | 'dark' | 'system'
export type AccentName = 'cyan' | 'blue' | 'green' | 'orange' | 'pink' | 'violet' | 'red' | 'slate'
export type DownloadSource = 'official' | 'mirror'
export type AccountType = 'offline' | 'microsoft'
export type InstanceLoader = 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'optifine' | 'vanilla'
export type InstanceSource = 'local' | 'modrinth' | 'curseforge' | 'external'

export type HomeLayout = 'simple' | 'classic'

export interface LauncherSettings {
  theme: ThemeMode
  accent: AccentName
  homeLayout: HomeLayout
  backgroundImage: string | null
  backgroundDim: number
  backgroundBlur: number
  source: DownloadSource
  modrinthMirror: boolean
  localPackFolders: string[]
  cacheLimitMb: number
  gameDir: string
  /** 用户收藏的其它版本文件夹（绝对路径）；当前目录和官方目录自动出现。 */
  versionFolders: string[]
  javaPath: string | null
  autoJava: boolean
  maxMemoryMb: number
  extraJvmArgs: string
  downloadConcurrency: number
  downloadProxy: string
  lastVersionId: string | null
  lastInstanceId: string | null
  externalLauncherPath: string | null
  msClientId: string
  curseForgeApiKey: string
  curseForgeApiBase: string
  curseForgeCompatDownloads: boolean
  curseForgeUseMirror: boolean
  autoModDependencies: boolean
  autoWorldBackup: boolean
  worldBackupLimit: number
  kubeJsBackupLimit: number
  contentBackupLimit: number
  /** 0 表示不按天数清理。世界/KubeJS/内容备份共用。 */
  backupMaxAgeDays: number
  memorySaver: boolean
  hideAfterLaunch: boolean
  customResolution: boolean
  windowWidth: number
  windowHeight: number
  /** 启动时静默检查更新；只请求版本清单，不上传任何本机数据。 */
  autoCheckUpdates: boolean
  /** latest.json 地址或所在目录；为空表示尚未配置更新源。 */
  updateFeed: string
}

export interface StoredAccount {
  id: string
  type: AccountType
  name: string
  uuid: string
  accessToken: string
  refreshToken?: string
  clientId?: string
  expiresAt?: number
  addedAt: number
}

export interface AccountView {
  id: string
  type: AccountType
  name: string
  uuid: string
}

export interface AccountsPayload {
  accounts: AccountView[]
  activeId: string | null
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  totalMemoryGb: number
  diskFreeGb: number
  diskTotalGb: number
  gameDir: string
  configDir: string
  logDir: string
}

export type LauncherUpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'cancelled'
  | 'error'

export interface LauncherUpdateInfo {
  version: string
  notes: string[]
  publishedAt: number | null
  size: number
  mandatory: boolean
  pageUrl: string | null
}

export interface LauncherUpdateProgress {
  received: number
  total: number
  /** 实测下载速度（字节/秒）；校验与安装阶段为 0。 */
  speed: number
  /** 0–100；总量未知时为 null。 */
  percent: number | null
}

export type LauncherUpdateSource = 'api' | 'manifest' | 'cache'

export interface LauncherUpdateState {
  phase: LauncherUpdatePhase
  currentVersion: string
  info: LauncherUpdateInfo | null
  progress: LauncherUpdateProgress
  error: string | null
  checkedAt: number | null
  /** 本次结果来自 GitHub API、latest.json 回退，还是本地缓存。 */
  source: LauncherUpdateSource | null
  /** GitHub API 限额恢复时间；限额内不再发起请求。 */
  rateLimitedUntil: number | null
  /** 本次检查是否由启动静默检查触发。 */
  silent: boolean
}

export interface VersionSummary {
  id: string
  type: string
  releaseTime: string
}

export interface VersionManifestView {
  latest: { release: string; snapshot: string }
  versions: VersionSummary[]
  source: DownloadSource
  fetchedAt: number
}

export interface VersionUsageRef {
  id: string
  name: string
}

export interface InstalledVersion {
  id: string
  type: string
  releaseTime: string | null
  lastPlayed: number | null
  loader: string | null
  hasJar: boolean
  javaMajor: number | null
  inheritsFrom: string | null
  /** 当前实例中引用这个版本的列表；仅列表接口计算。 */
  usedBy?: VersionUsageRef[]
}

export interface VersionCleanupGroup {
  ids: string[]
  label: string
  sizeBytes: number
  /** 启动器生成的加载器链；默认勾选。独立原版默认不勾选。 */
  suggested: boolean
}

export interface VersionCleanupPreview {
  groups: VersionCleanupGroup[]
  totalBytes: number
  suggestedBytes: number
}

export interface VersionCleanupResult {
  removed: string[]
  skipped: string[]
}

export interface VersionFolderView {
  path: string
  name: string
  kind: 'current' | 'official' | 'custom'
  exists: boolean
  versionCount: number
  instanceCount: number
}

export interface PlaytimeDay {
  date: string
  label: string
  durationMs: number
  sessions: number
  today: boolean
  future: boolean
}

export interface PlaytimeInstanceStat {
  key: string
  name: string
  durationMs: number
  sessions: number
}

export interface PlaytimeSessionView {
  id: string
  key: string
  name: string
  versionId: string
  instanceId: string | null
  startedAt: number
  endedAt: number
  durationMs: number
  exitCode: number | null
}

export interface PlaytimeActiveView {
  name: string
  versionId: string
  instanceId: string | null
  startedAt: number
}

export interface PlaytimeReport {
  weekStart: number
  weekMs: number
  lastWeekMs: number
  todayMs: number
  totalMs: number
  weekSessions: number
  totalSessions: number
  days: PlaytimeDay[]
  instances: PlaytimeInstanceStat[]
  recent: PlaytimeSessionView[]
  active: PlaytimeActiveView | null
}

export type ServerPackModSide = 'client' | 'server' | 'both' | 'unknown'

export interface ServerPackModView {
  file: string
  size: number
  id: string | null
  name: string
  version: string | null
  side: ServerPackModSide
  reason: string
  include: boolean
}

export interface ServerPackPreview {
  instanceId: string
  instanceName: string
  gameVersion: string
  loader: string
  loaderVersion: string | null
  supportsBootstrap: boolean
  bootstrapNote: string | null
  directories: string[]
  hasServerProperties: boolean
  mods: ServerPackModView[]
}

export interface ServerPackProperties {
  motd: string
  port: number
  maxPlayers: number
  onlineMode: boolean
  viewDistance: number
}

export interface ServerPackRequest {
  instanceId: string
  outputPath: string
  includeMods: string[]
  includeConfigs: boolean
  includeBootstrap: boolean
  properties: ServerPackProperties
}

export interface ServerPackAiSuggestion {
  exclude: { file: string; reason: string }[]
  notes: string
  model: string
}

export interface WorkshopModView {
  file: string
  size: number
  id: string | null
  name: string
  version: string | null
  side: ServerPackModSide
  reason: string
  requires: string[]
  requiredBy: string[]
  missing: string[]
  clientDependency: string | null
  duplicate: boolean
  include: boolean
}

export interface KubeJsFileView {
  path: string
  name: string
  category: string
  size: number
  modified: number
}

export type KubeJsLineEnding = 'lf' | 'crlf'

export interface KubeJsFileContent extends KubeJsFileView {
  content: string
  bom: boolean
  lineEnding: KubeJsLineEnding
}

export interface KubeJsHistoryEntry {
  stamp: string
  path: string
  size: number
  modified: number
}

export interface KubeJsHistoryContent extends KubeJsFileContent {
  stamp: string
}

export interface KubeJsTemplateView {
  id: string
  name: string
  description: string
  code: string
  category?: string
  tagNamespace?: 'forge' | 'c'
  minGameVersion?: string
  maxGameVersion?: string
  loaders?: string[]
  versionNote?: string
}

export interface WorkshopReport {
  instanceId: string
  instanceName: string
  gameVersion: string
  loader: string
  loaderVersion: string | null
  mods: WorkshopModView[]
  kubejs: {
    exists: boolean
    files: KubeJsFileView[]
  }
  counts: {
    total: number
    client: number
    server: number
    both: number
    unknown: number
    missing: number
    duplicates: number
    clientDependency: number
  }
}

export interface WorkshopExportOptions {
  includeMods: string[]
  includeConfigs: boolean
  includeKubejs: boolean
  includeResourcepacks: boolean
  includeShaderpacks: boolean
  includeDatapacks: boolean
}

export interface WorkshopExportRequest {
  instanceId: string
  outputPath: string
  options: WorkshopExportOptions
}

export interface WorkshopExportProgress {
  done: number
  total: number
  bytes: number
}

export interface WorkshopExportResult extends WorkshopExportProgress {
  path: string
}

export interface KubeJsSaveRequest {
  instanceId: string
  path: string
  content: string
  bom?: boolean
  lineEnding?: KubeJsLineEnding
  expectedModified?: number | null
  force?: boolean
}

export type KubeJsSaveResult =
  | { ok: true; file: KubeJsFileContent }
  | {
      ok: false
      conflictModified: number
      reason: 'changed' | 'deleted' | 'exists'
    }

export interface KubeJsRenameRequest {
  instanceId: string
  from: string
  to: string
}

export interface KubeJsHistoryRestoreRequest {
  instanceId: string
  stamp: string
  path: string
}

export interface KubeJsHistoryCleanupResult {
  removed: number
  kept: number
  bytes: number
}

export interface KubeJsAiSelection {
  startLine: number
  endLine: number
  text: string
}

export interface KubeJsAiRequest {
  instanceId: string
  prompt: string
  currentPath?: string | null
  currentContent?: string | null
  /** 有选区时只改写这段代码；为空时生成整份脚本。 */
  selection?: KubeJsAiSelection | null
}

export interface KubeJsAiResult {
  code: string
  notes: string
  model: string
}

export interface KubeJsQaRequest {
  instanceId: string
  question: string
}

export interface KubeJsQaCitation {
  kind: 'item' | 'recipe' | 'tag'
  id: string
  label: string
  detail: string
  iconId: string | null
}

export interface KubeJsQaResult {
  answer: string
  citations: KubeJsQaCitation[]
  itemCount: number
  recipeCount: number
  tagCount: number
  model: string | null
  warnings: string[]
  localOnly: boolean
}

export interface KubeJsExplainPoint {
  line: number | null
  title: string
  detail: string
}

export interface KubeJsExplainResult {
  summary: string
  points: KubeJsExplainPoint[]
  notes: string
  model: string | null
  source: 'local' | 'ai'
}

export interface KubeJsExplainRequest {
  instanceId: string
  path: string
  content: string
  mode: 'local' | 'ai'
}

export interface KubeJsIndexCounts {
  items: number
  recipes: number
  tags: number
  mods: number
  jars: number
}

export interface KubeJsIndexMod {
  id: string
  name: string
  version: string | null
  file: string
}

export interface KubeJsIndexStatus {
  state: 'idle' | 'building' | 'ready' | 'error'
  instanceId: string
  fingerprint: string | null
  counts: KubeJsIndexCounts
  mods: KubeJsIndexMod[]
  builtAt: number | null
  elapsedMs: number | null
  cached: boolean
  error: string | null
}

export interface KubeJsIndexProgress {
  state: 'building'
  instanceId: string
  done: number
  total: number
  bytes: number
  items: number
  recipes: number
  tags: number
  elapsedMs: number
  current: string
}

export type KubeJsIndexKind = 'item' | 'recipe' | 'tag'

export interface KubeJsIndexItem {
  id: string
  modId: string
  name: string
  nameZh: string | null
  nameEn: string | null
  block: boolean
  source: string
}

export interface KubeJsIndexRecipe {
  id: string
  type: string
  modId: string
  output: { id: string; count: number; name: string } | null
  inputs: { kind: 'item' | 'tag'; id: string; name: string }[]
  source: string
}

export interface KubeJsRecipeDetail {
  id: string
  type: string
  modId: string
  source: string
  jarFile: string | null
  raw: Record<string, unknown>
}

export interface KubeJsIndexTag {
  id: string
  type: string
  modId: string
  count: number
  members: string[]
  source: string
}

export interface KubeJsIndexSearchRequest {
  instanceId: string
  kind: KubeJsIndexKind
  query: string
  modId?: string
  page: number
  pageSize: number
}

export type KubeJsIndexSearchResult =
  | { kind: 'item'; items: KubeJsIndexItem[]; total: number; page: number; pageSize: number }
  | { kind: 'recipe'; items: KubeJsIndexRecipe[]; total: number; page: number; pageSize: number }
  | { kind: 'tag'; items: KubeJsIndexTag[]; total: number; page: number; pageSize: number }

export type KubeJsIssueSeverity = 'error' | 'warning' | 'info'

export type KubeJsIssueSource = 'syntax' | 'event' | 'side' | 'item' | 'recipe' | 'tag' | 'api'

export type KubeJsIssueFix =
  | {
      kind: 'replace'
      title: string
      original: string
      replacement: string
    }
  | {
      kind: 'move-file'
      title: string
      targetPath: string
    }

export interface KubeJsIssue {
  severity: KubeJsIssueSeverity
  source: KubeJsIssueSource
  code: string
  message: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  /** 可直接本地应用的确定性修复；没有 fix 的问题只能手动处理。 */
  fix?: KubeJsIssueFix
}

export interface KubeJsLintRequest {
  instanceId: string
  path: string
  content: string
}

export interface KubeJsLintResult {
  path: string
  issues: KubeJsIssue[]
  indexReady: boolean
  durationMs: number
  checkedAt: number
}

export interface KubeJsProjectLintRequest {
  instanceId: string
  overrides?: { path: string; content: string }[]
}

export interface KubeJsProjectLintFile {
  path: string
  issues: KubeJsIssue[]
  errorCount: number
  warningCount: number
}

export interface KubeJsProjectLintResult {
  instanceId: string
  files: KubeJsProjectLintFile[]
  scannedFiles: number
  cleanFiles: number
  skippedFiles: number
  errorCount: number
  warningCount: number
  indexReady: boolean
  durationMs: number
  generatedAt: number
}

export type KubeJsLogSource = 'server' | 'client' | 'startup' | 'latest'

export interface KubeJsLogFrame {
  file: string | null
  line: number | null
  text: string
}

export interface KubeJsLogEntry {
  id: string
  time: string | null
  level: 'error' | 'warning'
  message: string
  scriptPath: string | null
  rawPath: string | null
  line: number | null
  column: number | null
  source: KubeJsLogSource
  details: string[]
  frames: KubeJsLogFrame[]
}

export interface KubeJsLogFileInfo {
  name: string
  source: KubeJsLogSource
  size: number
  modified: number
  entries: number
}

export interface KubeJsLogReport {
  instanceId: string
  entries: KubeJsLogEntry[]
  files: KubeJsLogFileInfo[]
  truncated: boolean
  scannedAt: number
  error: string | null
}

export type ServerPackCheckTone = 'pass' | 'warn' | 'fail' | 'info'

export interface ServerPackCheckItem {
  id: string
  title: string
  tone: ServerPackCheckTone
  detail: string
}

export interface ServerPackInspectReport {
  path: string
  fileName: string
  bytes: number
  fileCount: number
  loader: string
  loaderVersion: string | null
  gameVersion: string
  javaMajor: number | null
  java: {
    path: string
    version: string
    major: number
  } | null
  canRun: boolean
  runBlockReason: string | null
  checks: ServerPackCheckItem[]
  ok: boolean
}

export interface ServerPackVerifyRequest {
  instanceId: string
  path: string
}

export interface ServerPackVerifyProgress {
  path: string
  stage: string
  percent: number
  line: string | null
}

export interface ServerPackVerifyReport {
  ok: boolean
  cancelled: boolean
  summary: string
  durationMs: number
  checks: ServerPackCheckItem[]
  logPath: string | null
  logTail: string
}

export interface KubeJsRuntimeIssue {
  level: 'error' | 'warning'
  message: string
  path: string | null
  line: number | null
  column: number | null
}

export interface KubeJsRuntimeProgress {
  stage: string
  percent: number
  line: string | null
}

export interface KubeJsRuntimeReport {
  ok: boolean
  cancelled: boolean
  summary: string
  durationMs: number
  checks: ServerPackCheckItem[]
  issues: KubeJsRuntimeIssue[]
  logPath: string | null
  logTail: string
  scriptCount: number
  clientScriptCount: number
}

export interface JvmPresetView {
  id: string
  name: string
  args: string
  description: string
  builtIn: boolean
  minJava?: number | null
}

export interface JvmPresetInput {
  id?: string | null
  name: string
  args: string
  description?: string
}

export interface JvmPresetPayload {
  presets: JvmPresetView[]
}

export interface ScreenshotView {
  id: string
  name: string
  sizeBytes: number
  modifiedAt: number
  url: string
  thumbUrl: string
}

export interface ScreenshotGallery {
  instanceId: string
  instanceName: string
  directory: string
  exists: boolean
  totalBytes: number
  screenshots: ScreenshotView[]
}

export interface JavaInfo {
  path: string
  version: string
  major: number
  vendor: string
  arch: string
  source: 'custom' | 'path' | 'scan' | 'runtime'
}

export type JavaAssignmentStatus = 'ready' | 'manual' | 'missing' | 'incompatible'

export interface JavaAssignmentView {
  instanceId: string
  name: string
  gameVersion: string
  loader: InstanceLoader
  requiredMajor: number | null
  javaPath: string | null
  javaVersion: string | null
  javaMajor: number | null
  status: JavaAssignmentStatus
  message: string | null
}

export interface JavaAssignmentApply {
  instanceId: string
  javaPath: string | null
}

export interface DownloadActiveFile {
  label: string
  bytes: number
  size: number
}

export interface DownloadDetail {
  current: number
  total: number
  bytesDone: number
  bytesTotal: number
  speed: number
  activeFiles?: DownloadActiveFile[]
}

export type TaskStatus = 'running' | 'paused' | 'done' | 'error' | 'cancelled'

export interface ManualPackFile {
  projectId: string
  fileId: string
  fileName: string
  size: number | null
  sha1: string | null
  pageUrl: string
}

export interface TaskState {
  id: string
  kind: 'install' | 'java' | 'modpack' | 'loader' | 'preset' | 'world' | 'instance' | 'serverPack'
  title: string
  stage: string
  progress: number
  detail: DownloadDetail
  status: TaskStatus
  message?: string
  error?: string
  manualFiles?: ManualPackFile[]
  manualMods?: ManualModDownload[]
  versionId?: string
  instanceId?: string
  projectId?: string
  createdAt: number
  finishedAt?: number
}

export type LaunchStatus = 'idle' | 'preparing' | 'starting' | 'running' | 'exited' | 'error'

export interface LaunchState {
  status: LaunchStatus
  message: string
  progress: number | null
  stage: string | null
  versionId: string | null
  instanceId: string | null
  pid: number | null
  startedAt: number | null
  exitCode: number | null
  error: string | null
  speed: number | null
}

export interface InstanceSummary {
  id: string
  name: string
  summary: string
  iconUrl: string | null
  gameVersion: string
  loader: InstanceLoader
  loaderVersion: string | null
  versionId: string
  /** 内部实例创建时绑定的共享资源目录；旧实例为空时回退到设置里的 gameDir。 */
  baseDir?: string | null
  javaMajor: number | null
  modCount: number
  source: InstanceSource
  projectId: string | null
  lastPlayed: number | null
  installedAt: number
  category?: string
  favorite?: boolean
  memoryMb?: number | null
  extraJvmArgs?: string
  javaPath?: string | null
  external?: {
    baseDir: string
    gameDir: string
  } | null
}

export interface InstanceSettingsPatch {
  memoryMb?: number | null
  extraJvmArgs?: string
  javaPath?: string | null
}

export interface InstanceTransferRequest {
  instanceId: string
  mode: 'move' | 'clone'
  targetDir: string
  name?: string
}

export type WorldBackupKind = 'manual' | 'loader' | 'restore'

export type BackupKind = 'worlds' | 'kubejs' | 'content'

export interface BackupKindUsage {
  kind: BackupKind
  count: number
  bytes: number
  oldestAt: number | null
  newestAt: number | null
}

export interface BackupInstanceUsage {
  instanceId: string
  instanceName: string
  gameVersion: string
  totalBytes: number
  totalCount: number
  /** 该实例 backups 下未识别的旧目录大小。 */
  otherBytes: number
  kinds: BackupKindUsage[]
}

export interface BackupOverview {
  totalBytes: number
  totalCount: number
  /** backups 下不属于三类备份的旧目录/文件大小，只统计不自动清理。 */
  otherBytes: number
  kinds: BackupKindUsage[]
  instances: BackupInstanceUsage[]
  scannedAt: number
}

export interface BackupCleanupRequest {
  instanceId?: string | null
  kinds: BackupKind[]
  mode: 'policy' | 'older-than' | 'all'
  days?: number
}

export interface BackupCleanupResult {
  removed: number
  bytes: number
  instances: number
  skipped: number
}

export interface WorldSummary {
  folder: string
  name: string
  version: string | null
  size: number
  files: number
  lastPlayed: number | null
  iconDataUrl: string | null
  backupCount: number
  backupBytes: number
  latestBackupAt: number | null
  /** false 表示世界已不在 saves 中，只剩备份。 */
  present: boolean
}

export interface WorldBackupView {
  id: string
  worldFolder: string
  worldName: string
  createdAt: number
  kind: WorldBackupKind
  label: string
  bytes: number
  files: number
}

export type ServerStatusState = 'unknown' | 'online' | 'offline'

export interface ServerPlayerSample {
  name: string
  id: string | null
}

export interface ServerStatus {
  state: ServerStatusState
  motd: string
  version: string | null
  protocol: number | null
  playersOnline: number | null
  playersMax: number | null
  playersSample: ServerPlayerSample[]
  latencyMs: number | null
  favicon: string | null
  checkedAt: number | null
  error: string | null
}

export interface ServerRecord {
  id: string
  name: string
  host: string
  port: number
  instanceId: string | null
  category: string
  note: string
  createdAt: number
  updatedAt: number
}

export interface ServerView extends ServerRecord {
  status: ServerStatus
}

export interface ServerInput {
  name: string
  address: string
  instanceId: string | null
  category?: string
  note?: string
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error'
export type DiagnosticCategory =
  | 'java'
  | 'memory'
  | 'files'
  | 'mods'
  | 'crash'
  | 'graphics'
  | 'other'

export interface DiagnosticIssue {
  id: string
  category: DiagnosticCategory
  severity: DiagnosticSeverity
  title: string
  detail: string
  evidence: string[]
  modFiles: string[]
}

export interface CrashReportView {
  found: boolean
  file: string | null
  createdAt: number | null
  summary: string | null
  excerpt: string[]
  issues: DiagnosticIssue[]
}

export interface KnownGoodSnapshot {
  fingerprint: string
  recordedAt: number
  modCount: number
  gameVersion: string
  loader: InstanceLoader
  javaMajor: number | null
  memoryMb: number
}

export interface ModFingerprintDiff {
  added: string[]
  removed: string[]
  changed: string[]
}

export interface DiagnosticReport {
  instanceId: string
  instanceName: string
  checkedAt: number
  status: 'healthy' | 'warning' | 'error'
  fingerprint: string
  knownGood: KnownGoodSnapshot | null
  knownGoodMatch: boolean
  changes: ModFingerprintDiff | null
  ignoredCount: number
  issues: DiagnosticIssue[]
  crash: CrashReportView | null
}

export interface AiConfigView {
  enabled: boolean
  baseUrl: string
  model: string
  hasKey: boolean
  encryption: boolean
}

export interface AiConfigPatch {
  enabled?: boolean
  baseUrl?: string
  model?: string
  apiKey?: string | null
}

export interface AiCause {
  title: string
  detail: string
  evidence: string
  fix: string
}

export interface AiDiagnosisView {
  model: string
  summary: string
  confidence: 'low' | 'medium' | 'high' | null
  causes: AiCause[]
  checks: string[]
  raw: string | null
  sentBytes: number
  sentAt: number
}

export interface ServerProbe {
  address: string
  host: string
  port: number
  status: ServerStatus
}

export interface ServerPingResult {
  id: string
  status: ServerStatus
}

export interface ModpackExportOptions {
  mods: boolean
  config: boolean
  resourcepacks: boolean
  shaderpacks: boolean
  datapacks: boolean
}

export interface ModpackExportProgress {
  done: number
  total: number
  bytes: number
}

export interface ModpackExportResult extends ModpackExportProgress {
  path: string
}

export interface InstanceMetaPatch {
  name?: string
  summary?: string
  category?: string
  favorite?: boolean
  iconUrl?: string | null
}

export type LocalPackKind = 'archive' | 'instance'

export interface LocalPackView {
  key: string
  kind: LocalPackKind
  name: string
  path: string
  source: string
  gameVersion: string
  loader: InstanceLoader
  loaderVersion: string | null
  modCount: number
  detail: string
  importable: boolean
  reason: string | null
  external: boolean
  versionId?: string | null
}

export interface LocalPackRootView {
  label: string
  path: string
  exists: boolean
}

export interface LocalPackScanResult {
  packs: LocalPackView[]
  roots: LocalPackRootView[]
  scannedAt: number
}

export interface LocalPackImportRequest {
  path: string
  kind: LocalPackKind
}

export interface ModrinthProjectView {
  provider: ContentProvider
  projectId: string
  slug: string
  title: string
  localizedName?: string | null
  description: string
  author: string
  iconUrl: string | null
  downloads: number
  categories: string[]
  gameVersions: string[]
  latestVersion: string | null
}

export interface ModrinthSearchView {
  hits: ModrinthProjectView[]
  totalHits: number
  offset: number
  nextOffset?: number
}

export interface ModrinthInstallRequest {
  projectId: string
  title: string
  iconUrl: string | null
  summary: string
  versionId?: string | null
}

export interface CurseForgeInstallRequest {
  projectId: string
  title: string
  iconUrl: string | null
  summary: string
  fileId: string
  manualFiles?: string[]
}

export interface ModpackVersionView {
  id: string
  name: string
  versionNumber: string
  versionType: string
  gameVersion: string
  loaders: string[]
  datePublished: string
  fileSize: number | null
}

export interface LoaderVersionView {
  version: string
  latest: boolean
  /** OptiFine 的预览构建单独标记；其他加载器可省略。 */
  channel?: 'stable' | 'preview'
  /** YYYY-MM-DD；目前仅 OptiFine 预览构建提供。 */
  releasedAt?: string
  note?: string
}

export type ContentProvider = 'modrinth' | 'curseforge'
export type ContentKind = 'mod' | 'datapack' | 'resourcepack' | 'shader'

export interface ModProjectView {
  provider: ContentProvider
  projectId: string
  slug: string
  title: string
  localizedName?: string | null
  description: string
  author: string
  iconUrl: string | null
  downloads: number
  categories: string[]
  gameVersions: string[]
}

export interface ModDependencyView {
  provider: ContentProvider
  projectId: string
  title: string
  iconUrl: string | null
  type: 'required' | 'optional' | 'incompatible' | 'embedded'
}

export interface ModVersionView {
  id: string
  name: string
  versionNumber: string
  versionType: string
  gameVersions: string[]
  loaders: string[]
  filename: string | null
  fileSize: number | null
  downloads: number
  datePublished: string
  dependencies: ModDependencyView[]
}

export interface ModSearchView {
  hits: ModProjectView[]
  totalHits: number
  offset: number
  nextOffset?: number
}

export interface ModInstallRequest {
  instanceId: string
  provider: ContentProvider
  projectId: string
  title?: string
  versionId?: string | null
  kind?: ContentKind
  includeDependencies?: boolean
}

export interface ManualModDownload {
  title: string
  url: string
  filename?: string
}

export interface ModInstallResult {
  installed: { title: string; file: string }[]
  skipped: string[]
  manual: ManualModDownload[]
}

export interface InstalledModView {
  file: string
  size: number
  enabled: boolean
}

export interface PresetModView {
  provider: ContentProvider
  projectId: string
  slug: string
  title: string
  localizedName?: string | null
  iconUrl: string | null
  author: string | null
  addedAt: number
}

export interface PresetModsPayload {
  items: PresetModView[]
  autoInstall: boolean
}

export interface PresetModInput {
  provider: ContentProvider
  projectId: string
  slug: string
  title: string
  iconUrl?: string | null
  author?: string | null
}

export interface PresetCheckEntry extends PresetModView {
  present: boolean
  enabled: boolean
  compatible: boolean
  versionId: string | null
  versionNumber: string | null
  fileSize: number | null
  message: string | null
}

export interface PresetCheckResult {
  instanceId: string
  instanceName: string
  gameVersion: string
  loader: InstanceLoader
  applicable: boolean
  reason: string | null
  autoInstall: boolean
  entries: PresetCheckEntry[]
}

export interface PresetInstallItem {
  provider: ContentProvider
  projectId: string
  versionId: string | null
  title: string
}

export interface PresetInstallRequest {
  instanceId: string
  items: PresetInstallItem[]
}

export interface CustomSearchAlias {
  id: string
  chinese: string
  query: string
  aliases: string[]
  curseforgeSlugs: string[]
  modrinthSlugs: string[]
  sourceUrl: string | null
  addedAt: number
}

export interface CustomSearchAliasPayload {
  items: CustomSearchAlias[]
}

export interface CustomSearchAliasImportResult extends CustomSearchAliasPayload {
  item: CustomSearchAlias
}

export type ContentLedgerSource = 'modrinth' | 'curseforge' | 'local'
export type ContentLedgerCheckState =
  | 'unchecked'
  | 'checking'
  | 'current'
  | 'update'
  | 'error'

export interface ContentLedgerEntryView {
  kind: ContentKind
  file: string
  name: string
  size: number
  enabled: boolean
  sha1: string
  provider: ContentProvider | null
  source: ContentLedgerSource
  projectId: string | null
  projectTitle: string | null
  slug: string | null
  versionId: string | null
  versionNumber: string | null
  latestVersionId: string | null
  latestVersionNumber: string | null
  latestFileName: string | null
  latestFileSize: number | null
  updateAvailable: boolean
  checkState: ContentLedgerCheckState
  checkMessage: string | null
  latestCheckedAt: number | null
}

export interface ContentLedgerKindSummary {
  kind: ContentKind
  total: number
  identified: number
  updates: number
}

export interface ContentLedgerUpdateSummary {
  createdAt: number
  updatedCount: number
  canRollback: boolean
  changes: ContentUpdateChange[]
}

export interface ContentLedgerView {
  instanceId: string
  scannedAt: number
  checkedAt: number | null
  entries: ContentLedgerEntryView[]
  summary: ContentLedgerKindSummary[]
  lastUpdate: ContentLedgerUpdateSummary | null
  errors: string[]
}

export type PreviewableContentKind = 'datapack' | 'resourcepack' | 'shader'

export interface ContentPreviewEntry {
  path: string
  name: string
  type: 'file' | 'dir'
  size: number
  childCount: number | null
}

export interface ContentPreviewDirResult {
  path: string
  entries: ContentPreviewEntry[]
  total: number
  truncated: boolean
}

export interface ContentPackPreview {
  kind: PreviewableContentKind
  file: string
  name: string
  size: number
  fileCount: number
  totalBytes: number
  packFormat: string | null
  description: string | null
  icon: string | null
  suggestedPath: string | null
  entries: ContentPreviewEntry[]
  rootTotal: number
}

export type ContentPreviewFileKind = 'text' | 'image' | 'audio' | 'binary'

export interface ContentPreviewFile {
  path: string
  name: string
  size: number
  kind: ContentPreviewFileKind
  text: string | null
  dataUrl: string | null
  mime: string | null
  truncated: boolean
  lineCount: number | null
  width: number | null
  height: number | null
  note: string | null
}

export interface ContentPreviewSearchResult {
  items: ContentPreviewEntry[]
  total: number
}

export interface ContentUpdateSelection {
  kind: ContentKind
  file: string
}

export interface ContentUpdateRequest {
  instanceId: string
  files: ContentUpdateSelection[]
}

export type ContentUpdatePhase =
  | 'prepare'
  | 'backup'
  | 'snapshot'
  | 'install'
  | 'download'
  | 'refresh'
  | 'rollback'
  | 'done'

export interface ContentUpdateProgress {
  instanceId: string
  phase: ContentUpdatePhase
  stage: string
  percent: number
  filesDone: number
  filesTotal: number
  file: string | null
  bytesDone: number
  bytesTotal: number
}

export interface ContentUpdateChange {
  kind: ContentKind
  file: string
  title: string
  fromVersionId: string | null
  fromVersion: string | null
  toVersionId: string
  toVersion: string | null
  newFile: string | null
  provider?: ContentProvider | null
  projectId?: string | null
}

export interface ContentUpdateAiSummary {
  summary: string
  model: string | null
  localOnly: boolean
  warnings: string[]
  sentBytes: number
  generatedAt: number
}

export interface ContentUpdateResult {
  ok: boolean
  rolledBack: boolean
  updated: ContentUpdateChange[]
  addedFiles: string[]
  manual: ManualModDownload[]
  error: string | null
  ledger: ContentLedgerView
}

export interface ContentRollbackResult {
  ok: boolean
  error: string | null
  ledger: ContentLedgerView
}

export interface ContentChangelogView {
  provider: ContentProvider
  projectId: string
  versionId: string
  versionNumber: string
  changelog: string
  datePublished: string
  fileName: string | null
  fileSize: number | null
  url: string | null
}

export interface ModDownloadRequest {
  provider: ContentProvider
  projectId: string
  gameVersion: string
  loader: string
  versionId?: string | null
  kind?: ContentKind
  includeDependencies?: boolean
}

export interface ModDownloadResult {
  file: string | null
  files: string[]
  manual: ManualModDownload[]
}

export interface LoaderInstanceRequest {
  gameVersion: string
  loader: 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'optifine'
  loaderVersion?: string | null
  name?: string
}

export interface VanillaInstanceRequest {
  gameVersion: string
  name?: string
}

export interface InstanceLoaderUpdateRequest {
  instanceId: string
  loaderVersion: string
}

export interface LoaderRollbackState {
  instanceId: string
  fromVersionId: string
  fromLoaderVersion: string
  toVersionId: string
  toLoaderVersion: string
  updatedAt: number
}

export interface LaunchLogLine {
  time: number
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

export interface MsDeviceCode {
  sessionId: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
  message: string
}

export type AuthCheckStage = 'oauth' | 'xbox' | 'xsts' | 'minecraft' | 'profile'
export type AuthCheckStatus = 'ok' | 'fail' | 'skipped'
export type AuthVerdict = 'passed' | 'not-allowlisted' | 'no-ownership' | 'failed'

export interface AuthCheckStep {
  stage: AuthCheckStage
  label: string
  status: AuthCheckStatus
  httpStatus?: number
  code?: string
  detail?: string
}

export interface AuthDiagnosticView {
  at: number
  clientId: string
  steps: AuthCheckStep[]
  verdict: AuthVerdict
  summary: string
}

export interface MsPollResult {
  status: 'pending' | 'slow_down' | 'success' | 'expired' | 'error'
  message?: string
  accounts?: AccountsPayload
  diagnostic?: AuthDiagnosticView
}

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface LauncherApi {
  window: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<boolean>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (cb: (maximized: boolean) => void) => () => void
  }
  app: {
    info: () => Promise<AppInfo>
    openExternal: (url: string) => Promise<void>
    restart: () => Promise<void>
    releaseMemory: (scope?: 'app' | 'system') => Promise<{ beforeKb: number; afterKb: number; processes?: number }>
    releaseMemoryElevated: () => Promise<{
      cancelled: boolean
      beforeKb?: number
      afterKb?: number
      privilege?: boolean
      flush?: number
      standby?: number
      empty?: number
      error?: string
    }>
    openPath: (path: string) => Promise<void>
    revealPath: (path: string) => Promise<void>
    pickDirectory: (title?: string, defaultPath?: string) => Promise<string | null>
    pickFile: (title?: string, filters?: FileFilter[]) => Promise<string | null>
    pickSaveFile: (
      title?: string,
      defaultPath?: string,
      filters?: FileFilter[]
    ) => Promise<string | null>
    getPathForFile: (file: unknown) => string
    icon: (url: string) => Promise<string | null>
    imageDataUrl: (path: string) => Promise<string | null>
    diskSpace: () => Promise<{ freeGb: number; totalGb: number }>
    cacheStats: () => Promise<{ bytes: number; count: number }>
    clearCache: () => Promise<{ bytes: number; count: number }>
  }
  settings: {
    get: () => Promise<LauncherSettings>
    update: (patch: Partial<LauncherSettings>) => Promise<LauncherSettings>
    chooseBackground: () => Promise<string | null>
  }
  updater: {
    state: () => Promise<LauncherUpdateState>
    check: (silent?: boolean) => Promise<LauncherUpdateState>
    download: () => Promise<LauncherUpdateState>
    cancel: () => Promise<LauncherUpdateState>
    install: () => Promise<LauncherUpdateState>
    onState: (cb: (state: LauncherUpdateState) => void) => () => void
  }
  auth: {
    list: () => Promise<AccountsPayload>
    addOffline: (name: string) => Promise<AccountsPayload>
    setActive: (id: string) => Promise<AccountsPayload>
    remove: (id: string) => Promise<AccountsPayload>
    startMicrosoft: (clientId?: string) => Promise<MsDeviceCode>
    pollMicrosoft: (sessionId: string) => Promise<MsPollResult>
    cancelMicrosoft: (sessionId: string) => Promise<void>
    skin: (uuid: string) => Promise<string | null>
    onChanged: (cb: (payload: AccountsPayload) => void) => () => void
  }
  versions: {
    installed: () => Promise<InstalledVersion[]>
    manifest: (source?: DownloadSource) => Promise<VersionManifestView>
    install: (id: string) => Promise<TaskState>
    remove: (id: string) => Promise<void>
    cleanupPreview: () => Promise<VersionCleanupPreview>
    cleanup: (ids: string[]) => Promise<VersionCleanupResult>
    folders: () => Promise<VersionFolderView[]>
    openFolder: (id: string) => Promise<void>
    exportJson: (id: string) => Promise<boolean>
  }
  instances: {
    list: () => Promise<InstanceSummary[]>
    importFile: () => Promise<TaskState | null>
    installModrinth: (request: ModrinthInstallRequest) => Promise<TaskState>
    installCurseForge: (request: CurseForgeInstallRequest) => Promise<TaskState>
    createLoader: (request: LoaderInstanceRequest) => Promise<TaskState>
    createVanilla: (request: VanillaInstanceRequest) => Promise<TaskState>
    updateLoader: (request: InstanceLoaderUpdateRequest) => Promise<TaskState>
    loaderRollbackState: (id: string) => Promise<LoaderRollbackState | null>
    rollbackLoader: (id: string) => Promise<TaskState>
    loaderVersions: (
      gameVersion: string,
      loader: 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'optifine'
    ) => Promise<LoaderVersionView[]>
    remove: (id: string, deleteExternalFiles?: boolean) => Promise<string[]>
    openFolder: (
      id: string,
      kind?: 'version' | 'saves' | 'mods' | 'screenshots' | 'logs' | 'crash-reports' | 'kubejs'
    ) => Promise<void>
    updateSettings: (id: string, patch: InstanceSettingsPatch) => Promise<InstanceSummary>
    updateMeta: (id: string, patch: InstanceMetaPatch) => Promise<InstanceSummary>
    exportModpack: (
      id: string,
      options: ModpackExportOptions,
      path: string
    ) => Promise<ModpackExportResult>
    onExportProgress: (cb: (progress: ModpackExportProgress) => void) => () => void
    exportScript: (id: string) => Promise<string | null>
    repair: (id: string) => Promise<TaskState>
    launch: (id: string) => Promise<void>
    transfer: (request: InstanceTransferRequest) => Promise<TaskState>
  }
  serverPacks: {
    preview: (instanceId: string) => Promise<ServerPackPreview>
    suggest: (instanceId: string) => Promise<ServerPackAiSuggestion>
    create: (request: ServerPackRequest) => Promise<TaskState>
    inspect: (instanceId: string, path: string) => Promise<ServerPackInspectReport>
    verify: (request: ServerPackVerifyRequest) => Promise<ServerPackVerifyReport>
    cancelVerify: () => Promise<boolean>
    onVerifyProgress: (cb: (progress: ServerPackVerifyProgress) => void) => () => void
  }
  workshop: {
    report: (instanceId: string) => Promise<WorkshopReport>
    exportPack: (request: WorkshopExportRequest) => Promise<WorkshopExportResult>
    onExportProgress: (cb: (progress: WorkshopExportProgress) => void) => () => void
    kubejsFiles: (instanceId: string) => Promise<{ exists: boolean; files: KubeJsFileView[] }>
    kubejsRead: (instanceId: string, path: string) => Promise<KubeJsFileContent>
    kubejsSave: (request: KubeJsSaveRequest) => Promise<KubeJsSaveResult>
    kubejsRemove: (instanceId: string, path: string) => Promise<void>
    kubejsRename: (request: KubeJsRenameRequest) => Promise<KubeJsFileContent>
    kubejsHistory: (instanceId: string) => Promise<KubeJsHistoryEntry[]>
    kubejsHistoryRead: (
      instanceId: string,
      stamp: string,
      path: string
    ) => Promise<KubeJsHistoryContent>
    kubejsHistoryRestore: (request: KubeJsHistoryRestoreRequest) => Promise<KubeJsFileContent>
    kubejsHistoryClean: (instanceId: string, keep?: number) => Promise<KubeJsHistoryCleanupResult>
    kubejsIndexStatus: (instanceId: string) => Promise<KubeJsIndexStatus>
    kubejsIndexBuild: (instanceId: string) => Promise<KubeJsIndexStatus>
    kubejsIndexCancel: () => Promise<boolean>
    kubejsIndexSearch: (request: KubeJsIndexSearchRequest) => Promise<KubeJsIndexSearchResult>
    kubejsRecipeDetail: (
      instanceId: string,
      recipeId: string
    ) => Promise<KubeJsRecipeDetail>
    kubejsItemIcons: (instanceId: string, ids: string[]) => Promise<Record<string, string | null>>
    onKubejsIndexProgress: (cb: (progress: KubeJsIndexProgress) => void) => () => void
    kubejsLint: (request: KubeJsLintRequest) => Promise<KubeJsLintResult>
    kubejsLintProject: (request: KubeJsProjectLintRequest) => Promise<KubeJsProjectLintResult>
    kubejsLogs: (instanceId: string) => Promise<KubeJsLogReport>
    kubejsTemplates: () => Promise<KubeJsTemplateView[]>
    kubejsAi: (request: KubeJsAiRequest) => Promise<KubeJsAiResult>
    kubejsQa: (request: KubeJsQaRequest) => Promise<KubeJsQaResult>
    kubejsExplain: (request: KubeJsExplainRequest) => Promise<KubeJsExplainResult>
    kubejsRuntimeCheck: (instanceId: string) => Promise<KubeJsRuntimeReport>
    cancelKubejsRuntime: () => Promise<boolean>
    onKubejsRuntimeProgress: (cb: (progress: KubeJsRuntimeProgress) => void) => () => void
  }
  jvm: {
    presets: () => Promise<JvmPresetPayload>
    savePreset: (input: JvmPresetInput) => Promise<JvmPresetPayload>
    removePreset: (id: string) => Promise<JvmPresetPayload>
  }
  playtime: {
    report: () => Promise<PlaytimeReport>
    onChanged: (cb: () => void) => () => void
  }
  screenshots: {
    list: (instanceId: string) => Promise<ScreenshotGallery>
    remove: (instanceId: string, name: string) => Promise<void>
    copy: (instanceId: string, name: string) => Promise<void>
    open: (instanceId: string, name: string) => Promise<void>
  }
  backups: {
    overview: () => Promise<BackupOverview>
    cleanup: (request: BackupCleanupRequest) => Promise<BackupCleanupResult>
  }
  worlds: {
    list: (instanceId: string) => Promise<WorldSummary[]>
    backups: (instanceId: string, worldFolder: string) => Promise<WorldBackupView[]>
    backup: (instanceId: string, worldFolder?: string | null) => Promise<TaskState>
    restore: (instanceId: string, worldFolder: string, backupId: string) => Promise<TaskState>
    deleteBackup: (instanceId: string, worldFolder: string, backupId: string) => Promise<void>
    openFolder: (instanceId: string, kind: 'saves' | 'backups') => Promise<void>
  }
  diagnostics: {
    run: (instanceId: string) => Promise<DiagnosticReport>
    markKnownGood: (instanceId: string) => Promise<KnownGoodSnapshot>
    ignoreIssue: (instanceId: string, issueId: string) => Promise<void>
    clearIgnored: (instanceId: string) => Promise<void>
  }
  ai: {
    getConfig: () => Promise<AiConfigView>
    updateConfig: (patch: AiConfigPatch) => Promise<AiConfigView>
    analyze: (instanceId: string) => Promise<AiDiagnosisView>
  }
  servers: {
    list: () => Promise<ServerView[]>
    add: (input: ServerInput) => Promise<ServerView>
    update: (id: string, input: ServerInput) => Promise<ServerView>
    remove: (id: string) => Promise<void>
    ping: (id: string) => Promise<ServerStatus>
    pingAll: () => Promise<ServerPingResult[]>
    probe: (address: string) => Promise<ServerProbe>
    playerSkin: (name: string, uuid: string | null) => Promise<string | null>
    launch: (id: string) => Promise<void>
  }
  presets: {
    list: () => Promise<PresetModsPayload>
    add: (input: PresetModInput) => Promise<PresetModsPayload>
    remove: (provider: ContentProvider, projectId: string) => Promise<PresetModsPayload>
    setAutoInstall: (enabled: boolean) => Promise<PresetModsPayload>
    check: (instanceId: string) => Promise<PresetCheckResult>
    install: (request: PresetInstallRequest) => Promise<TaskState>
  }
  searchAliases: {
    list: () => Promise<CustomSearchAliasPayload>
    importMcmod: (url: string) => Promise<CustomSearchAliasImportResult>
    remove: (id: string) => Promise<CustomSearchAliasPayload>
  }
  mods: {
    search: (
      provider: ContentProvider,
      query: string,
      instanceId: string,
      offset?: number,
      kind?: ContentKind
    ) => Promise<ModSearchView>
    install: (request: ModInstallRequest) => Promise<ModInstallResult>
    searchCatalog: (
      provider: ContentProvider,
      query: string,
      gameVersion: string,
      loader: string,
      offset?: number,
      kind?: ContentKind
    ) => Promise<ModSearchView>
    versions: (
      provider: ContentProvider,
      projectId: string,
      kind?: ContentKind
    ) => Promise<ModVersionView[]>
    download: (request: ModDownloadRequest) => Promise<ModDownloadResult>
    list: (instanceId: string) => Promise<InstalledModView[]>
    remove: (instanceId: string, file: string) => Promise<InstalledModView[]>
    toggle: (instanceId: string, file: string, enabled: boolean) => Promise<InstalledModView[]>
    importFiles: (instanceId: string) => Promise<InstalledModView[] | null>
    openFolder: (instanceId: string) => Promise<void>
  }
  ledger: {
    scan: (instanceId: string, force?: boolean) => Promise<ContentLedgerView>
    check: (instanceId: string, force?: boolean) => Promise<ContentLedgerView>
    update: (request: ContentUpdateRequest) => Promise<ContentUpdateResult>
    rollback: (instanceId: string) => Promise<ContentRollbackResult>
    onProgress: (callback: (progress: ContentUpdateProgress) => void) => () => void
    changelog: (
      provider: ContentProvider,
      projectId: string,
      versionId: string
    ) => Promise<ContentChangelogView>
    explainUpdate: (instanceId: string) => Promise<ContentUpdateAiSummary>
    previewPack: (
      instanceId: string,
      kind: PreviewableContentKind,
      file: string
    ) => Promise<ContentPackPreview>
    previewDir: (
      instanceId: string,
      kind: PreviewableContentKind,
      file: string,
      path: string
    ) => Promise<ContentPreviewDirResult>
    previewFile: (
      instanceId: string,
      kind: PreviewableContentKind,
      file: string,
      path: string
    ) => Promise<ContentPreviewFile>
    previewSearch: (
      instanceId: string,
      kind: PreviewableContentKind,
      file: string,
      query: string
    ) => Promise<ContentPreviewSearchResult>
  }
  modrinth: {
    search: (query: string, offset?: number) => Promise<ModrinthSearchView>
    versions: (projectId: string) => Promise<ModpackVersionView[]>
  }
  curseforge: {
    searchModpacks: (
      query: string,
      gameVersion: string,
      loader: string,
      offset?: number
    ) => Promise<ModrinthSearchView>
    modpackVersions: (projectId: string) => Promise<ModpackVersionView[]>
  }
  localPacks: {
    scan: (extraPaths?: string[] | string | null) => Promise<LocalPackScanResult>
    import: (request: LocalPackImportRequest) => Promise<TaskState>
    importMany: (requests: LocalPackImportRequest[]) => Promise<TaskState>
  }
  java: {
    detect: (refresh?: boolean) => Promise<JavaInfo[]>
    downloadForVersion: (versionId: string) => Promise<TaskState>
    assignments: () => Promise<JavaAssignmentView[]>
    applyAssignments: (list: JavaAssignmentApply[]) => Promise<InstanceSummary[]>
  }
  launch: {
    start: (versionId: string) => Promise<void>
    cancel: () => Promise<void>
    stop: () => Promise<void>
    getState: () => Promise<LaunchState>
    getLogs: () => Promise<LaunchLogLine[]>
    onState: (cb: (state: LaunchState) => void) => () => void
    onLog: (cb: (line: LaunchLogLine) => void) => () => void
  }
  tasks: {
    list: () => Promise<TaskState[]>
    cancel: (id: string) => Promise<void>
    pause: (id: string) => Promise<void>
    resume: (id: string) => Promise<void>
    onUpdate: (cb: (task: TaskState) => void) => () => void
  }
  logs: {
    openFolder: () => Promise<void>
    latestPath: () => Promise<string | null>
    readLatest: () => Promise<string>
  }
}
