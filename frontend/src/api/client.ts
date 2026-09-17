/**
 * ============================================================================
 * api/client.ts — The single HTTP client for the entire frontend
 * ============================================================================
 *
 * Every backend call in the app goes through the `api` object exported at the
 * bottom of this file; components never call fetch() directly. It is a thin,
 * dependency-free wrapper around the browser fetch API with:
 *
 *  - Base URL resolution: `BASE_URL` comes from the VITE_API_URL build-time
 *    env var (the deployed FastAPI backend, e.g. a Railway URL). In local dev
 *    it is left empty so requests hit the same origin and are proxied by
 *    Vite's dev server. A loud console.error fires in production builds if
 *    the variable was forgotten, because every request would 404 otherwise.
 *
 *  - Verb helpers (get/post/put/del/delJson/uploadFile): each throws a plain
 *    `Error` on any non-2xx status. Write helpers try to extract FastAPI's
 *    JSON `detail` field and append it to the error message so callers can
 *    surface a meaningful reason in the UI; callers are expected to
 *    try/catch and display `err.message`. `delJson` exists for DELETEs whose
 *    response body matters (e.g. removing a circuit returns the updated
 *    Project). `uploadFile` posts multipart/form-data for bulk CSV import.
 *
 *  - Admin token injection: AuthContext calls setAdminToken() after the user
 *    unlocks admin mode (verified against POST /api/auth/verify). From then
 *    on every mutating request (POST/PUT/DELETE/upload) carries an
 *    `X-Admin-Token` header, which the backend requires for write endpoints.
 *    Plain GETs are public and never send the header. The token itself is a
 *    module-level variable here; AuthContext also mirrors it into
 *    sessionStorage ('rb_admin_token') so admin mode survives a page refresh
 *    within the same browser tab.
 *
 * The `api` object itself is a flat catalogue of typed endpoint wrappers,
 * grouped by resource (nodes, segments, systems, capacity, outages, config,
 * health, city pairs, NLP, bulk import/export, interconnect rules, interface
 * types, projects, tech lookups, solution notes, note categories, feature
 * requests). Request/response shapes are the interfaces in ../types.
 */

import type { AppConfig, CableNode, KmlCommitResponse, KmlFullPath, KmlPathsResponse, KmlProposeResponse, KmlUploadResult, CableSegment, CableSystem, CityInfo, CityPairResponse, FeatureRequest, InterfaceType, InterconnectRule, HazardFeed, NlpParseResponse, NoteCategory, OutageEventType, OutageParseResponse, Project, ProjectCircuit, RouteRequest, RouteResponse, SegmentCapacity, SegmentOutage, SldConfig, SolutionNote, TechLookupItem, TechLookupTable } from '../types'

// Backend origin baked in at build time. Empty string = same-origin (dev proxy).
const BASE_URL = import.meta.env.VITE_API_URL ?? ''

if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  console.error(
    '[RouteBuilder] VITE_API_URL is not set. ' +
    'Add it as a build-time environment variable in the Vercel dashboard ' +
    'pointing to your Railway backend URL (e.g. https://your-app.up.railway.app). ' +
    'All API calls will fail until this is configured.'
  )
}

// Admin token — set by AuthContext when user unlocks admin mode
// (verified against POST /api/auth/verify) or re-hydrated by AuthContext from
// sessionStorage on page load. clearAdminToken() is called on admin logout.
let _adminToken = ''
/** Store the verified admin token; all subsequent write requests will send it. */
export function setAdminToken(t: string) { _adminToken = t }
/** Forget the admin token (admin logout); write requests become anonymous again. */
export function clearAdminToken() { _adminToken = '' }
/** Header fragment merged into every mutating request: X-Admin-Token when unlocked, nothing otherwise. */
function adminHeaders(): Record<string, string> {
  return _adminToken ? { 'X-Admin-Token': _adminToken } : {}
}

