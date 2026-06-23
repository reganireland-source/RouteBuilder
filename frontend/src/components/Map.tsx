import { useEffect } from 'react'
import * as L from 'leaflet'
import 'leaflet.gridlayer.googlemutant'
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap } from 'react-leaflet'
import type { CableNode, CableSegment, CountryHighlight, PinnedRoute, Route, SegmentCapacity, SegmentOutage, SelectedSystem } from '../types'
import { useTheme } from '../theme'
import type { ManualState, NextHopCandidate } from './RouteManual'

const OWNERSHIP_LABEL: Record<string, string> = {
  owned:                'Owned',
  consortium:           'Consortium',
  iru:                  'IRU',
  integrated_lit_lease: 'Int. Lit Lease',
  offnet_resell:        'Offnet Resell',
}

// Visual hierarchy for node types: size + colour scale from most to least significant
const NODE_STYLE: Record<string, { color: string; fill: string; radius: number; weight: number; opacity: number }> = {
  landing_station: { color: '#ea580c', fill: '#f97316', radius: 8,   weight: 2.5, opacity: 1    },
  primary_pop:     { color: '#1d4ed8', fill: '#3b82f6', radius: 7,   weight: 2,   opacity: 1    },
  secondary_pop:   { color: '#7c3aed', fill: '#a855f7', radius: 6,   weight: 1.5, opacity: 1    },
  extension_pop:   { color: '#475569', fill: '#64748b', radius: 5,   weight: 1,   opacity: 0.85 },
  branching_unit:  { color: '#92400e', fill: '#d97706', radius: 3,   weight: 1,   opacity: 0.75 },
  off_net:         { color: '#374151', fill: '#6b7280', radius: 5,   weight: 1,   opacity: 0.65 },
}

const NODE_TYPE_LABEL: Record<string, string> = {
  landing_station: 'CLS (Landing Station)',
  primary_pop:     'Primary PoP',
  secondary_pop:   'Secondary PoP',
  extension_pop:   'Extension PoP',
  branching_unit:  'Branching Unit',
  off_net:         'Off-Net Node',
}

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  selectedRoutes: Route[]
  capacity: SegmentCapacity[]
  pinnedRoutes: PinnedRoute[]
  selectedSystems: SelectedSystem[]
  onNodeClick?: (node: CableNode, screenX: number, screenY: number) => void
  searchPin?: { lat: number; lng: number; label: string }
  nearestNodeIds?: string[]
  hideNonActive?: boolean
  showSegmentLabels?: boolean
  showNodeLabels?: boolean
  showAllOutages?: boolean
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

/**
 * Normalise a longitude for a Pacific-centred map view.
 * Western Hemisphere longitudes (Americas, < −30°) are shifted +360°
 * so they render to the RIGHT of the Pacific (e.g. LA −118° → 242°)
 * rather than to the left of Europe, keeping all transpacific cables
 * as single continuous lines without antimeridian splits.
 */
function normalizeLng(lng: number): number {
  return lng < -30 ? lng + 360 : lng
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
 * Catmull-Rom spline: interpolates `steps` points between each pair of
 * control points, producing a smooth curve that passes through every point.
 */
function catmullRom(pts: [number, number][], steps = 12): [number, number][] {
  if (pts.length < 3) return pts
  const out: [number, number][] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    for (let s = 0; s < steps; s++) {
      const t  = s / steps
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2*p0[0] - 5*p1[0] + 4*p2[0] - p3[0]) * t2 + (-p0[0] + 3*p1[0] - 3*p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2*p0[1] - 5*p1[1] + 4*p2[1] - p3[1]) * t2 + (-p0[1] + 3*p1[1] - 3*p2[1] + p3[1]) * t3),
      ])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * Return Leaflet Polyline positions for a segment.  When waypoints are
 * provided (static ocean-routing hints) the path threads through them via
 * a Catmull-Rom spline for smooth rendering; otherwise a direct arc is drawn.
 * All longitudes are Pacific-normalised so transpacific cables render as
 * single lines without antimeridian splits.
 */
function geoLines(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  waypoints?: [number, number][],
): [number, number][][] {
  const nLng1 = normalizeLng(lng1)
  const nLng2 = normalizeLng(lng2)
  let d = nLng2 - nLng1
  if (d >  180) d -= 360
  if (d < -180) d += 360

  if (waypoints && waypoints.length > 0) {
    const pts: [number, number][] = [
      [lat1, nLng1],
      ...waypoints.map(([wlat, wlng]): [number, number] => [wlat, normalizeLng(wlng)]),
      [lat2, nLng1 + d],
    ]
    return [catmullRom(pts)]
  }

  return [[[lat1, nLng1], [lat2, nLng1 + d]]]
}

