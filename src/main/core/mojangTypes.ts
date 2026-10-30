export interface Rule {
  action: 'allow' | 'disallow'
  os?: {
    name?: string
    arch?: string
    version?: string
  }
  features?: Record<string, boolean>
}

export type ArgumentEntry = string | { rules?: Rule[]; value: string | string[] }

export interface LibraryDownloads {
  artifact?: LibraryArtifact
  classifiers?: Record<string, LibraryArtifact>
}

export interface LibraryArtifact {
  path?: string
  sha1: string
  size: number
  url: string
}

export interface Library {
  name: string
  url?: string
  downloads?: LibraryDownloads
  natives?: Record<string, string>
  rules?: Rule[]
  extract?: { exclude?: string[] }
  sha1?: string
  sha256?: string
  sha512?: string
  size?: number
}

export interface VersionJson {
  id: string
  type?: string
  mainClass?: string
  inheritsFrom?: string
  jar?: string
  assets?: string
  assetIndex?: {
    id: string
    sha1: string
    size: number
    totalSize: number
    url: string
  }
  downloads?: {
    client?: LibraryArtifact
    server?: LibraryArtifact
  }
  libraries?: Library[]
  arguments?: {
    game?: ArgumentEntry[]
    jvm?: ArgumentEntry[]
  }
  minecraftArguments?: string
  logging?: {
    client?: {
      argument?: string
      file: { id: string; sha1: string; size: number; url: string }
      type?: string
    }
  }
  javaVersion?: {
    component: string
    majorVersion: number
  }
  minimumLauncherVersion?: number
  releaseTime?: string
  time?: string
}

export interface VersionEntry {
  id: string
  type: string
  url: string
  time: string
  releaseTime: string
  sha1?: string
  complianceLevel?: number
}

export interface VersionManifestRaw {
  latest: { release: string; snapshot: string }
  versions: VersionEntry[]
}

export interface AssetIndexRaw {
  objects: Record<string, { hash: string; size: number }>
  virtual?: boolean
  map_to_resources?: boolean
}

export interface JavaRuntimeEntry {
  availability?: { group?: number; progress?: number }
  manifest: { sha1: string; size: number; url: string }
  version: { name: string; released: string }
}

export interface JavaRuntimeManifestRaw {
  [platform: string]: Record<string, JavaRuntimeEntry[]>
}

export interface JavaRuntimeFile {
  type: 'file' | 'directory' | 'link'
  downloads?: {
    raw?: LibraryArtifact
    lzma?: LibraryArtifact
  }
  executable?: boolean
  target?: string
}

export interface JavaRuntimeFilesRaw {
  files: Record<string, JavaRuntimeFile>
}
