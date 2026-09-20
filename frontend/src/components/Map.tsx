/**
 * ============================================================================
 * components/Map.tsx — The Leaflet world map at the heart of the app
 * ============================================================================
 *
 * Renders every node and cable segment, plus all mode-specific overlays.
 * Mounted by App.tsx (desktop) and MobileLayout.tsx (mobile); it is a pure
 * presentational component — all state lives in the parent and arrives as
 * props.
 *
 * RENDERING PIPELINE (per render):
 *  1. Pacific-centred longitude normalisation. The network is Asia-Pacific
 *     centric, so the map is centred on the Pacific (initial center lng 130,
 *     maxBounds lng -25..345). normalizeLng() shifts any longitude < -30°
 *     (the Americas) by +360° so e.g. Los Angeles (-118°) plots at 242°,
 *     to the RIGHT of Asia. This lets transpacific cables draw as ONE
 *     continuous polyline instead of splitting at the ±180° antimeridian.
 *  2. Segment geometry. geoLines() builds each segment's polyline: if the
 *     segment has `waypoints` (hand-placed ocean routing hints stored on the
 *     CableSegment), the line threads through them and is smoothed with a
 *     Catmull-Rom spline (catmullRom()) so cables look like gentle curves;
 *     otherwise a straight line between the two endpoint nodes is drawn.
 *  3. Segment styling. A precedence ladder decides each segment's colour /
 *     weight / opacity: country-highlight > system-viewer colours > active
 *     search routes (blue; protected pair green) > pinned-route colours >
 *     dim "background network" grey. Terrestrial segments are dashed; a
 *     segment with an active outage on a highlighted route is drawn red
 *     with a distinctive dash pattern. `hideNonActive` removes background
 *     segments entirely; `showAllOutages` switches to an outage-only map.
 *     This entire ladder (and showAllOutages) only ever considers rows
 *     where event_type !== 'planned_event' — i.e. real CURRENT outages —
 *     so a future Planned Event can never make a segment look "down" here.
 *     Planned Events are a wholly separate, additive overlay: when the
 *     independent `showPlannedEvents` toggle is on, segments with an
 *     active/upcoming planned_event row are drawn on top in amber/orange
 *     with their own (more open) dash pattern, regardless of the ladder
 *     above or of showAllOutages, so both overlays can be read together.
 *  4. Node styling. NODE_STYLE defines the visual hierarchy by node type
 *     (CLS largest/orange, then primary/secondary/extension PoPs, tiny
 *     branching units, muted off-net). Nodes on routes/pins are recoloured
 *     pink; system-viewer / country-viewer modes dim unrelated nodes.
 *
 * BASE LAYER: chosen from the `mapsProvider` prop (backend AppConfig
 * .maps_provider), falling back to the VITE_MAPS_PROVIDER env var —
 * 'google' mounts GoogleMutantLayer (Google tiles via leaflet
 * googlemutant, dark-styled to match the theme, loading the Maps JS API
 * on demand); anything else uses the free, keyless Esri raster TileLayer
 * whose URL and attribution come from the active theme (see theme.ts).
 *
 * Also contains small imperative helpers driven through react-leaflet's
 * useMap(): MapResizer (invalidate size when the side panel resizes),
 * MapFlyTo (zoom to a country highlight) and ManualFitBounds (keep the
 * RouteManual step-by-step build in view).
 *
 * The RouteManual overlays (locked path in amber, numbered/coloured
 * next-hop candidate dots, origin picker) render on top when `manualState`
 * is provided.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet.gridlayer.googlemutant'
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap } from 'react-leaflet'
import type { CableNode, CableSegment, CountryHighlight, HazardAssetView, HazardFeed, HazardOwnerView, HazardSeverity, KmlPathInfo, KmlPreviewLine, PinnedRoute, Route, SegmentCapacity, SegmentOutage, SelectedSystem } from '../types'
import { isNodeOnNet, isSegmentOnNet } from '../utils/onNet'
import { useTheme } from '../theme'
import type { ManualState, NextHopCandidate } from './RouteManual'
import { useSegmentHover } from '../context/SegmentHoverContext'
import { normalizeLng, geoLines, NODE_STYLE, NODE_TYPE_LABEL } from '../mapGeometry'
import { EditorMapLayer } from './EditorMapLayer'
import { KmlChopMapLayer, type KmlChopMapLayerProps } from './KmlChopMapLayer'
import { LivingWorldLayer } from './LivingWorldLayer'
import { HazardLayer, severityColor } from './HazardLayer'
import { worstSeverityByAsset } from '../context/HazardContext'
import { HazardStatusPanel } from './HazardStatusPanel'
import { KmlPreviewLayer } from './KmlPreviewLayer'
import type { EditorSubMode, EditorSelection, SegmentDraft } from '../state/editorState'
import { emptySegmentDraft } from '../state/editorState'

// Stable empty-Set fallback for optional Network Editor props, so a missing
// pendingNodeIds prop doesn't create a new Set identity on every render.
const EMPTY_STRING_SET: Set<string> = new Set()

// Same reasoning for the on-net ownership list: it feeds a useMemo dep array,
// so a fresh [] default would invalidate the hazard lens on every render.
const EMPTY_OWNERSHIP: string[] = []

// Stable empty default for the KML path map, for the same reason as the two
// above: it feeds memo dependency lists and render loops.
const EMPTY_KML_PATHS: Record<string, never> = {}

// Stable empty default, same reasoning as the two above.
const EMPTY_PREVIEW: KmlPreviewLine[] = []

/** Stroke width of the invisible click/tap target laid under each cable.
 *  Cables render at 1-3.5px. 14 is about a fingertip at this zoom and still
 *  narrow enough that two parallel cables stay separately selectable. */
const HIT_TARGET_WEIGHT = 14