export function Map({ nodes, segments, selectedRoutes, capacity, pinnedRoutes, selectedSystems, onNodeClick, searchPin, nearestNodeIds, hideNonActive = false, showSegmentLabels = false, showNodeLabels = false, showAllOutages = false, outages = [], countryHighlight, subseaOnly = false, backhaulOnly = false, panelWidth, manualState, manualCandidates = [], onManualNodeClick, manualMobileMode = false }: Props) {
  const t = useTheme()
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const capacityById = Object.fromEntries(capacity.map(c => [c.segment_id, c]))

  // segment_id → all faults on that segment (a segment can have multiple active faults)
  const outagesBySegId = outages.reduce<Record<string, typeof outages>>((acc, o) => {
    ;(acc[o.segment_id] ??= []).push(o)
    return acc
  }, {})
  const outageSegIds = new Set(outages.map(o => o.segment_id))

  // In outage-map mode, collect nodes that belong to downed segments
  const outageNodeIds = showAllOutages
    ? new Set(outages.flatMap(o => {
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
  for (const r of selectedRoutes) {
    const color = r.id.startsWith('protected-') ? t.green : t.blue
    for (const s of r.segments) {
      segmentColor[s.segment_id] = color
      segmentWeight[s.segment_id] = 3
      segmentOpacity[s.segment_id] = 0.9
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
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
    {/* Node type legend */}
    <div style={{
      position: 'absolute', bottom: 28, left: 8, zIndex: 1000,
      background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(4px)',
      border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7,
      padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 4,
      pointerEvents: 'none', userSelect: 'none',
    }}>
      {([
        ['landing_station', 'CLS'],
        ['primary_pop',     'Primary PoP'],
        ['secondary_pop',   'Secondary PoP'],
        ['extension_pop',   'Extension PoP'],
        ['branching_unit',  'Branching Unit'],
        ['off_net',         'Off-Net Node'],
      ] as [string, string][]).map(([type, label]) => {
        const ns = NODE_STYLE[type]
        const sz = Math.round(ns.radius * 1.5)
        return (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
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
      {import.meta.env.VITE_MAPS_PROVIDER === 'google'
        ? <GoogleMutantLayer themeId={t.themeId} />
        : <TileLayer
            key={t.mapTileUrl}
            url={t.mapTileUrl}
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            noWrap={false}
          />
      }

      <MapResizer panelWidth={panelWidth} />
      <MapFlyTo highlight={countryHighlight} />
      <ManualFitBounds manualState={manualState} manualCandidates={manualCandidates} nodes={nodes} />

      {segments.flatMap(seg => {
        const start = nodesById[seg.start_node_id]
        const end = nodesById[seg.end_node_id]
        if (!start || !end) return []

        const isDown = outageSegIds.has(seg.id)
        const lines = geoLines(start.lat, start.lng, end.lat, end.lng, seg.waypoints ?? undefined)

        const tooltip = (
          <Tooltip sticky>
            <strong>{seg.name}</strong>
            <br />{seg.system_id} · {seg.type} · {OWNERSHIP_LABEL[seg.ownership] ?? seg.ownership}
            <br />{start.name} → {end.name}
            <br />{seg.length_km.toLocaleString()} km · {seg.latency} ms · Cost: {seg.cost_weight}
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
        const pathOptions = {
          color:     showAsDown ? '#ef4444' : color,
          weight:    showAsDown ? 2.5 : weight,
          opacity:   showAsDown ? 0.95 : opacity,
          dashArray: showAsDown ? '6 3 2 3' : seg.type === 'terrestrial' ? '6 4' : undefined,
        }

        return lines.map((positions, i) => (
          <Polyline
            key={`${seg.id}-${i}`}
            positions={positions}
            pathOptions={pathOptions}
          >
            {i === 0 && tooltip}
            {i === 0 && showSegmentLabels && isActiveSegment && (
              <Tooltip permanent direction="center" className="seg-label" offset={[0, 0]}>
                {seg.id}
              </Tooltip>
            )}
          </Polyline>
        ))
      })}

      {nodes.map(node => {
        const isRouteNode   = routeNodeIds.has(node.id)
        const sysColor      = systemNodeColor[node.id]
        const isSystemNode  = !!sysColor
        const isDimmed      = systemViewerActive && !isSystemNode && !isRouteNode
        const isCountryNode = countryActive && (countryHighlight!.nodeIds.has(node.id) || countryEndpointIds.has(node.id))

        // Outage map mode: only show nodes on downed segments
        if (showAllOutages) {
          if (!outageNodeIds?.has(node.id)) return null
        } else if (hideNonActive && !isRouteNode && !isSystemNode) return null
        const ns            = NODE_STYLE[node.type] ?? NODE_STYLE.extension_pop
        const isBU          = node.type === 'branching_unit'
        const isNearest     = nearestNodeIds?.includes(node.id) ?? false

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

        return (
          <CircleMarker
            key={node.id}
            center={[node.lat, normalizeLng(node.lng)]}
            radius={radius}
            pathOptions={{ color, fillColor, fillOpacity, weight, opacity: nodeOpacity }}
            eventHandlers={{ click: (e) => { e.originalEvent.stopPropagation(); onNodeClick?.(node, e.originalEvent.clientX, e.originalEvent.clientY) } }}
          >
            <Tooltip>
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
    </MapContainer>
    </div>
  )
}