/**
 * Percent-encode one value for use as a URL PATH SEGMENT.
 *
 * Every id below that comes from the dataset goes through this. Ids are allowed
 * to contain `&` (real station codes do — see backend/app/id_utils.py), and
 * while `&` happens to be legal in a path segment, an id must not have to be
 * lucky about that: the moment a character that isn't (`#`, `?`, `%`, a space)
 * reaches a path unencoded, the request silently addresses something else
 * rather than failing loudly. Encoding here makes the id opaque to the URL
 * whatever the allow-list grows to accept, and FastAPI decodes the path
 * parameter back to the original string on the other side.
 */
const enc = encodeURIComponent

/** GET a JSON resource. Public (no admin header). Throws Error with the HTTP status on failure. */
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
  return res.json()
}

/**
 * POST a JSON body. Sends the admin token header when unlocked. On failure,
 * tries to pull FastAPI's `detail` message out of the error response so the
 * thrown Error reads like "409: segment already exists" for UI display.
 * (Note: unlike put/del, the message deliberately omits the path — POST
 * callers show it directly to users, e.g. route-search validation errors.)
 */
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json()).detail ?? '' } catch { /* ignore */ }
    throw new Error(`${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return res.json()
}

/** PUT a JSON body (update). Admin header + FastAPI `detail` extraction, as for post(). */
async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json()).detail ?? '' } catch { /* ignore */ }
    throw new Error(`PUT ${path} failed: ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return res.json()
}

/** DELETE with no response body expected. Admin header + FastAPI `detail` extraction. */
async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: adminHeaders() })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json()).detail ?? '' } catch { /* ignore */ }
    throw new Error(`DELETE ${path} failed: ${res.status}${detail ? `: ${detail}` : ''}`)
  }
}

/**
 * DELETE that parses and returns a JSON response body — used where the
 * backend replies with updated state (e.g. removing a circuit returns the
 * whole updated Project document).
 */
