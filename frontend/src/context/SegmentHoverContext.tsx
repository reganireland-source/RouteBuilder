/**
 * ============================================================================
 * context/SegmentHoverContext.tsx — "which segment is the cursor over?"
 * ============================================================================
 *
 * A single piece of shared, ephemeral UI state: the id of the cable segment
 * currently under the cursor in a Segment Breakdown view (RouteList.tsx's
 * SegmentTooltip / SegmentBreakdownRows). Map.tsx reads it to draw a warm
 * pulsing glow on that segment, so hovering a row highlights its cable on
 * the live map.
 *
 * A context (rather than threading a prop through RouteList → PinnedRouteCard
 * /RouteCard → SegmentTooltip → SegmentBreakdownRows, and separately into
 * NetworkMap) because the two ends of this relationship — a row in the route
 * panel and a polyline on the map — are far apart in the component tree with
 * no shared parent closer than App.tsx, and neither side needs any of the
 * unrelated props the other already takes.
 *
 * Mounted once in main.tsx as <SegmentHoverProvider> wrapping the whole app.
 */
import { createContext, useContext, useState, type ReactNode } from 'react'

/** Shape of the context value returned by useSegmentHover(). */
interface SegmentHoverCtx {
  /** The id of the segment currently hovered in a Segment Breakdown row,
   *  or null when nothing is hovered. */
  hoveredSegmentId: string | null
  /** Updates the hovered segment id; called on row mouse-enter/-leave in
   *  RouteList.tsx and read by Map.tsx to draw the highlight. */
  setHoveredSegmentId: (id: string | null) => void
}

const SegmentHoverContext = createContext<SegmentHoverCtx>({
  hoveredSegmentId: null,
  setHoveredSegmentId: () => {},
})

/**
 * Provider wrapping the whole app (see main.tsx). Holds the single
 * currently-hovered segment id in plain useState — this is ephemeral UI
 * state with exactly one "owner" at a time, so no memoization or
 * persistence is needed.
 * @param children - The whole app tree.
 */
export function SegmentHoverProvider({ children }: { children: ReactNode }) {
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null)
  return (
    <SegmentHoverContext.Provider value={{ hoveredSegmentId, setHoveredSegmentId }}>
      {children}
    </SegmentHoverContext.Provider>
  )
}

/** Hook giving any component the currently-hovered segment id and a setter
 *  to change it. Falls back to the default context value (`{
 *  hoveredSegmentId: null, setHoveredSegmentId: noop }`) if called outside
 *  the provider. */
export const useSegmentHover = () => useContext(SegmentHoverContext)
