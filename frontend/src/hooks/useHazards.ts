/**
 * useHazards — load the Network Hazards feed, but only once it is switched on.
 *
 * The layer is OFF by default and this hook is the reason that costs nothing:
 * with `enabled` false it never calls the API, so a user who never opens the
 * overlay never triggers an upstream fetch. The first enable pays for the
 * backend's cold build (~20s worst case while it hydrates fire perimeters);
 * every later one is served from the backend's cache in milliseconds.
 *
 * It then refreshes on a timer while enabled, because a hazard feed that was
 * accurate when you opened the tab and silently stale three hours later is
 * worse than no feed — and stops the timer the moment the layer is switched
 * off or the component unmounts.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HazardFeed } from '../types'
import { api } from '../api/client'

/** Slightly longer than the backend's own 10-minute TTL, so a poll normally
 *  lands on a warm cache rather than forcing a rebuild. */
const REFRESH_MS = 11 * 60 * 1000

export interface HazardState {
  feed: HazardFeed | null
  loading: boolean
  /** Set when the REQUEST failed. A feed that loaded with one source down is
   *  not an error here — that is `feed.degraded`. */
  error: string | null
  refresh: () => void
}

export function useHazards(enabled: boolean): HazardState {
  const [feed, setFeed] = useState<HazardFeed | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Guards against a slow response for a layer the user has since switched off
  // landing in state and repainting the map.
  const liveRequest = useRef(0)

  const load = useCallback(() => {
    const ticket = ++liveRequest.current
    setLoading(true)
    setError(null)
    api.getHazards()
      .then(next => {
        if (ticket !== liveRequest.current) return
        setFeed(next)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (ticket !== liveRequest.current) return
        setError(String(e))
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!enabled) {
      // Invalidate anything in flight; keep the last feed so re-enabling shows
      // the previous answer immediately while the refresh runs.
      liveRequest.current++
      setLoading(false)
      return
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [enabled, load])

  return { feed, loading, error, refresh: load }
}
