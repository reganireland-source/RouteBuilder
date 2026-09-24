/**
 * theme.ts — colour theming for the whole frontend.
 *
 * Defines the Theme interface (background layers, borders, text emphasis levels, accent
 * colours, map styling) and three concrete palettes: darkTheme (Catppuccin-Mocha-like,
 * the default), lightTheme (Catppuccin-Latte-like) and duskTheme (dark UI over a light,
 * richly-labeled map). Each theme also carries the Leaflet raster tile URL (mapTileUrl)
 * and its attribution string (mapAttribution), plus an inactive-segment colour for the
 * map. Components read the active theme with the useTheme() hook via ThemeContext;
 * App.tsx provides the chosen theme at the root.
 *
 * Tile source: Esri's public "Community Basemaps" (World_Dark_Gray_Base /
 * World_Light_Gray_Base / World_Street_Map), served from arcgisonline.com — free,
 * keyless raster tiles with English-first place labels everywhere, including China/
 * Japan/Korea (genuine OpenStreetMap tiles render those in the local script only,
 * since OSM has no separate English layer free for third-party use — Wikimedia hosts
 * one, "osm-intl", but restricts it to Wikimedia-affiliated sites only). Esri is not
 * open source, unlike OSM, but was chosen as the simpler fix for readable labels; the
 * alternative (open-source vector tiles with a custom name:en label style) is a much
 * larger change. Previously this used CARTO's basemaps.cartocdn.com tiles, which now
 * require a paid/free-tier API key and otherwise silently serve a "API KEY REQUIRED"
 * watermark tile with an HTTP 200, which is why the map appeared to load but showed
 * nothing usable.
 *
 * The two "Canvas" gray styles (dark/light) ship their geography and their place
 * labels as TWO separate tile layers — the "_Base" tile has no text at all, labels
 * live on a second transparent "_Reference" overlay tile meant to be stacked on top
 * (a common Esri pattern; World_Street_Map is single-layer and already has labels
 * baked in, so it needs no second layer). mapLabelsUrl carries that second URL where
 * one exists; Map.tsx mounts it as a second TileLayer above the base one.
 */
import { createContext, useContext } from 'react'

export interface Theme {
  /** The app's overall background — the outermost layer everything else sits on. */
  bgBase: string
  /** Background for side/bottom panels (sidebar, modals' body) — one layer
   *  above/below bgBase in the visual stack. */
  bgPanel: string
  /** The darkest/recessed layer — headers, wells, anything meant to sit
   *  visually "below" bgBase. */
  bgDeep: string
  /** Default background for a card/list-row component. */
  bgCard: string
  /** bgCard's background when that card/row is the selected one. */
  bgCardSelected: string
  /** Background for an active/chosen control state — a picked sort order, a
   *  toggled-on button, the currently active choice in a segmented control.
   *  Distinct from bgCardSelected (a selected list item). */
  bgActiveSort: string
  /** Background for text inputs and similar editable form fields. */
  bgInput: string
  /** Background shown under the Leaflet map before/while tiles load. */
  bgMap: string
  border: string
  borderSubtle: string
  text: string
  textMuted: string
  /** Tuned to ≥4.5:1 (WCAG AA for normal text) against bgBase/bgPanel/
   *  bgCardSelected in every theme — this is used for real, meant-to-be-read
   *  copy (field labels, hints, secondary metadata) across ~300 call sites,
   *  not a decorative fade. See HazardStatusPanel.tsx's docblock for the
   *  concrete case (an "honesty" caveat) that first found the old value
   *  (down to ~3.2:1 in dark/dusk) illegible on a real screen. Keep future
   *  edits to this token ≥4.5:1; use textFaintest for genuinely non-critical
   *  or disabled-control text instead of dimming this one further. */
  textFaint: string
  /** The one step below textFaint — also ≥4.5:1, not a "safe to fade below
   *  AA" tier. Reserve it for disabled-but-still-nameable controls (see
   *  HazardStatusPanel's SegmentedControl) and the least urgent metadata,
   *  never for content whose whole job is to be read (that's textFaint or
   *  textMuted). */
  textFaintest: string
  blue: string
  green: string
  red: string
  orange: string
  pink: string
  mapInactiveSegment: string
  mapTileUrl: string
  mapLabelsUrl?: string
  mapAttribution: string
  /** Which ThemeMode this literal object represents — lets a consumer that
   *  already has a resolved Theme value branch on which theme it is without
   *  needing a separate reference to the active ThemeMode. */
  themeId: ThemeMode
}

