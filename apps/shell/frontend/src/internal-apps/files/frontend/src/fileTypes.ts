// File classification for the Files widget. The extension sets are ported as a
// spec from Brahma's actions/file_processor.py (personal-use reference): the
// groups are facts about file formats, not copied code. Markdown is split out
// from plain text because the viewer renders it richly.

export type FileCategory =
  | 'dir'
  | 'markdown'
  | 'text'
  | 'code'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'docx'
  | 'csv'
  | 'excel'
  | 'json'
  | 'xml'
  | 'pptx'
  | 'archive'
  | 'unknown'

const SETS = {
  markdown: ['md', 'markdown', 'mdx'],
  text: ['txt', 'rst', 'log', 'text'],
  code: [
    'py',
    'js',
    'ts',
    'jsx',
    'tsx',
    'html',
    'css',
    'java',
    'c',
    'cpp',
    'cs',
    'go',
    'rs',
    'rb',
    'php',
    'swift',
    'kt',
    'sh',
    'bash',
    'ps1',
    'lua',
    'r',
    'm',
    'sql',
    'yaml',
    'yml',
    'toml',
  ],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'ico'],
  video: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v', '3gp'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma', 'opus'],
  pdf: ['pdf'],
  docx: ['docx', 'doc'],
  csv: ['csv', 'tsv'],
  excel: ['xlsx', 'xls', 'ods'],
  json: ['json'],
  xml: ['xml'],
  pptx: ['pptx', 'ppt'],
  archive: ['zip', 'rar', 'tar', 'gz', '7z', 'bz2', 'xz'],
} satisfies Record<Exclude<FileCategory, 'dir' | 'unknown'>, readonly string[]>

const BY_EXT = new Map<string, FileCategory>()
for (const [category, exts] of Object.entries(SETS) as Array<[FileCategory, readonly string[]]>) {
  for (const ext of exts) BY_EXT.set(ext, category)
}

/** The lowercase extension without the dot, or '' when there isn't one. */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function classifyFile(name: string, isDir = false): FileCategory {
  if (isDir) return 'dir'
  return BY_EXT.get(extensionOf(name)) ?? 'unknown'
}

/** ASCII marks, never an icon font. `[x]` here is XML, not the error mark. */
export const FILE_GLYPH: Record<FileCategory, string> = {
  dir: '[/]',
  markdown: '[m]',
  text: '[=]',
  code: '[<]',
  image: '[~]',
  video: '(>)',
  audio: '(=)',
  pdf: '[p]',
  docx: '[w]',
  csv: '[,]',
  excel: '[s]',
  json: '[j]',
  xml: '[x]',
  pptx: '[v]',
  archive: '[z]',
  unknown: '[?]',
}

export type ViewerKind = 'markdown' | 'text' | 'code' | 'image' | 'video' | 'audio' | 'unsupported'

export function viewerFor(category: FileCategory): ViewerKind {
  switch (category) {
    case 'markdown':
      return 'markdown'
    case 'text':
    case 'csv':
    case 'json':
    case 'xml':
      return 'text'
    case 'code':
      return 'code'
    case 'image':
    case 'video':
    case 'audio':
      return category
    default:
      return 'unsupported'
  }
}

/** Human label for the metadata panel on types without a preview. */
export const CATEGORY_LABEL: Partial<Record<FileCategory, string>> = {
  pdf: 'pdf document',
  docx: 'word document',
  excel: 'spreadsheet',
  pptx: 'presentation',
  archive: 'archive',
  unknown: 'unknown type',
}

export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

/** Relative for the last week, a plain date after that. */
export function formatWhen(ms?: number | null, now = Date.now()): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return '—'
  const diff = Math.max(0, now - ms)
  if (diff < 60_000) return 'now'
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h`
  if (diff < 7 * 24 * 60 * 60_000) return `${Math.floor(diff / (24 * 60 * 60_000))}d`
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
