/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_APP_PASSWORD?: string
  readonly VITE_ENABLE_NLP?: string
  readonly VITE_MAPS_PROVIDER?: string  // 'osm' (default) | 'google'
  readonly VITE_GMAPS_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __BUILD_NUMBER__: string
declare const __BUILD_DATE__: string
