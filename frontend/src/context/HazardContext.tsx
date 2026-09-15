/**
 * HazardContext — "is there anything happening near this asset?", available to
 * any component without threading the feed through six layers of props.
 *
 * The Full Views are mounted from NodeInfoPanel and RouteList, which are
 * themselves several levels below App. Passing the hazard feed down that chain
 * would mean adding a prop to every component in between, none of which has any
 * interest in hazards — the same argument that already made SegmentHoverContext
 * a context rather than a prop.
 *
 * The default is an empty list, so every consumer works unchanged when the layer
 * is switched off (which is the default) or when no provider is mounted at all.
 * "No hazards" and "hazards not loaded" deliberately look the same to a consumer
 * here: the Full View says nothing rather than claiming an all-clear, and the
 * map's own status panel is the one place that explains coverage.
 */
import { createContext, useContext, useMemo } from 'react'
import type { Hazard } from '../types'

const HazardContext = createContext<Hazard[]>([])

export function HazardProvider({ hazards, children }: { hazards: Hazard[]; children: React.ReactNode }) {
  // Memoised on identity: the feed only changes when a poll returns, and a new
  // array every render would re-run every consumer's useMemo for nothing.
  const value = useMemo(() => hazards, [hazards])
  return <HazardContext.Provider value={value}>{children}</HazardContext.Provider>
}

/**
 * Every hazard that lists this asset as affected, worst first.
 *
 * `kind` is not used to filter — an id is unique across nodes and segments in
 * this dataset — but it is taken so the call site reads unambiguously and so
 * this can tighten later without touching callers.
 */
export function useHazardsFor(kind: 'node' | 'segment', id: string): Hazard[] {
  const all = useContext(HazardContext)
  return useMemo(() => {
    const severityRank = { emergency: 3, warning: 2, watch: 1, advisory: 0 }
    return all
      .filter(h => h.affected.some(a => a.kind === kind && a.id === id))
      .sort((a, b) => severityRank[b.severity] - severityRank[a.severity])
  }, [all, kind, id])
}

/** Distance from this asset to a hazard, as the backend measured it. */
export function hazardDistanceKm(hazard: Hazard, kind: 'node' | 'segment', id: string): number | null {
  return hazard.affected.find(a => a.kind === kind && a.id === id)?.distance_km ?? null
}