const ESRI_ATTRIBUTION = '&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, &copy; OpenStreetMap contributors, and the GIS User Community'

export type ThemeMode = 'dark' | 'dusk' | 'light'

export const darkTheme: Theme = {
  bgBase:          '#1e1e2e',
  bgPanel:         '#181825',
  bgDeep:          '#11111b',
  bgCard:          '#181825',
  bgCardSelected:  '#1e1e2e',
  bgActiveSort:    '#1e3a5f',
  bgInput:         '#1e1e2e',
  bgMap:           '#0f0f1a',
  border:          '#313244',
  borderSubtle:    '#45475a',
  text:            '#cdd6f4',
  textMuted:       '#a6adc8',
  textFaint:       '#8e92a4',
  textFaintest:    '#82859f',
  blue:            '#89b4fa',
  green:           '#a6e3a1',
  red:             '#f38ba8',
  orange:          '#fab387',
  pink:            '#f5c2e7',
  mapInactiveSegment: '#2a2a3e',
  mapTileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  mapLabelsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  mapAttribution: ESRI_ATTRIBUTION,
  themeId: 'dark',
}

export const lightTheme: Theme = {
  bgBase:          '#eff1f5',
  bgPanel:         '#e6e9ef',
  bgDeep:          '#dce0e8',
  bgCard:          '#e6e9ef',
  bgCardSelected:  '#eff1f5',
  bgActiveSort:    '#c5d0f5',
  bgInput:         '#eff1f5',
  bgMap:           '#e8eaf2',
  border:          '#bcc0cc',
  borderSubtle:    '#ccd0da',
  text:            '#4c4f69',
  textMuted:       '#5c5f77',
  textFaint:       '#616377',
  textFaintest:    '#63687d',
  blue:            '#1e66f5',
  green:           '#40a02b',
  red:             '#d20f39',
  orange:          '#fe640b',
  pink:            '#ea76cb',
  mapInactiveSegment: '#9090b8',
  mapTileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  mapLabelsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  mapAttribution: ESRI_ATTRIBUTION,
  themeId: 'light',
}

export const duskTheme: Theme = {
  bgBase:          '#1c1e30',
  bgPanel:         '#21233a',
  bgDeep:          '#161828',
  bgCard:          '#21233a',
  bgCardSelected:  '#272a42',
  bgActiveSort:    '#1e3a5f',
  bgInput:         '#1c1e30',
  bgMap:           '#e8e4dc',
  border:          '#383c58',
  borderSubtle:    '#4a4f72',
  text:            '#cdd6f4',
  textMuted:       '#a0a8c8',
  textFaint:       '#9a9fae',
  textFaintest:    '#8992ab',
  blue:            '#5b9cf6',
  green:           '#34c77a',
  red:             '#dc2626',
  orange:          '#ea6c00',
  pink:            '#be185d',
  mapInactiveSegment: '#8090aa',
  mapTileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  mapAttribution: ESRI_ATTRIBUTION,
  themeId: 'dusk',
}


/** React context carrying the currently active Theme; App.tsx provides the
 *  chosen theme (dark/light/dusk) at the root, defaulting to darkTheme when
 *  no provider is present. */
export const ThemeContext = createContext<Theme>(darkTheme)
/** Hook for reading the active theme — the standard way components access
 *  colour tokens (e.g. `const t = useTheme()` then `t.bgPanel`). */
export const useTheme = () => useContext(ThemeContext)
