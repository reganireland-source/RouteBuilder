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
import type { Hazard, HazardSeverity } from '../types'

const HazardContext = createContext<Hazard[]>([])

/**
 * Publishes the current hazard feed to every descendant via context.
 *
 * @param hazards - The full, current hazard list (typically from a polling
 *   fetch higher up the tree); pass `[]` when the layer is off or not yet
 *   loaded — see the file header on why that looks identical to "no
 *   hazards" from a consumer's point of view.
 * @param children - The subtree that may read hazards via useHazardsFor /
 *   worstSeverityByAsset.
 */
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
    return all
      .filter(h => h.affected.some(a => a.kind === kind && a.id === id))
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
  }, [all, kind, id])
}

/** Ascending, so a larger number is a worse hazard. */
const SEVERITY_RANK: Record<HazardSeverity, number> = {
  advisory: 0, watch: 1, warning: 2, emergency: 3,
}

/**
 * The WORST severity affecting each of our assets, keyed by asset id.
 *
 * One pass over the feed rather than a scan per asset: the map asks this
 * question for all 230 nodes and 322 segments on every render, and doing it the
 * other way round is quadratic for no reason. Node and segment ids share one
 * map because they do not collide in this dataset.
 */
export function worstSeverityByAsset(hazards: Hazard[]): Map<string, HazardSeverity> {
  const out = new Map<string, HazardSeverity>()
  for (const h of hazards) {
    for (const a of h.affected) {
      const current = out.get(a.id)
      if (current === undefined || SEVERITY_RANK[h.severity] > SEVERITY_RANK[current]) {
        out.set(a.id, h.severity)
      }
    }
  }
  return out
}

/** Distance from this asset to a hazard, as the backend measured it. */
export function hazardDistanceKm(hazard: Hazard, kind: 'node' | 'segment', id: string): number | null {
  return hazard.affected.find(a => a.kind === kind && a.id === id)?.distance_km ?? null
}