// Human-readable labels for the Ownership enum, used in segment tooltips.
const OWNERSHIP_LABEL: Record<string, string> = {
  owned:                'Owned',
  consortium:           'Consortium',
  iru:                  'IRU',
  integrated_lit_lease: 'Int. Lit Lease',
  offnet_resell:        'Offnet Resell',
}

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  selectedRoutes: Route[]
  capacity: SegmentCapacity[]
  pinnedRoutes: PinnedRoute[]
  selectedSystems: SelectedSystem[]
  onNodeClick?: (node: CableNode, screenX: number, screenY: number) => void
  /** Click/tap a cable to pin its details. Omitted (e.g. in the Network Editor,
   *  where a segment click means "edit this path") leaves segments
   *  non-clickable and the hover tooltip attached to the visible line. */
  onSegmentClick?: (segment: CableSegment, screenX: number, screenY: number) => void
  /** The segment whose info card is open, drawn emphasised. */
  selectedSegmentId?: string | null
  /** Fly the map to one node. `key` is bumped by the caller on every request so
   *  asking for the SAME node twice still flies (the user typed its code
   *  again); without it the effect would see identical deps and do nothing. */
  flyToNode?: { lat: number; lng: number; key: number }
  /** Fit the map to an arbitrary box — a city's nodes, a segment's path, a
   *  cable system's full extent. Same bumped `key` trick as flyToNode. */
  fitBounds?: { bounds: [[number, number], [number, number]]; key: number }
  /** True while the future-network banner is shown, so the zoom control can
   *  drop below it instead of hiding under it. */
  bannerOffset?: boolean
  /** Node to call out after a search: drawn emphasised with its tooltip pinned
   *  open. Used on mobile, where opening the full node panel would cover the
   *  map and hide the fly-to the user just asked for. */
  spotlightNodeId?: string | null
  /** "Living World" — the 16-bit ocean easter eggs. On by default; see
   *  LivingWorldLayer.tsx. Purely decorative and in its own non-interactive
   *  pane, so it changes nothing about how the map behaves. */
  livingWorld?: boolean
  /** "Network Hazards" — the live disaster overlay. OFF by default; see
   *  HazardLayer.tsx. Absent/undefined means the layer is not mounted at all. */
  hazardFeed?: HazardFeed | null
  hazardsOn?: boolean
  /** How much of our own network to draw while the hazard layer is on. */
  hazardAssetView?: HazardAssetView
  onHazardAssetViewChange?: (next: HazardAssetView) => void
  /** Which in-range assets the lens highlights (on-net only, or everything). */
  hazardOwnerView?: HazardOwnerView
  onHazardOwnerViewChange?: (next: HazardOwnerView) => void
  /** Ownership types that count as on-net, from AppConfig.on_net_ownership. */
  onNetOwnership?: string[]
  /** The top-right Controls menu is open; the hazard panel moves out of its way. */
  controlsOpen?: boolean
  /** Cable route geometry on file — uploaded or synced from
   *  submarinecablemap.com, see KmlPathInfo.source — keyed by segment id. */
  kmlPaths?: Record<string, KmlPathInfo>
  /** Draw routes on file where we have them, and mark which cables are which. */
  kmlMode?: boolean
  /** An import being reviewed, drawn over the network so the cuts can be
   *  checked against it. Transient — never stored, cleared when review ends. */
  kmlPreview?: KmlPreviewLine[]
  /** Bumped per preview request so re-previewing the same path still re-fits. */
  kmlPreviewKey?: number
  hazardsLoading?: boolean
  hazardsError?: string | null
  onRefreshHazards?: () => void
  searchPin?: { lat: number; lng: number; label: string }
  nearestNodeIds?: string[]
  hideNonActive?: boolean
  showSegmentLabels?: boolean
  showNodeLabels?: boolean
  showAllOutages?: boolean
  showPlannedEvents?: boolean
  outages?: SegmentOutage[]
  countryHighlight?: CountryHighlight | null
  subseaOnly?: boolean
  backhaulOnly?: boolean
  panelWidth?: number
  // RouteManual
  manualState?: ManualState | null
  manualCandidates?: NextHopCandidate[]
  onManualNodeClick?: (node: CableNode) => void
  manualMobileMode?: boolean   // enlarge candidate circles for touch
  mapsProvider?: 'osm' | 'google'
  // Network Editor — see EditorMapLayer.tsx. `nodes`/`segments`/`capacity` above
  // already carry the derived (base + staged edits) arrays when this is active,
  // so only the interaction-mode/selection state is needed here.
  editorMode?: boolean
  editorSubMode?: EditorSubMode
  editorSelection?: EditorSelection
  editorSegmentDraft?: SegmentDraft
  pendingNodeIds?: Set<string>
  pendingSegmentIds?: Set<string>
  onEditorNodeDragEnd?: (nodeId: string, lat: number, lng: number, fromLat: number, fromLng: number) => void
  onEditorNodeSelect?: (nodeId: string) => void
  onEditorSegmentSelect?: (segmentId: string) => void
  onEditorWaypointInsert?: (segmentId: string, insertIndex: number, lat: number, lng: number) => void
  onEditorWaypointDragEnd?: (segmentId: string, index: number, lat: number, lng: number) => void
  onEditorWaypointDelete?: (segmentId: string, index: number) => void
  onEditorPickEndpoint?: (nodeId: string) => void
  onEditorPickEmptySpace?: (lat: number, lng: number) => void
  /** Whatever KmlChopImport.tsx's chop session currently needs drawn — the
   *  whole KmlChopMapLayer prop set in one object, or null when no chop
   *  session is open. See KmlChopMapLayer.tsx and KmlChopImport.tsx's own
   *  module docstring for why this is a single bundled prop rather than the
   *  ~15 separate ones Network Editor's own interactivity needed: this mode
   *  has no node/segment CRUD of its own to thread through, only chains and
   *  cuts that one component already owns end to end. */
  kmlChop?: KmlChopMapLayerProps | null
}


function MapResizer({ panelWidth }: { panelWidth?: number }) {
  const map = useMap()
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 310)
    return () => clearTimeout(timer)
  }, [panelWidth, map])
  return null
}

function ManualFitBounds({ manualState, manualCandidates, nodes }: {
  manualState: ManualState | null | undefined
  manualCandidates: NextHopCandidate[]
  nodes: CableNode[]
}) {
  const map = useMap()
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))

  useEffect(() => {
    if (!manualState) return

    const pts: [number, number][] = []

    // Origin + all stepped nodes
    const allNodeIds = [manualState.originId, ...manualState.steps.map(s => s.nodeId)]
    for (const id of allNodeIds) {
      const n = nodesById[id]
      if (n) pts.push([n.lat, normalizeLng(n.lng)])
    }

    // All candidate nodes
    for (const c of manualCandidates) {
      const n = nodesById[c.node.id]
      if (n) pts.push([n.lat, normalizeLng(n.lng)])
    }

    if (pts.length < 1) return

    const lats = pts.map(p => p[0])
    const lngs = pts.map(p => p[1])
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)

    map.fitBounds([[minLat, minLng], [maxLat, maxLng]], {
      padding: [60, 60], animate: true,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    manualState?.originId,
    manualState?.steps.length,
    manualCandidates.length,
    map,
  ])

  return null
}

/** Fly to a single node — used when someone looks a node up by its 4-alpha
 *  code in Network Explorer. Longitude goes through normalizeLng for the same
 *  reason every drawn coordinate does: this map is Pacific-centred, and a raw
 *  American longitude would fly the long way round the world. */
function MapFlyToNode({ target }: { target: { lat: number; lng: number; key: number } | undefined }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, normalizeLng(target.lng)], 8, { duration: 1.2 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.key, map])
  return null
}

