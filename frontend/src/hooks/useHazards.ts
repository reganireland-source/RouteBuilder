/**
 * useHazards — keep the Network Hazards feed ready, and let the layer decide
 * whether to draw it.
 *
 * Fetching and DISPLAYING are separate concerns here, which is the whole point
 * of this hook:
 *
 *   • The feed is PREFETCHED once at boot, whether or not the layer is on, so
 *     switching it on is instant rather than a wait. The prefetch is deferred to
 *     an idle moment so it never competes with the reference data and the first
 *     route search, which are what the user is actually waiting for.
 *   • It POLLS only while the layer is on. Refreshing every eleven minutes for a
 *     layer nobody is looking at would be ongoing traffic spent on nothing.
 *   • On being switched on, whatever was prefetched shows IMMEDIATELY, and a
 *     refresh runs in the background only if that data has gone stale.
 *
 * The backend warms its own cache at startup (see hazards/service.py), so this
 * prefetch is normally a cache hit measured in milliseconds rather than the
 * ~19 s cold build.
 *
 * TWO THINGS ARE DELIBERATELY NOT PREFETCHED. On a metered or data-saver
 * connection the payload is skipped until the layer is actually switched on —
 * roughly half a megabyte for a feature that is off by default is not a
 * reasonable thing to spend on someone's mobile data without asking. And a
 * prefetch is never retried: if it fails, the layer will fetch on demand and
 * show the error then, rather than the app quietly retrying a feed nobody has
 * asked to see.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HazardFeed } from '../types'
import { api } from '../api/client'

/** Slightly longer than the backend's own 10-minute TTL, so a poll normally
 *  lands on a warm cache rather than forcing a rebuild. */
const REFRESH_MS = 11 * 60 * 1000

/** How long prefetched data stays good enough to show without a refresh. */
const STALE_MS = REFRESH_MS

/** Fallback delay when the browser has no requestIdleCallback (Safari). Long
 *  enough for the initial render and the reference-data load to be done with. */
const IDLE_FALLBACK_MS = 4000

export interface HazardState {
  feed: HazardFeed | null
  loading: boolean
  /** Set when the REQUEST failed. A feed that loaded with one source down is
   *  not an error here — that is `feed.degraded`. */
  error: string | null
  refresh: () => void
}

/** True when the browser says the connection is metered or the user has asked
 *  for reduced data use. Treated as "do not prefetch". */
function prefersLessData(): boolean {
  const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (!conn) return false
  if (conn.saveData) return true
  return conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g'
}

/** Run `fn` when the browser is idle, with a timeout so it always runs. */
function onIdle(fn: () => void): () => void {
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  })
  if (ric.requestIdleCallback) {
    const id = ric.requestIdleCallback(fn, { timeout: IDLE_FALLBACK_MS })
    return () => ric.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(fn, IDLE_FALLBACK_MS)
  return () => window.clearTimeout(id)
}

export function useHazards(enabled: boolean): HazardState {
  const [feed, setFeed] = useState<HazardFeed | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Guards against a slow response for a layer the user has since switched off
  // landing in state and repainting the map.
  const liveRequest = useRef(0)
  // When the data we hold was fetched — drives the "is this stale?" decision on
  // enable. Not derived from `feed.fetched_at`: that is when the BACKEND built
  // its payload, which can be up to a TTL older than when we received it.
  const receivedAt = useRef(0)
  // A prefetch happens once per session, not once per toggle.
  const prefetched = useRef(false)

  const load = useCallback((quiet = false) => {
    const ticket = ++liveRequest.current
    // A background refresh must not flip the panel back to "Loading hazards…"
    // over data that is already on screen and perfectly readable.
    if (!quiet) setLoading(true)
    setError(null)
    api.getHazards()
      .then(next => {
        if (ticket !== liveRequest.current) return
        setFeed(next)
        receivedAt.current = Date.now()
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (ticket !== liveRequest.current) return
        // A failed PREFETCH is silent: nobody asked to see this yet, and an
        // error banner for a layer that is switched off would be noise.
        if (!quiet) setError(String(e))
        setLoading(false)
      })
  }, [])

  // ── Prefetch, once, when the app has settled ──
  //
  // The guard is set when the fetch ACTUALLY RUNS, not when it is scheduled.
  // Under StrictMode React mounts, unmounts and remounts every effect: setting
  // the flag at schedule time meant the first mount claimed it, the cleanup
  // cancelled the idle callback, and the remount saw the flag already set and
  // bailed — so the prefetch silently never happened at all.
  useEffect(() => {
    if (prefetched.current) return
    if (prefersLessData()) return
    return onIdle(() => {
      if (prefetched.current) return
      prefetched.current = true
      load(true)
    })
  }, [load])

  // ── Poll, but only while the layer is actually being drawn ──
  useEffect(() => {
    if (!enabled) {
      // Abandon anything in flight. `loading` is NOT cleared here — setting
      // state synchronously in an effect triggers a cascading render, and it is
      // unnecessary: the returned `loading` is gated on `enabled` below, and any
      // path that re-enables with no usable data calls load() again anyway.
      liveRequest.current++
      return
    }
    // Show what we already have instantly; only go to the network if it has
    // aged out, or if the prefetch never produced anything.
    const stale = Date.now() - receivedAt.current > STALE_MS
    if (feed === null || stale) load(feed !== null)

    const timer = window.setInterval(() => load(true), REFRESH_MS)
    return () => window.clearInterval(timer)
    // `feed` is deliberately absent: including it would restart the poll timer
    // every time a refresh lands, and the staleness check only needs to run
    // when the layer is switched on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, load])

  // `loading` is gated on `enabled` so a switched-off layer never reports a
  // request that was abandoned mid-flight as still running.
  return { feed, loading: enabled && loading, error, refresh: () => load(false) }
}
