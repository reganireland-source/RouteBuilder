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

interface SegmentHoverCtx {
  hoveredSegmentId: string | null
  setHoveredSegmentId: (id: string | null) => void
}

const SegmentHoverContext = createContext<SegmentHoverCtx>({
  hoveredSegmentId: null,
  setHoveredSegmentId: () => {},
})

export function SegmentHoverProvider({ children }: { children: ReactNode }) {
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null)
  return (
    <SegmentHoverContext.Provider value={{ hoveredSegmentId, setHoveredSegmentId }}>
      {children}
    </SegmentHoverContext.Provider>
  )
}

export const useSegmentHover = () => useContext(SegmentHoverContext)
