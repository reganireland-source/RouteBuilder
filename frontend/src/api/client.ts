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

import type { AppConfig, CableNode, CableSegment, CableSystem, CityInfo, CityPairResponse, FeatureRequest, InterfaceType, InterconnectRule, NlpParseResponse, NoteCategory, OutageParseResponse, Project, ProjectCircuit, RouteRequest, RouteResponse, SegmentCapacity, SegmentOutage, SldConfig, SolutionNote, TechLookupItem, TechLookupTable } from '../types'

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
 * POST an arbitrary multipart/form-data body (text fields and/or files). Used by
 * the Outage Parser, whose input can be pasted text, an image, or a spreadsheet.
 * The admin token is sent when unlocked. As with post(), FastAPI's `detail` is
 * surfaced in the thrown Error for the UI.
 */
async function postForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers: adminHeaders(), body: form })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json()).detail ?? '' } catch { /* ignore */ }
    throw new Error(`${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return res.json()
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
  updateNode:   (id: string, data: Partial<CableNode>)     => put<CableNode>(`/api/nodes/${id}`, data),
  deleteNode:   (id: string)                               => del(`/api/nodes/${id}`),

  // Segments
  createSegment:  (data: CableSegment)                       => post<CableSegment>('/api/segments', data),
  updateSegment:  (id: string, data: Partial<CableSegment>)  => put<CableSegment>(`/api/segments/${id}`, data),
  deleteSegment:  (id: string)                               => del(`/api/segments/${id}`),

  // Systems
  createSystem:   (data: CableSystem)                        => post<CableSystem>('/api/systems', data),
  updateSystem:   (id: string, data: Partial<CableSystem>)   => put<CableSystem>(`/api/systems/${id}`, data),
  deleteSystem:   (id: string)                               => del(`/api/systems/${id}`),

  // Capacity
  createCapacity: (data: SegmentCapacity)                           => post<SegmentCapacity>('/api/capacity', data),
  updateCapacity: (segId: string, data: Partial<SegmentCapacity>)   => put<SegmentCapacity>(`/api/capacity/${segId}`, data),
  deleteCapacity: (segId: string)                                   => del(`/api/capacity/${segId}`),

  // Outages
  getOutages:     ()                                                   => get<SegmentOutage[]>('/api/outages'),
  createOutage:   (data: SegmentOutage)                                => post<SegmentOutage>('/api/outages', data),
  updateOutage:   (faultId: string, data: Partial<SegmentOutage>)      => put<SegmentOutage>(`/api/outages/${faultId}`, data),
  deleteOutage:   (faultId: string)                                    => del(`/api/outages/${faultId}`),
  // Outage Parser: send pasted text and/or one-or-more files (screenshots pasted
  // from the clipboard, and/or a CSV/XLSX) to be parsed into proposed outages by
  // AI. Does not save. `replaceAllOutages` is the destructive "Accept All"
  // commit. Multiple images are sent as repeated `files` fields and read
  // together in a single vision call.
  parseOutages:   (text: string, files: File[])                        => {
    const form = new FormData()
    if (text) form.append('text', text)
    for (const f of files) form.append('files', f)
    return postForm<OutageParseResponse>('/api/outages/parse', form)
  },
  replaceAllOutages: (data: SegmentOutage[])                           => put<SegmentOutage[]>('/api/outages', data),

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
  bulkExportUrl: (table: string) => `${BASE_URL}/api/bulk/export/${table}`,
  bulkValidate: <T>(table: string, file: File, mode: string) =>
    uploadFile<T>(`/api/bulk/validate/${table}?mode=${mode}`, file),
  bulkImport: <T>(table: string, file: File, mode: string) =>
    uploadFile<T>(`/api/bulk/import/${table}?mode=${mode}`, file),

  // Rules
  getRules:     ()                                                  => get<InterconnectRule[]>('/api/rules'),
  createRule:   (data: InterconnectRule)                            => post<InterconnectRule>('/api/rules', data),
  updateRule:   (nodeId: string, data: Partial<InterconnectRule>)   => put<InterconnectRule>(`/api/rules/${nodeId}`, data),
  deleteRule:   (nodeId: string)                                    => del(`/api/rules/${nodeId}`),

  // Interface Types
  getInterfaces:    ()                                                    => get<InterfaceType[]>('/api/interfaces'),
  createInterface:  (data: InterfaceType)                                 => post<InterfaceType>('/api/interfaces', data),
  updateInterface:  (id: string, data: Partial<InterfaceType>)            => put<InterfaceType>(`/api/interfaces/${id}`, data),
  deleteInterface:  (id: string)                                          => del(`/api/interfaces/${id}`),

  // Projects
  getProjects:      ()                                                    => get<Project[]>('/api/projects'),
  createProject:    (data: Project)                                       => post<Project>('/api/projects', data),
  updateProject:    (id: string, data: Partial<Project>)                  => put<Project>(`/api/projects/${id}`, data),
  deleteProject:    (id: string)                                          => del(`/api/projects/${id}`),
  addCircuit:       (projectId: string, circuit: ProjectCircuit)          => post<Project>(`/api/projects/${projectId}/circuits`, circuit),
  updateCircuit:    (projectId: string, circuitId: string, c: ProjectCircuit) => put<Project>(`/api/projects/${projectId}/circuits/${circuitId}`, c),
  removeCircuit:    (projectId: string, circuitId: string)                => delJson<Project>(`/api/projects/${projectId}/circuits/${circuitId}`),
  updateSldConfig:  (projectId: string, config: SldConfig)                => put<Project>(`/api/projects/${projectId}/sld-config`, config),

  // Technical Enrichment Lookups
  getTechLookup:    (table: TechLookupTable)                              => get<TechLookupItem[]>(`/api/tech-lookups/${table}`),
  createTechItem:   (table: TechLookupTable, item: TechLookupItem)        => post<TechLookupItem>(`/api/tech-lookups/${table}`, item),
  updateTechItem:   (table: TechLookupTable, id: string, data: Partial<TechLookupItem>) => put<TechLookupItem>(`/api/tech-lookups/${table}/${id}`, data),
  deleteTechItem:   (table: TechLookupTable, id: string)                  => del(`/api/tech-lookups/${table}/${id}`),

  // Solution Notes
  getSolutionNotes:     ()                                                   => get<SolutionNote[]>('/api/solution-notes'),
  createSolutionNote:   (data: SolutionNote)                                 => post<SolutionNote>('/api/solution-notes', data),
  updateSolutionNote:   (id: string, data: Partial<SolutionNote>)            => put<SolutionNote>(`/api/solution-notes/${id}`, data),
  deleteSolutionNote:   (id: string)                                         => del(`/api/solution-notes/${id}`),

  // Note Categories
  getNoteCategories:    ()                                                   => get<NoteCategory[]>('/api/note-categories'),
  createNoteCategory:   (data: NoteCategory)                                 => post<NoteCategory>('/api/note-categories', data),
  updateNoteCategory:   (id: string, data: Partial<NoteCategory>)            => put<NoteCategory>(`/api/note-categories/${id}`, data),
  deleteNoteCategory:   (id: string)                                         => del(`/api/note-categories/${id}`),

  // Feature Requests
  getFeatureRequests:    ()                                                         => get<FeatureRequest[]>('/api/feature-requests'),
  createFeatureRequest:  (data: { title: string; description: string; category: string }) => post<FeatureRequest>('/api/feature-requests', data),
}