async function delJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: adminHeaders() })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json()).detail ?? '' } catch { /* ignore */ }
    throw new Error(`DELETE ${path} failed: ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return res.json()
}

/** POST a prepared FormData. Like uploadFile but for requests carrying extra
 *  fields alongside the file (KML upload sends segment_id and placemark too). */
async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers: adminHeaders(), body: form })
  if (!res.ok) {
    let detail: unknown = ''
    try { detail = (await res.json()).detail ?? '' } catch { /* ignore */ }
    const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
    const suffix = text ? `: ${text}` : ''
    throw new Error(`${res.status}${suffix}`)
  }
  return res.json()
}

/**
 * POST a single file as multipart/form-data (field name "file") — used by the
 * bulk CSV validate/import endpoints. No Content-Type header is set manually
 * so the browser adds the correct multipart boundary itself.
 */
async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers: adminHeaders(), body: form })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json()).detail ?? '' } catch { /* ignore */ }
    throw new Error(`${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return res.json()
}

/**
 * Stream the Outage Parser: POST the input as multipart, then read the
 * Server-Sent-Events response — {type:'progress',tokens} frames drive the live
 * counter (via onProgress), and a final {type:'result'} resolves the promise
 * ({type:'error'} rejects). Falls back gracefully if the body isn't streamable
 * (some proxies buffer): the counter just jumps at the end.
 * `eventType` ('outage' or 'planned_event') is sent as the `event_type` form
 * field so the backend extracts the right date fields (repair window vs
 * planned window) and scopes `existing_count` to that same type.
 */
async function parseOutagesStream(text: string, files: File[], eventType: OutageEventType, onProgress?: (tokens: number) => void): Promise<OutageParseResponse> {
  const form = new FormData()
  if (text) form.append('text', text)
  for (const f of files) form.append('files', f)
  form.append('event_type', eventType)
  const res = await fetch(`${BASE_URL}/api/outages/parse`, { method: 'POST', headers: adminHeaders(), body: form })
  if (!res.ok || !res.body) {
    let detail = ''
    try { detail = (await res.json()).detail ?? '' } catch { /* ignore */ }
    throw new Error(`${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let result: OutageParseResponse | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // SSE frames are separated by a blank line.
    let sep: number
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, sep).trim()
      buf = buf.slice(sep + 2)
      if (!frame) continue
      const json = frame.startsWith('data:') ? frame.slice(5).trim() : frame
      let ev: { type: string; tokens?: number; detail?: string; proposals?: unknown; existing_count?: number; model?: string }
      try { ev = JSON.parse(json) } catch { continue }
      if (ev.type === 'progress') onProgress?.(ev.tokens ?? 0)
      else if (ev.type === 'error') throw new Error(ev.detail || 'Parse failed')
      else if (ev.type === 'result') result = ev as unknown as OutageParseResponse
    }
  }
  if (!result) throw new Error('Parser returned no result')
  return result
}

/**
 * The typed endpoint catalogue used by every component. Each entry is a
 * one-line wrapper mapping a method to a backend REST path; see the header
 * comment of this file for cross-cutting behaviour (base URL, errors, admin
 * token). Reads are public; creates/updates/deletes require admin mode.
 */
export const api = {
  // Reads
  getNodes:     () => get<CableNode[]>('/api/nodes'),
  getSegments:  () => get<CableSegment[]>('/api/segments'),
  getSystems:   () => get<CableSystem[]>('/api/systems'),
  getCapacity:  () => get<SegmentCapacity[]>('/api/capacity'),
  searchRoutes: (req: RouteRequest) => post<RouteResponse>('/api/routes', req),

  // Nodes
  createNode:   (data: CableNode)                          => post<CableNode>('/api/nodes', data),
  updateNode:   (id: string, data: Partial<CableNode>)     => put<CableNode>(`/api/nodes/${enc(id)}`, data),
  deleteNode:   (id: string)                               => del(`/api/nodes/${enc(id)}`),

  // Segments
  createSegment:  (data: CableSegment)                       => post<CableSegment>('/api/segments', data),
  updateSegment:  (id: string, data: Partial<CableSegment>)  => put<CableSegment>(`/api/segments/${enc(id)}`, data),
  deleteSegment:  (id: string)                               => del(`/api/segments/${enc(id)}`),

  // Systems
  createSystem:   (data: CableSystem)                        => post<CableSystem>('/api/systems', data),
  updateSystem:   (id: string, data: Partial<CableSystem>)   => put<CableSystem>(`/api/systems/${enc(id)}`, data),
  deleteSystem:   (id: string)                               => del(`/api/systems/${enc(id)}`),

  // Capacity
  createCapacity: (data: SegmentCapacity)                           => post<SegmentCapacity>('/api/capacity', data),
  updateCapacity: (segId: string, data: Partial<SegmentCapacity>)   => put<SegmentCapacity>(`/api/capacity/${enc(segId)}`, data),
  deleteCapacity: (segId: string)                                   => del(`/api/capacity/${enc(segId)}`),

  // Outages
  getOutages:     ()                                                   => get<SegmentOutage[]>('/api/outages'),
  createOutage:   (data: SegmentOutage)                                => post<SegmentOutage>('/api/outages', data),
  updateOutage:   (faultId: string, data: Partial<SegmentOutage>)      => put<SegmentOutage>(`/api/outages/${enc(faultId)}`, data),
  deleteOutage:   (faultId: string)                                    => del(`/api/outages/${enc(faultId)}`),
  // Outage Parser: send pasted text and/or one-or-more files (screenshots pasted
  // from the clipboard, and/or a CSV/XLSX) to be parsed into proposed outages by
  // AI. Does not save. `replaceAllOutages` is the destructive "Accept All"
  // commit. Multiple images are sent as repeated `files` fields and read
  // together in a single vision call. `eventType` selects Outage vs Planned
  // Event parsing/review mode (see OutageEventType) and is required on both
  // calls so the right record type is parsed/replaced.
  // Streams the parse: the backend sends Server-Sent-Events — repeated
  // {type:'progress',tokens} frames (drive the live token counter) then a final
  // {type:'result',...} or {type:'error',detail}. onProgress is called with the
  // running output-token estimate; resolves with the final OutageParseResponse.
  parseOutages:   (text: string, files: File[], eventType: OutageEventType, onProgress?: (tokens: number) => void) =>
    parseOutagesStream(text, files, eventType, onProgress),
  // TYPE-SCOPED replace: wipes and reinserts only the rows of `eventType`,
  // leaving the other type's records (outage vs planned_event) untouched.
  replaceAllOutages: (data: SegmentOutage[], eventType: OutageEventType)  => put<SegmentOutage[]>(`/api/outages?event_type=${eventType}`, data),

  // Config
  getConfig:    ()                    => get<AppConfig>('/api/config'),
  updateConfig: (data: Partial<AppConfig>) => put<AppConfig>('/api/config', data),

  // Health
  getHealth:    () => get<{ status: string; nodes: number; segments: number; systems: number; storage: string; db_ok: boolean; db_detail: string }>('/api/health'),
  getChecks:    () => get<{ all_passed: boolean; error_count: number; warning_count: number; checks: { name: string; passed: boolean; severity: string; message: string }[] }>('/api/health/checks'),
  getNlpHealth: () => get<{ status: 'ok' | 'disabled' | 'error'; provider: string | null; detail: string }>('/api/health/nlp'),
  adminReseed:  () => post<{ status: string; reason?: string; reseeded?: Record<string, number> }>('/api/health/admin/reseed', {}),

  // City Pair
  getCities:        ()                                                   => get<CityInfo[]>('/api/city-pairs/cities'),
  searchCityPairs:  (origin: string, dest: string, max?: number)         => post<CityPairResponse>('/api/city-pairs/search', { origin_city: origin, destination_city: dest, max_results: max ?? 15 }),

  // NLP
  parseNlp: (text: string) => post<NlpParseResponse>('/api/nlp/parse', { text }),

  // Bulk import / export
  bulkExportUrl: (table: string) => `${BASE_URL}/api/bulk/export/${enc(table)}`,
  bulkValidate: <T>(table: string, file: File, mode: string) =>
    uploadFile<T>(`/api/bulk/validate/${enc(table)}?mode=${enc(mode)}`, file),
  bulkImport: <T>(table: string, file: File, mode: string) =>
    uploadFile<T>(`/api/bulk/import/${enc(table)}?mode=${enc(mode)}`, file),

  // Rules
  getRules:     ()                                                  => get<InterconnectRule[]>('/api/rules'),
  createRule:   (data: InterconnectRule)                            => post<InterconnectRule>('/api/rules', data),
  updateRule:   (nodeId: string, data: Partial<InterconnectRule>)   => put<InterconnectRule>(`/api/rules/${enc(nodeId)}`, data),
  deleteRule:   (nodeId: string)                                    => del(`/api/rules/${enc(nodeId)}`),

  // Interface Types
  getInterfaces:    ()                                                    => get<InterfaceType[]>('/api/interfaces'),
  createInterface:  (data: InterfaceType)                                 => post<InterfaceType>('/api/interfaces', data),
  updateInterface:  (id: string, data: Partial<InterfaceType>)            => put<InterfaceType>(`/api/interfaces/${enc(id)}`, data),
  deleteInterface:  (id: string)                                          => del(`/api/interfaces/${enc(id)}`),

  // Projects
  getProjects:      ()                                                    => get<Project[]>('/api/projects'),
  createProject:    (data: Project)                                       => post<Project>('/api/projects', data),
  updateProject:    (id: string, data: Partial<Project>)                  => put<Project>(`/api/projects/${enc(id)}`, data),
  deleteProject:    (id: string)                                          => del(`/api/projects/${enc(id)}`),
  addCircuit:       (projectId: string, circuit: ProjectCircuit)          => post<Project>(`/api/projects/${enc(projectId)}/circuits`, circuit),
  updateCircuit:    (projectId: string, circuitId: string, c: ProjectCircuit) => put<Project>(`/api/projects/${enc(projectId)}/circuits/${enc(circuitId)}`, c),
  removeCircuit:    (projectId: string, circuitId: string)                => delJson<Project>(`/api/projects/${enc(projectId)}/circuits/${enc(circuitId)}`),
  updateSldConfig:  (projectId: string, config: SldConfig)                => put<Project>(`/api/projects/${enc(projectId)}/sld-config`, config),

  // Technical Enrichment Lookups
  getTechLookup:    (table: TechLookupTable)                              => get<TechLookupItem[]>(`/api/tech-lookups/${enc(table)}`),
  createTechItem:   (table: TechLookupTable, item: TechLookupItem)        => post<TechLookupItem>(`/api/tech-lookups/${enc(table)}`, item),
  updateTechItem:   (table: TechLookupTable, id: string, data: Partial<TechLookupItem>) => put<TechLookupItem>(`/api/tech-lookups/${enc(table)}/${enc(id)}`, data),
  deleteTechItem:   (table: TechLookupTable, id: string)                  => del(`/api/tech-lookups/${enc(table)}/${enc(id)}`),

  // Solution Notes
  getSolutionNotes:     ()                                                   => get<SolutionNote[]>('/api/solution-notes'),

  // ── Hazards ── Server-side proxy over bushfire.io + USGS; the API key never
  // reaches the browser and the response is cached backend-side, so calling
  // this from every tab costs one upstream fetch per TTL window.
  getHazards:     (force = false) => get<HazardFeed>(`/api/hazards${force ? '?force=true' : ''}`),

  // ── KML / KMZ route geometry ── Two resolutions on purpose: getKmlPaths is
  // the SIMPLIFIED path for every segment (~1MB for the whole network, fetched
  // once), getKmlFullPath is one segment's surveyed detail, fetched only when
  // that segment is opened. Shipping full resolution for all 322 would be
  // ~39MB per page load to draw detail finer than a pixel.
  getKmlPaths:    () => get<KmlPathsResponse>('/api/kml/paths'),
  getKmlFullPath: (segmentId: string) => get<KmlFullPath>(`/api/kml/paths/${enc(segmentId)}`),
  getKmlLibrary:  () => get<{ linked: unknown[]; gaps: unknown[]; orphans: unknown[]; summary: Record<string, number> }>('/api/kml/library'),
  getKmlVersions: (segmentId: string) => get<{ segment_id: string; versions: Record<string, unknown>[] }>(`/api/kml/versions/${enc(segmentId)}`),
  /** Attach one KMZ/KML to one segment. Always creates a new version. A file
   *  holding several paths returns 409 with the candidates rather than guessing
   *  — guessing would attach a neighbouring cable and look entirely plausible. */
  uploadKml:      (segmentId: string, file: File, placemark?: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('segment_id', segmentId)
    if (placemark) form.append('placemark', placemark)
    return uploadForm<KmlUploadResult>('/api/kml/upload', form)
  },
  /** Parse and score a batch. Writes NOTHING — the review screen decides. Sent
   *  in batches so progress is visible and one failure does not lose the lot. */
  proposeKmlBatch: (files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    return uploadForm<KmlProposeResponse>('/api/kml/bulk/propose', form)
  },
  /** Attach the approved matches. Each becomes a new version on its segment. */
  commitKmlBatch: (accepted: { file_id: string; path_index: number; segment_id: string }[]) =>
    post<KmlCommitResponse>('/api/kml/bulk/commit', { accepted }),
  activateKml:    (linkId: string) => post<{ segment_id: string }>(`/api/kml/activate/${enc(linkId)}`, {}),
  deleteKml:      (linkId: string) => del(`/api/kml/link/${enc(linkId)}`),
  kmlDownloadUrl: (linkId: string) => `${BASE_URL}/api/kml/download/${enc(linkId)}`,
  createSolutionNote:   (data: SolutionNote)                                 => post<SolutionNote>('/api/solution-notes', data),
  updateSolutionNote:   (id: string, data: Partial<SolutionNote>)            => put<SolutionNote>(`/api/solution-notes/${enc(id)}`, data),
  deleteSolutionNote:   (id: string)                                         => del(`/api/solution-notes/${enc(id)}`),

  // Note Categories
  getNoteCategories:    ()                                                   => get<NoteCategory[]>('/api/note-categories'),
  createNoteCategory:   (data: NoteCategory)                                 => post<NoteCategory>('/api/note-categories', data),
  updateNoteCategory:   (id: string, data: Partial<NoteCategory>)            => put<NoteCategory>(`/api/note-categories/${enc(id)}`, data),
  deleteNoteCategory:   (id: string)                                         => del(`/api/note-categories/${enc(id)}`),

  // Feature Requests
  getFeatureRequests:    ()                                                         => get<FeatureRequest[]>('/api/feature-requests'),
  createFeatureRequest:  (data: { title: string; description: string; category: string }) => post<FeatureRequest>('/api/feature-requests', data),
}