/**
 * True on phone-width viewports. The legend is the only thing in this file that
 * cares: stacked vertically it is ~140px tall, which the mobile bottom sheet
 * sits on top of. A media query rather than a prop because the map is rendered
 * from two different layouts and a narrow desktop window has the same problem.
 */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 640,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const onChange = () => setNarrow(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

/** Fit an arbitrary box, for Asset Search results that are not a single point
 *  (a city's nodes, a segment's path, a whole cable system). The caller is
 *  responsible for having normalised the longitudes — see normalizeLng. */
function MapFitBounds({ target }: { target: { bounds: [[number, number], [number, number]]; key: number } | undefined }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.fitBounds(target.bounds, { padding: [70, 70], maxZoom: 9, animate: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.key, map])
  return null
}

function MapFlyTo({ highlight }: { highlight: CountryHighlight | null | undefined }) {
  const map = useMap()
  useEffect(() => {
    if (!highlight) return
    const [[minLat, minLng], [maxLat, maxLng]] = highlight.boundsLL
    const latSpan = maxLat - minLat
    const lngSpan = maxLng - minLng
    if (latSpan < 0.5 && lngSpan < 0.5) {
      map.flyTo([highlight.centroid[0], highlight.centroid[1]], 8, { duration: 1.2 })
    } else {
      map.fitBounds([[minLat, minLng], [maxLat, maxLng]], {
        padding: [80, 80], maxZoom: 7, animate: true,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight?.countryCode, map])
  return null
}


/** Each next-hop candidate gets a unique colour by index — same index used in both map dots and list cards */
const CANDIDATE_PALETTE = [
  '#4ade80',  // green
  '#60a5fa',  // blue
  '#f59e0b',  // amber
  '#a78bfa',  // purple
  '#fb923c',  // orange
  '#34d399',  // teal
  '#f472b6',  // pink
  '#facc15',  // yellow
]

export function candidateColor(index: number): string {
  return CANDIDATE_PALETTE[index % CANDIDATE_PALETTE.length]
}

// Google Maps dark-mode styles (close to the dark CARTO palette)
const GOOGLE_DARK_STYLES = [
  { elementType: 'geometry',                                    stylers: [{ color: '#0f0f1a' }] },
  { elementType: 'labels.text.fill',                            stylers: [{ color: '#6c6e80' }] },
  { elementType: 'labels.text.stroke',                          stylers: [{ color: '#0f0f1a' }] },
  { featureType: 'water',        elementType: 'geometry',       stylers: [{ color: '#090910' }] },
  { featureType: 'water',        elementType: 'labels.text.fill', stylers: [{ color: '#3d4054' }] },
  { featureType: 'landscape',    elementType: 'geometry',       stylers: [{ color: '#1a1a28' }] },
  { featureType: 'road',         elementType: 'geometry',       stylers: [{ color: '#2a2a40' }] },
  { featureType: 'road.highway', elementType: 'geometry',       stylers: [{ color: '#232340' }] },
  { featureType: 'poi',          elementType: 'geometry',       stylers: [{ color: '#1a1a28' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2d2d4a' }] },
  { featureType: 'transit',      elementType: 'geometry',       stylers: [{ color: '#1a1a28' }] },
]

function GoogleMutantLayer({ themeId }: { themeId: string }) {
  const map = useMap()
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GMAPS_API_KEY
    if (!apiKey) return

    let mounted = true
    let layer: L.Layer | null = null

    const createLayer = () => {
      if (!mounted) return
      const factory = (L.gridLayer as unknown as Record<string, (...a: unknown[]) => L.Layer>).googleMutant
      if (!factory) return
      layer = factory({
        type: 'roadmap',
        styles: themeId !== 'light' ? GOOGLE_DARK_STYLES : [],
      })
      map.addLayer(layer)
    }

    const win = window as Window & { google?: { maps?: unknown } }
    const scriptId = 'gmaps-js-api'

    if (win.google?.maps) {
      createLayer()
    } else {
      let script = document.getElementById(scriptId) as HTMLScriptElement | null
      if (!script) {
        script = document.createElement('script')
        script.id = scriptId
        script.async = true
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`
        document.head.appendChild(script)
      }
      script.addEventListener('load', createLayer)
    }

    return () => {
      mounted = false
      if (layer) map.removeLayer(layer)
    }
  }, [map, themeId])
  return null
}


/**
 * Format an ISO date string for the Planned Events tooltip window, e.g.
 * "2026-08-12" → "12 Aug 2026". Falls back to the raw string if it doesn't
 * parse as a date (defensive — planned dates are free-text until saved).
 */
function formatPlannedDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Node-type key. Stacked in the bottom-left on a desktop; on a phone it becomes
 * a short horizontal strip below the header instead, because the bottom sheet
 * is anchored to the foot of the screen at every snap position and would cover
 * it there however thin it was. Its own component so the map's render does not
 * carry the layout branch.
 */
function NodeTypeLegend({ narrow }: { narrow: boolean }) {
  const rows: [string, string][] = narrow
    ? [
        ['landing_station', 'CLS'], ['primary_pop', '1\u00b0 PoP'],
        ['secondary_pop', '2\u00b0 PoP'], ['extension_pop', 'Ext'],
        ['branching_unit', 'BU'], ['off_net', 'Off-Net'],
      ]
    : [
        ['landing_station', 'CLS'], ['primary_pop', 'Primary PoP'],
        ['secondary_pop', 'Secondary PoP'], ['extension_pop', 'Extension PoP'],
        ['branching_unit', 'Branching Unit'], ['off_net', 'Off-Net Node'],
      ]

  return (
    <div style={{
      position: 'absolute', zIndex: 1000,
      // 62px clears the header row (logo, search and Controls all end by 57px);
      // left:52 clears Leaflet's own zoom control in the map's top-left corner.
      ...(narrow ? { top: 62, left: 52, right: 8 } : { bottom: 28, left: 8 }),
      background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(4px)',
      border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7,
      padding: narrow ? '5px 8px' : '7px 10px',
      display: 'flex',
      flexDirection: narrow ? 'row' : 'column',
      flexWrap: narrow ? 'wrap' : 'nowrap',
      justifyContent: narrow ? 'center' : undefined,
      columnGap: narrow ? 11 : 0, rowGap: 4,
      pointerEvents: 'none', userSelect: 'none',
    }}>
      {rows.map(([type, label]) => {
        const ns = NODE_STYLE[type]
        const sz = Math.round(ns.radius * 1.5)
        return (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: narrow ? 5 : 7 }}>
            <div style={{
              width: sz, height: sz, borderRadius: '50%', flexShrink: 0,
              background: ns.fill, border: `${ns.weight}px solid ${ns.color}`,
              opacity: ns.opacity,
            }} />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.82)', whiteSpace: 'nowrap', fontFamily: 'system-ui, sans-serif' }}>{label}</span>
          </div>
        )
      })}
    </div>
  )
}

// Named NetworkMap (not "Map") so it doesn't shadow the built-in JS Map type
// within this file or anywhere it's imported — see SONARQUBE_PEDANTIC_REPORT.md
// (typescript:S2424 / S2137).
export function NetworkMap({ nodes, segments, selectedRoutes, capacity, pinnedRoutes, selectedSystems, onNodeClick, onSegmentClick, selectedSegmentId = null, flyToNode, fitBounds, spotlightNodeId, livingWorld = true, hazardFeed, hazardsOn = false, hazardAssetView = 'inRange', onHazardAssetViewChange, hazardOwnerView = 'onNet', onHazardOwnerViewChange, onNetOwnership = EMPTY_OWNERSHIP, controlsOpen = false, kmlPaths = EMPTY_KML_PATHS, kmlMode = false, kmlPreview = EMPTY_PREVIEW, kmlPreviewKey = 0, hazardsLoading = false, hazardsError = null, onRefreshHazards, bannerOffset = false, searchPin, nearestNodeIds, hideNonActive = false, showSegmentLabels = false, showNodeLabels = false, showAllOutages = false, showPlannedEvents = false, outages = [], countryHighlight, subseaOnly = false, backhaulOnly = false, panelWidth, manualState, manualCandidates = [], onManualNodeClick, manualMobileMode = false, mapsProvider, editorMode = false, editorSubMode = 'move', editorSelection = null, editorSegmentDraft, pendingNodeIds, pendingSegmentIds, onEditorNodeDragEnd, onEditorNodeSelect, onEditorSegmentSelect, onEditorWaypointInsert, onEditorWaypointDragEnd, onEditorWaypointDelete, onEditorPickEndpoint, onEditorPickEmptySpace, kmlChop = null }: Props) {
  const t = useTheme()
  const narrowViewport = useNarrowViewport()
  const { hoveredSegmentId } = useSegmentHover()
  /**
   * Worst hazard severity touching each of our assets, and whether that lens is
   * active at all. Only computed while the layer is on AND the view is
   * "in range" — when it is off or set to "all" this is an empty map and every
   * lookup below falls straight through to the normal styling.
   */
  const hazardLens = hazardsOn && hazardAssetView === 'inRange'
  const hazardSeverityByAsset = useMemo(
    () => {
      if (!hazardLens || !hazardFeed) return new Map<string, HazardSeverity>()
      const worst = worstSeverityByAsset(hazardFeed.hazards)
      if (hazardOwnerView === 'all') return worst
      // On-net only: drop the off-net assets from the highlight set. Doing it
      // HERE rather than in the two styling blocks below means an off-net asset
      // simply looks like one that is out of range — it fades back with
      // everything else instead of vanishing, so the network around a hazard
      // stays readable as context.
      const onNetSet = new Set(onNetOwnership)
      const filtered = new Map<string, HazardSeverity>()
      for (const node of nodes) {
        const sev = worst.get(node.id)
        if (sev !== undefined && isNodeOnNet(node)) filtered.set(node.id, sev)
      }
      for (const seg of segments) {
        const sev = worst.get(seg.id)
        if (sev !== undefined && isSegmentOnNet(seg, onNetSet)) filtered.set(seg.id, sev)
      }
      return filtered
    },
    [hazardLens, hazardFeed, hazardOwnerView, nodes, segments, onNetOwnership],
  )
  /** True while the network should not be drawn at all. */
  const hideAllAssets = hazardsOn && hazardAssetView === 'none'

  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const capacityById = Object.fromEntries(capacity.map(c => [c.segment_id, c]))

  // Real CURRENT outages only — a Planned Event (event_type === 'planned_event')
  // must NEVER feed the "down" styling ladder below or the showAllOutages map.
  // Legacy rows with no event_type stored default to 'outage'.
  const realOutages = outages.filter(o => (o.event_type ?? 'outage') !== 'planned_event')
  // Planned Events only — the separate, additive overlay driven by showPlannedEvents.
  const plannedEvents = outages.filter(o => o.event_type === 'planned_event')

  // segment_id → all faults on that segment (a segment can have multiple active faults)
  const outagesBySegId = realOutages.reduce<Record<string, typeof realOutages>>((acc, o) => {
    ;(acc[o.segment_id] ??= []).push(o)
    return acc
  }, {})
  const outageSegIds = new Set(realOutages.map(o => o.segment_id))

  // segment_id → all planned events on that segment, mirroring outagesBySegId above.
  const plannedBySegId = plannedEvents.reduce<Record<string, typeof plannedEvents>>((acc, o) => {
    ;(acc[o.segment_id] ??= []).push(o)
    return acc
  }, {})

  // In outage-map mode, collect nodes that belong to downed (real-outage) segments
  const outageNodeIds = showAllOutages
    ? new Set(realOutages.flatMap(o => {
        const seg = segments.find(s => s.id === o.segment_id)
        return seg ? [seg.start_node_id, seg.end_node_id] : []
      }))
    : null

  // Mirrors outageNodeIds above, but for the independent Planned Events overlay:
  // nodes touching a segment with an active/upcoming planned event get highlighted
  // whenever showPlannedEvents is on (additive — it never hides other nodes).
  const plannedNodeIds = showPlannedEvents
    ? new Set(plannedEvents.flatMap(o => {
        const seg = segments.find(s => s.id === o.segment_id)
        return seg ? [seg.start_node_id, seg.end_node_id] : []
      }))
    : null

  // ── RouteManual derived state ──────────────────────────────────────────────
  const manualActive   = !!manualState
  const segmentsById   = Object.fromEntries(segments.map(s => [s.id, s]))

  const systemViewerActive = selectedSystems.length > 0
  const systemColorMap: Record<string, string> = Object.fromEntries(
    selectedSystems.map(s => [s.systemId, s.color])
  )

  // Country viewer: node IDs for all endpoints of highlighted segments (includes BUs)
  const countryActive = !!countryHighlight
  const countryEndpointIds = new Set<string>()
  if (countryHighlight) {
    for (const seg of segments) {
      if (countryHighlight.systemColors.has(seg.system_id) ||
          countryHighlight.terrestrialSegIds.has(seg.id)) {
        countryEndpointIds.add(seg.start_node_id)
        countryEndpointIds.add(seg.end_node_id)
      }
    }
  }

  // Segment highlight: pinned first, active search on top
  const segmentColor: Record<string, string> = {}
  const segmentWeight: Record<string, number> = {}
  const segmentOpacity: Record<string, number> = {}

  for (const p of pinnedRoutes) {
    for (const s of p.route.segments) {
      segmentColor[s.segment_id] = p.color
      segmentWeight[s.segment_id] = 2
      segmentOpacity[s.segment_id] = 0.8
    }
  }
  // Every segment of a route the user has clicked/selected also gets an
  // "illuminated" glow halo underneath it (see the .rb-route-glow render
  // below) — the ordinary color/weight/opacity bump above makes the line
  // itself stand out; this makes the whole selected route visibly light up
  // on the map rather than just look slightly thicker.
  const selectedGlowColor: Record<string, string> = {}
  for (const r of selectedRoutes) {
    const color = r.id.startsWith('protected-') ? t.green : t.blue
    for (const s of r.segments) {
      segmentColor[s.segment_id] = color
      segmentWeight[s.segment_id] = 3
      segmentOpacity[s.segment_id] = 0.9
      selectedGlowColor[s.segment_id] = color
    }
  }

  // Nodes for routes/pins
  const routeNodeIds = new Set([
    ...selectedRoutes.flatMap(r => r.nodes),
    ...pinnedRoutes.flatMap(p => p.route.nodes),
  ])

  // Nodes for selected systems (systemId -> color for first matching system)
  const systemNodeColor: Record<string, string> = {}
  if (systemViewerActive) {
    for (const seg of segments) {
      const color = systemColorMap[seg.system_id]
      if (color) {
        if (!systemNodeColor[seg.start_node_id]) systemNodeColor[seg.start_node_id] = color
        if (!systemNodeColor[seg.end_node_id]) systemNodeColor[seg.end_node_id] = color
      }
    }
  }

  return (
    <div
      className={bannerOffset ? 'rb-banner-offset' : undefined}
      style={{ position: 'relative', height: '100%', width: '100%' }}
    >
    {/* Pulsing glow keyframes for the hovered-segment highlight below. A plain
        <style> tag (not an external stylesheet) so the animation stays inline
        with the rest of the bundle — see main.tsx's note on not fetching CSS
        from a CDN. */}
    <style>{`
      @keyframes rb-route-glow-pulse {
        0%, 100% { opacity: 0.08; stroke-width: 6;  }
        50%      { opacity: 0.95; stroke-width: 28; }
      }
      .rb-route-glow {
        animation: rb-route-glow-pulse 1s ease-in-out infinite;
        filter: blur(2px);
      }
      /* Clicking an SVG path focuses it, and the browser's default focus ring is
         a rectangle around the element's BOUNDING BOX — for a diagonal cable
         that is a huge box spanning from one landing station to the other. It
         looked like the map was drawing a stray rectangle. Suppressed for
         pointer focus only: :focus-visible still draws a ring for keyboard Tab
         users, who otherwise have no way to see which segment they are on. */
      .leaflet-interactive:focus { outline: none; }
      .leaflet-interactive:focus-visible {
        outline: 2px solid #38bdf8;
        outline-offset: 2px;
      }
      @keyframes rb-segment-glow-pulse {
        0%, 100% { opacity: 0.15; stroke-width: 8;  }
        50%      { opacity: 1;    stroke-width: 32; }
      }
      .rb-segment-glow {
        animation: rb-segment-glow-pulse 1.4s ease-in-out infinite;
        filter: blur(2px);
      }
      /* The future-network banner occupies the top of the map when a planned
         date is active, so the zoom control drops below it. */
      .rb-banner-offset .leaflet-top.leaflet-left .leaflet-control-zoom { margin-top: 44px; }
      /* On a phone the app's logo card floats over the map's top-left corner,
         which is exactly where Leaflet puts its zoom control — they overlapped,
         and a tap on "+" landed on the logo (opening the guide) rather than
         zooming. Push the control below the logo card, which ends at 53px. The
         legend strip alongside it starts at left:52, so the two do not meet. */
      @media (max-width: 640px) {
        .leaflet-top.leaflet-left .leaflet-control-zoom { margin-top: 60px; }
      }
    `}</style>
    <NodeTypeLegend narrow={narrowViewport} />
    {hazardsOn && !editorMode && (
      <HazardStatusPanel
        feed={hazardFeed ?? null}
        loading={hazardsLoading}
        error={hazardsError}
        onRefresh={onRefreshHazards ?? (() => {})}
        assetView={hazardAssetView}
        onAssetViewChange={onHazardAssetViewChange ?? (() => {})}
        ownerView={hazardOwnerView}
        onOwnerViewChange={onHazardOwnerViewChange ?? (() => {})}
        narrow={narrowViewport}
        controlsOpen={controlsOpen}
      />
    )}
    <MapContainer
      center={[10, 130]}
      zoom={3}
      style={{ height: '100%', width: '100%', background: t.bgMap }}
      minZoom={2}
      maxZoom={18}
      worldCopyJump={false}
      maxBounds={[[-75, -25], [80, 345]]}
      maxBoundsViscosity={1.0}
    >
      {(mapsProvider === 'google' || (!mapsProvider && import.meta.env.VITE_MAPS_PROVIDER === 'google'))
        ? <GoogleMutantLayer themeId={t.themeId} />
        : <>
            <TileLayer
              key={t.mapTileUrl}
              url={t.mapTileUrl}
              attribution={t.mapAttribution}
              noWrap={false}
            />
            {/* Esri's gray-canvas styles ship geography and place labels as two
                separate tile sets (see theme.ts) — this is the transparent
                labels overlay, stacked on top so text renders over the base. */}
            {t.mapLabelsUrl && (
              <TileLayer key={t.mapLabelsUrl} url={t.mapLabelsUrl} noWrap={false} />
            )}
          </>
      }

      <MapResizer panelWidth={panelWidth} />
      <MapFlyTo highlight={countryHighlight} />
      <MapFlyToNode target={flyToNode} />
      <MapFitBounds target={fitBounds} />
      <ManualFitBounds manualState={manualState} manualCandidates={manualCandidates} nodes={nodes} />

      {/*
        Selected-route glow — drawn first (so it sits under every segment line
        rendered below, neon-tube style) for every segment belonging to a route
        the user has clicked/selected, in that route's own colour. Purely
        additive: the ordinary segment styling on top is unchanged, this just
        makes the whole route visibly light up rather than only look thicker.
      */}
      {Object.keys(selectedGlowColor).length > 0 && segments.flatMap(seg => {
        const glowColor = selectedGlowColor[seg.id]
        if (!glowColor) return []
        const start = nodesById[seg.start_node_id]
        const end = nodesById[seg.end_node_id]
        if (!start || !end) return []
        const lines = geoLines(start.lat, start.lng, end.lat, end.lng, seg.waypoints ?? undefined)
        return lines.map((positions, i) => (
          <Polyline
            key={`route-glow-${seg.id}-${i}`}
            positions={positions}
            pathOptions={{ color: glowColor, weight: 9, opacity: 0.4, className: 'rb-route-glow', lineCap: 'round' }}
            interactive={false}
          />
        ))
      })}

      {segments.flatMap(seg => {
        const start = nodesById[seg.start_node_id]
        const end = nodesById[seg.end_node_id]
        if (!start || !end) return []

        const isDown = outageSegIds.has(seg.id)
        // Surveyed route when we have one and the mode is on; otherwise the
        // waypoint spline exactly as before.
        const kml = kmlMode ? kmlPaths[seg.id] : undefined
        const lines = geoLines(
          start.lat, start.lng, end.lat, end.lng,
          seg.waypoints ?? undefined,
          kml?.display_path,
        )

        const tooltip = (
          <Tooltip sticky>
            <strong>{seg.name}</strong>
            <br />{seg.system_id} · {seg.type} · {OWNERSHIP_LABEL[seg.ownership] ?? seg.ownership}
            <br />{start.name} → {end.name}
            <br />{seg.length_km.toLocaleString()} km · {seg.latency} ms · Cost: {seg.cost_weight}
            {kmlMode && (
              <><br /><span style={{ fontWeight: 700 }}>
                {kmlPaths[seg.id]
                  ? `Surveyed route · ${kmlPaths[seg.id].point_count.toLocaleString()} pts`
                  : 'Approximate (waypoints)'}
              </span></>
            )}
            {capacityById[seg.id] && (() => {
              const cap = capacityById[seg.id]
              const pct = Math.round((cap.available_capacity_t / cap.total_capacity_t) * 100)
              return <><br />Capacity: {cap.available_capacity_t}T / {cap.total_capacity_t}T available ({pct}%)</>
            })()}
          </Tooltip>
        )

        // Outage map mode: only show downed segments
        if (showAllOutages) {
          if (!isDown) return []
          const segFaults = outagesBySegId[seg.id] ?? []
          const outageTooltip = (
            <Tooltip sticky className="outage-tooltip">
              <strong>{seg.name}</strong>
              <br />{start.name} → {end.name} · {seg.length_km.toLocaleString()} km
              {segFaults.map(f => (
                <span key={f.fault_id}>
                  <br /><strong style={{ color: '#ef4444' }}>{f.fault_id}</strong> · {f.fault_date}
                  {f.repair_start && <> · repair {f.repair_start}</>}
                  <br /><span style={{ fontSize: 11 }}>{f.description}</span>
                </span>
              ))}
            </Tooltip>
          )
          const pathOptions = {
            color: '#ef4444', weight: 2.5, opacity: 0.95, dashArray: '6 3 2 3',
          }
          return lines.map((positions, i) => (
            <Polyline key={`${seg.id}-${i}`} positions={positions} pathOptions={pathOptions}>
              {i === 0 && outageTooltip}
              {i === 0 && showSegmentLabels && (
                <Tooltip permanent direction="center" className="seg-label" offset={[0, 0]}>{seg.id}</Tooltip>
              )}
            </Polyline>
          ))
        }

        const isSubseaHighlight = countryActive && countryHighlight!.systemColors.has(seg.system_id) && !backhaulOnly
        const isTerrestrialHighlight = countryActive && countryHighlight!.terrestrialSegIds.has(seg.id) && !subseaOnly
        const isCountryHighlightedSeg = isSubseaHighlight || isTerrestrialHighlight
        const isActiveSegment = !!segmentColor[seg.id] ||
          !!(systemViewerActive && systemColorMap[seg.system_id]) ||
          isCountryHighlightedSeg
        if (hideAllAssets) return []
        if (hideNonActive && !isActiveSegment) return []

        let color: string
        let weight: number
        let opacity: number

        if (countryActive) {
          if (isSubseaHighlight) {
            color = countryHighlight!.systemColors.get(seg.system_id)!; weight = 3.5; opacity = 0.95
          } else if (isTerrestrialHighlight) {
            color = '#0e7490'; weight = 2.5; opacity = 0.95
          } else if (segmentColor[seg.id]) {
            color = segmentColor[seg.id]; weight = segmentWeight[seg.id] ?? 2; opacity = 0.55
          } else {
            color = t.mapInactiveSegment; weight = 1; opacity = 0.04
          }
        } else if (systemViewerActive && systemColorMap[seg.system_id]) {
          color  = systemColorMap[seg.system_id]
          weight = 3
          opacity = 0.9
        } else if (systemViewerActive) {
          color   = segmentColor[seg.id] ?? t.mapInactiveSegment
          weight  = segmentWeight[seg.id] ?? 1
          opacity = segmentOpacity[seg.id] ?? 0.08
        } else {
          color   = segmentColor[seg.id] ?? t.mapInactiveSegment
          weight  = segmentWeight[seg.id] ?? 1
          opacity = segmentOpacity[seg.id] ?? 0.35
        }

        // Only highlight as downed when segment is on an active route/pin
        const showAsDown = isDown && isActiveSegment
        let pathOptions = {
          color:     showAsDown ? '#ef4444' : color,
          weight:    showAsDown ? 2.5 : weight,
          opacity:   showAsDown ? 0.95 : opacity,
          dashArray: showAsDown ? '6 3 2 3' : seg.type === 'terrestrial' ? '6 4' : undefined,
        }

        // ── Hazard lens ──
        // Applied AFTER the ladder above rather than as another branch inside
        // it, so the country/system/route precedence it encodes is untouched
        // and this can be removed without unpicking any of it.
        const segHazard = hazardSeverityByAsset.get(seg.id)
        if (hazardLens) {
          pathOptions = segHazard
            ? { ...pathOptions, color: severityColor(segHazard, t), weight: Math.max(pathOptions.weight, 3.5), opacity: 0.95 }
            : { ...pathOptions, opacity: Math.min(pathOptions.opacity, 0.07) }
        }

        // ── KML Mode ── a surveyed route and a smoothed guess must not look
        // identical, or the map quietly presents an approximation as truth.
        //
        // EMPHASISE THE SURVEYED FEW RATHER THAN SUPPRESS THE UNSURVEYED MANY.
        // The first version did the opposite — faded every cable without a KML,
        // borrowing the hazard lens idiom — and at the coverage this feature
        // actually starts from it made the map look broken: with one segment
        // uploaded, 321 of 322 cables dropped to near-invisible and the default
        // view of the app was an empty ocean. Suppression only reads as "these
        // ones, not those" when the two groups are comparable; emphasis reads
        // correctly at every ratio, from 1/322 to 322/322.
        //
        // Weight rather than colour, because colour is already carrying route,
        // system, country and outage state, and dash patterns are taken by
        // terrestrial/outage/planned. The tooltip states it in words either way.
        if (kmlMode && kml) {
          pathOptions = {
            ...pathOptions,
            weight: pathOptions.weight + 0.8,
            opacity: Math.max(pathOptions.opacity, 0.85),
          }
        }

        // ── Selection ── the card names one cable; this is what says WHICH.
        // Applied last so it wins over the whole ladder above: if you clicked
        // it, you want to see it, whatever mode the map is in.
        if (seg.id === selectedSegmentId) {
          pathOptions = {
            ...pathOptions,
            color: t.blue,
            weight: Math.max(pathOptions.weight, 4),
            opacity: 1,
          }
        }

        const onSegClick = onSegmentClick
          ? (e: L.LeafletMouseEvent) => {
              e.originalEvent.stopPropagation()
              onSegmentClick(seg, e.originalEvent.clientX, e.originalEvent.clientY)
            }
          : undefined

        return lines.map((positions, i) => (
          <Fragment key={`${seg.id}-${i}`}>
            {/* Invisible fat line under the real one, purely to be clicked.
                A cable is drawn 1-3.5px wide, which is a hard target with a
                mouse and an unusable one with a fingertip. This carries the
                click; the visible line below is left non-interactive for
                pointers so the two can never fight over the same event. */}
            {onSegClick && (
              <Polyline
                positions={positions}
                pathOptions={{ color: '#000', weight: HIT_TARGET_WEIGHT, opacity: 0, lineCap: 'round' }}
                eventHandlers={{ click: onSegClick }}
              >
                {i === 0 && tooltip}
              </Polyline>
            )}
            <Polyline
              positions={positions}
              pathOptions={pathOptions}
              interactive={!onSegClick}
            >
              {i === 0 && !onSegClick && tooltip}
              {i === 0 && showSegmentLabels && isActiveSegment && (
                <Tooltip permanent direction="center" className="seg-label" offset={[0, 0]}>
                  {seg.id}
                </Tooltip>
              )}
            </Polyline>
          </Fragment>
        ))
      })}

      {/*
        Planned Events overlay — wholly additive and independent of the
        precedence ladder / showAllOutages above (see the header comment).
        Drawn on top so it stays visible whether or not a real outage is also
        highlighted on the same segment; its dash pattern ('10 6', long/open)
        is deliberately distinct from the outage dash ('6 3 2 3') so the two
        never get confused when both toggles are on at once.
      */}
      {showPlannedEvents && segments.flatMap(seg => {
        const start = nodesById[seg.start_node_id]
        const end = nodesById[seg.end_node_id]
        if (!start || !end) return []
        const segEvents = plannedBySegId[seg.id]
        if (!segEvents || segEvents.length === 0) return []

        const lines = geoLines(start.lat, start.lng, end.lat, end.lng, seg.waypoints ?? undefined)
        const plannedTooltip = (
          <Tooltip sticky className="planned-event-tooltip">
            <strong>{seg.name}</strong>
            <br />{start.name} → {end.name} · {seg.length_km.toLocaleString()} km
            {segEvents.map(f => (
              <span key={f.fault_id}>
                <br /><strong style={{ color: t.orange }}>{f.fault_id}</strong> · logged {f.fault_date}
                {f.planned_start && f.planned_end && (
                  <><br />Planned: {formatPlannedDate(f.planned_start)} – {formatPlannedDate(f.planned_end)}</>
                )}
                <br /><span style={{ fontSize: 11 }}>{f.description}</span>
              </span>
            ))}
          </Tooltip>
        )
        const pathOptions = {
          color: t.orange, weight: 2.5, opacity: 0.9, dashArray: '10 6',
        }
        return lines.map((positions, i) => (
          <Polyline key={`planned-${seg.id}-${i}`} positions={positions} pathOptions={pathOptions}>
            {i === 0 && plannedTooltip}
          </Polyline>
        ))
      })}

      {nodes.map(node => {
        const isRouteNode   = routeNodeIds.has(node.id)
        const sysColor      = systemNodeColor[node.id]
        const isSystemNode  = !!sysColor
        const isDimmed      = systemViewerActive && !isSystemNode && !isRouteNode
        const isCountryNode = countryActive && (countryHighlight!.nodeIds.has(node.id) || countryEndpointIds.has(node.id))

        if (hideAllAssets) return null
        // Outage map mode: only show nodes on downed segments
        if (showAllOutages) {
          if (!outageNodeIds?.has(node.id)) return null
        } else if (hideNonActive && !isRouteNode && !isSystemNode) return null
        const ns            = NODE_STYLE[node.type] ?? NODE_STYLE.extension_pop
        const isBU          = node.type === 'branching_unit'
        const isSpotlit     = spotlightNodeId === node.id
        const isNearest     = isSpotlit || (nearestNodeIds?.includes(node.id) ?? false)

        let color: string, fillColor: string, radius: number, weight: number
        let fillOpacity: number, nodeOpacity: number

        if (countryActive) {
          if (isCountryNode) {
            color = ns.color; fillColor = ns.fill; radius = ns.radius; weight = ns.weight
            fillOpacity = ns.opacity; nodeOpacity = 1
          } else {
            color = t.borderSubtle; fillColor = t.border
            radius = ns.radius; weight = 1
            fillOpacity = 0.06; nodeOpacity = 0.06
          }
        } else {
          color     = isNearest ? '#f9a825' : isRouteNode ? t.pink : isSystemNode ? sysColor : ns.color
          fillColor = isNearest ? '#ffd54f' : isRouteNode ? t.pink : isSystemNode ? sysColor : ns.fill
          radius    = isNearest ? Math.max(ns.radius + 2, 8) : isRouteNode || isSystemNode ? Math.max(ns.radius, 5) : ns.radius
          weight    = isNearest ? 2.5 : isRouteNode || isSystemNode ? Math.max(ns.weight, 2) : ns.weight
          fillOpacity = isDimmed ? 0.12 : ns.opacity
          nodeOpacity = isDimmed ? 0.12 : ns.opacity
        }

        // ── Hazard lens ── see the matching block in the segment loop.
        const nodeHazard = hazardSeverityByAsset.get(node.id)
        if (hazardLens) {
          if (nodeHazard) {
            const hz = severityColor(nodeHazard, t)
            color = hz; fillColor = hz
            radius = Math.max(radius + 2, 7)
            weight = Math.max(weight, 2.5)
            fillOpacity = 0.85; nodeOpacity = 1
          } else {
            fillOpacity = Math.min(fillOpacity, 0.07)
            nodeOpacity = Math.min(nodeOpacity, 0.07)
          }
        }

        return (
          <CircleMarker
            key={node.id}
            center={[node.lat, normalizeLng(node.lng)]}
            radius={radius}
            pathOptions={{ color, fillColor, fillOpacity, weight, opacity: nodeOpacity }}
            eventHandlers={{ click: (e) => { e.originalEvent.stopPropagation(); onNodeClick?.(node, e.originalEvent.clientX, e.originalEvent.clientY) } }}
          >
            {/* `key` forces a remount when the spotlight moves: react-leaflet
                reads `permanent` only when the tooltip is first created, so
                toggling the prop alone would never pin it open. */}
            <Tooltip
              key={isSpotlit ? 'pinned' : 'hover'}
              permanent={isSpotlit}
              direction={isSpotlit ? 'top' : 'auto'}
              offset={isSpotlit ? [0, -radius - 4] : [0, 0]}
            >
              <strong>{node.name}</strong> ({node.id})
              <br />{node.country} · {NODE_TYPE_LABEL[node.type] ?? node.type}
              {node.owner && <><br />Owner: {node.owner}</>}
            </Tooltip>
            {showNodeLabels && !isBU && (
              <Tooltip permanent direction="top" className="node-label" offset={[0, -radius - 2]}>
                {node.id}
              </Tooltip>
            )}
          </CircleMarker>
        )
      })}

      {/*
        Planned Events node highlight — mirrors the outageNodeIds/showAllOutages
        pattern (nodes touching a highlighted segment get included), adapted to
        the independent showPlannedEvents toggle. Unlike showAllOutages this
        never hides other nodes: it's a non-interactive amber ring drawn on top
        of whichever node marker is already there.
      */}
      {showPlannedEvents && plannedNodeIds && nodes.filter(n => plannedNodeIds.has(n.id)).map(node => {
        const ns = NODE_STYLE[node.type] ?? NODE_STYLE.extension_pop
        return (
          <CircleMarker
            key={`planned-node-${node.id}`}
            center={[node.lat, normalizeLng(node.lng)]}
            radius={ns.radius + 4}
            pathOptions={{ color: t.orange, fillOpacity: 0, weight: 2, dashArray: '3 2' }}
            interactive={false}
          />
        )
      })}

      {searchPin && (
        <CircleMarker
          center={[searchPin.lat, normalizeLng(searchPin.lng)]}
          radius={9}
          pathOptions={{ color: '#fff', fillColor: '#ff6b35', fillOpacity: 0.95, weight: 2.5 }}
        >
          <Tooltip>
            <strong>Search Location</strong><br />
            {searchPin.label.length > 60 ? searchPin.label.slice(0, 57) + '…' : searchPin.label}
          </Tooltip>
        </CircleMarker>
      )}

      {/* ── RouteManual overlay ── */}
      {manualActive && (
        <>
          {/* Locked path segments */}
          {manualState!.steps.map(step => {
            const seg = segmentsById[step.segmentId]
            if (!seg) return null
            const start = nodesById[seg.start_node_id]
            const end   = nodesById[seg.end_node_id]
            if (!start || !end) return null
            const lines = geoLines(start.lat, start.lng, end.lat, end.lng, seg.waypoints ?? undefined)
            return lines.map((positions, i) => (
              <Polyline key={`manual-locked-${step.segmentId}-${i}`} positions={positions}
                pathOptions={{ color: '#f9a825', weight: 3.5, opacity: 0.95 }} />
            ))
          })}

          {/* Candidate node pulses — colour matches next-hop list cards */}
          {manualCandidates.map((c, idx) => {
            const node = nodesById[c.nodeId]
            if (!node) return null
            const color  = candidateColor(idx)
            const radius = manualMobileMode ? 20 : 9
            return (
              <CircleMarker
                key={`manual-cand-${c.segmentId}`}
                center={[node.lat, normalizeLng(node.lng)]}
                radius={radius}
                pathOptions={{ color: '#fff', fillColor: color, fillOpacity: 0.9, weight: manualMobileMode ? 3 : 2 }}
                eventHandlers={{ click: (e) => {
                  e.originalEvent.stopPropagation()
                  onManualNodeClick?.(node)
                }}}
              >
                <Tooltip>
                  <strong>{idx + 1}. {node.name}</strong><br />
                  {c.segment.system_id} · {c.segment.length_km?.toLocaleString() ?? '?'} km · {c.segment.latency?.toFixed(1) ?? '?'} ms
                </Tooltip>
              </CircleMarker>
            )
          })}

          {/* Locked path nodes */}
          {[...(manualState ? [manualState.originId, ...manualState.steps.map(s => s.nodeId)] : [])].map((nodeId, idx, arr) => {
            const node    = nodesById[nodeId]
            if (!node) return null
            const isOrigin  = idx === 0
            const isCurrent = idx === arr.length - 1
            const fillColor = isOrigin ? '#3b82f6' : isCurrent ? '#10b981' : '#f9a825'
            return (
              <CircleMarker
                key={`manual-locked-node-${nodeId}-${idx}`}
                center={[node.lat, normalizeLng(node.lng)]}
                radius={isCurrent ? 8 : 6}
                pathOptions={{ color: '#fff', fillColor, fillOpacity: 1, weight: 2 }}
                eventHandlers={{ click: (e) => {
                  e.originalEvent.stopPropagation()
                  if (isCurrent) onManualNodeClick?.(node)
                }}}
              >
                <Tooltip><strong>{node.name}</strong>{isOrigin ? ' (Origin)' : isCurrent ? ' — double-click to finish' : ''}</Tooltip>
              </CircleMarker>
            )
          })}
        </>
      )}

      {/* RouteManual: clickable ALL nodes when waiting for origin */}
      {manualActive && !manualState?.originId && nodes.map(node => (
        <CircleMarker
          key={`manual-origin-${node.id}`}
          center={[node.lat, normalizeLng(node.lng)]}
          radius={5}
          pathOptions={{ color: t.blue, fillColor: t.blue, fillOpacity: 0.3, weight: 1 }}
          eventHandlers={{ click: (e) => { e.originalEvent.stopPropagation(); onManualNodeClick?.(node) } }}
        />
      ))}

      {/*
        Segment spotlight — draws a warm pulsing halo under whichever segment the
        cursor is over in a route's Segment Breakdown panel (RouteList.tsx), via
        the shared SegmentHoverContext. Drawn last so it sits above every other
        overlay; non-interactive so it never steals clicks/hover from the real
        segment line underneath.
      */}
      {hoveredSegmentId && (() => {
        const seg = segmentsById[hoveredSegmentId]
        if (!seg) return null
        const start = nodesById[seg.start_node_id]
        const end = nodesById[seg.end_node_id]
        if (!start || !end) return null
        const lines = geoLines(start.lat, start.lng, end.lat, end.lng, seg.waypoints ?? undefined)
        return lines.map((positions, i) => (
          <Polyline
            key={`glow-${seg.id}-${i}`}
            positions={positions}
            pathOptions={{ color: '#ff4500', weight: 8, opacity: 0.6, className: 'rb-segment-glow', lineCap: 'round' }}
            interactive={false}
          />
        ))
      })()}

      {/* ── Living World — decorative sprites in their own pane under the
             cables. Off in Network Editor: that mode is for precise work and
             a passing whale is a distraction there. ── */}
      {livingWorld && !editorMode && <LivingWorldLayer nodes={nodes} />}
      <KmlPreviewLayer lines={kmlPreview} fitKey={kmlPreviewKey} />

      {/* ── Network Hazards — live disasters, in a pane ABOVE the cables so an
             event can be seen to overlap a route. Off in Network Editor, where
             the map is for precise topology work. ── */}
      {hazardsOn && !editorMode && hazardFeed && <HazardLayer hazards={hazardFeed.hazards} />}

      {/* ── Network Editor overlay — see EditorMapLayer.tsx ── */}
      {editorMode && (
        <EditorMapLayer
          nodes={nodes}
          segments={segments}
          subMode={editorSubMode}
          selection={editorSelection}
          segmentDraft={editorSegmentDraft ?? emptySegmentDraft}
          pendingNodeIds={pendingNodeIds ?? EMPTY_STRING_SET}
          pendingSegmentIds={pendingSegmentIds ?? EMPTY_STRING_SET}
          onNodeDragEnd={onEditorNodeDragEnd ?? (() => {})}
          onNodeSelect={onEditorNodeSelect ?? (() => {})}
          onSegmentSelect={onEditorSegmentSelect ?? (() => {})}
          onWaypointInsert={onEditorWaypointInsert ?? (() => {})}
          onWaypointDragEnd={onEditorWaypointDragEnd ?? (() => {})}
          onWaypointDelete={onEditorWaypointDelete ?? (() => {})}
          onPickEndpoint={onEditorPickEndpoint ?? (() => {})}
          onPickEmptySpace={onEditorPickEmptySpace ?? (() => {})}
        />
      )}

      {/* ── KML chop session — see KmlChopMapLayer.tsx / KmlChopImport.tsx ── */}
      {kmlChop && <KmlChopMapLayer {...kmlChop} />}
    </MapContainer>
    </div>
  )
}
