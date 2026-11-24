/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
  /** `fixture` shows the bundled agents roster instead of the engine (offline development). */
  readonly VITE_NEXUS_ROSTER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
