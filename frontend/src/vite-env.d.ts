/// <reference types="vite/client" />

/**
 * Ambient TypeScript declarations for the Vite build.
 *
 * This file has NO runtime effect — it only tells the TypeScript compiler about
 * the environment variables (`import.meta.env.VITE_*`) and the build-time
 * constants that Vite injects, so that referencing them elsewhere type-checks.
 *
 * Vite exposes ONLY variables prefixed with `VITE_` to the browser bundle.
 * Every field is optional (`?`) because a missing var arrives as `undefined`
 * and each consumer supplies its own fallback.
 */
interface ImportMetaEnv {
  /** Base URL of the backend REST API (e.g. "https://api.example.com"). When unset, the api client falls back to a relative "/api" path served by the same origin. */
  readonly VITE_API_URL?: string
  /** Optional admin passphrase gate. When set, the app runs read-only until the user unlocks Admin mode (see AuthContext / AdminBar in App.tsx) by entering this value. */
  readonly VITE_APP_PASSWORD?: string
  /** Feature flag for the natural-language search assistant ("TSABuddy"/NlpChat). Set to the string 'false' to disable it; any other value (or unset) enables it. */
  readonly VITE_ENABLE_NLP?: string
  /** Default map tile provider. 'osm' (OpenStreetMap, the default) or 'google' (Google Maps). The admin Config tab can override this at runtime. */
  readonly VITE_MAPS_PROVIDER?: string  // 'osm' (default) | 'google'
  /** Google Maps JavaScript API key. Required only when the maps provider is 'google'; without it the map falls back to OSM / shows an error status light. */
  readonly VITE_GMAPS_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Injected at build time by Vite's `define` — the incrementing CI build number, shown in the UI/footer for support. */
declare const __BUILD_NUMBER__: string
/** Injected at build time by Vite's `define` — the ISO date the bundle was built. */
declare const __BUILD_DATE__: string
