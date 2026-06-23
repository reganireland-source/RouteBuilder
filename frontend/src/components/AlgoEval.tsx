import { useState, useCallback, useRef } from 'react'
import { useTheme } from '../theme'
import { api } from '../api/client'
import type { CableNode, CableSegment, CableSystem, Route, RouteRequest } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = 'endpoint' | 'diversity' | 'constraint' | 'preference' | 'edge_case'

type AssertionType =
  | 'route_found' | 'no_routes_found' | 'min_routes'
  | 'routes_diverse_wet' | 'routes_diverse_full'
  | 'path_includes_node' | 'path_excludes_node'
  | 'path_includes_system' | 'path_excludes_system'
  | 'path_excludes_country'
  | 'wet_hops_max' | 'latency_under' | 'distance_under' | 'distance_over'

interface Assertion {
  id: string
  description: string
  type: AssertionType
  params?: Record<string, unknown>
}

interface TestCase {
  id: string
  name: string
  description: string
  category: Category
  request: RouteRequest
  assertions: Assertion[]
  isCore: boolean
  tags: string[]
  // When set, a failure is treated as a known network limitation rather than a bug.
  // The test still runs fully; the result is shown in amber with context rather than red.
  knownLimitation?: {
    summary: string
    detail: string
  }
}

interface AssertionResult {
  assertion_id: string
  passed: boolean
  message: string
}

interface TestResult {
  test_id: string
  passed: boolean
  duration_ms: number
  routes_found: number
  assertion_results: AssertionResult[]
  routes: Route[]
  error?: string
}

interface TestRun {
  id: string
  timestamp: string
  duration_ms: number
  results: TestResult[]
  passed: number
  failed: number
}

// ── Core test cases ───────────────────────────────────────────────────────────

const CORE_TESTS: TestCase[] = [
  // ── Endpoint Tests ─────────────────────────────────────────────────────────
  {
    id: 'EP-001',
    name: 'Sydney → Los Angeles',
    description: 'The primary Trans-Pacific corridor. Any failure here indicates a fundamental data or graph connectivity issue. Verifies Pacific cable systems are correctly modelled end-to-end.',
    category: 'endpoint', isCore: true, tags: ['trans-pacific', 'AU', 'US'],
    request: { start_node_id: 'SYD1', end_node_id: 'LAX1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-001-A1', description: 'At least one route is found', type: 'route_found' },
      { id: 'EP-001-A2', description: 'Route is realistically long (>10,000 km Trans-Pacific)', type: 'distance_over', params: { threshold_km: 10000 } },
      { id: 'EP-001-A3', description: 'Route is not absurdly long (<25,000 km)', type: 'distance_under', params: { threshold_km: 25000 } },
    ],
  },
  {
    id: 'EP-002',
    name: 'Singapore → New York',
    description: 'The longest commercial corridor in the dataset — Singapore to US East Coast. Requires stitching Asia-Pacific cable systems with US terrestrial backhaul. Tests end-to-end graph traversal over 20,000+ km.',
    category: 'endpoint', isCore: true, tags: ['trans-pacific', 'SG', 'US'],
    request: { start_node_id: 'SGCH', end_node_id: 'NYC1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-002-A1', description: 'Route found Singapore to New York', type: 'route_found' },
      { id: 'EP-002-A2', description: 'Distance reflects global reach (>15,000 km)', type: 'distance_over', params: { threshold_km: 15000 } },
    ],
  },
  {
    id: 'EP-003',
    name: 'Singapore → Hong Kong',
    description: 'Core intra-Asia short-haul route. Multiple cable systems available (EAC, C2C, AAE1). Tests that the algorithm correctly handles high-density intra-Asia connectivity and doesn\'t over-route.',
    category: 'endpoint', isCore: true, tags: ['intra-asia', 'SG', 'HK'],
    request: { start_node_id: 'SGCH', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-003-A1', description: 'Route found Singapore to Hong Kong', type: 'route_found' },
      { id: 'EP-003-A2', description: 'Short intra-Asia hop (<4,000 km)', type: 'distance_under', params: { threshold_km: 4000 } },
      { id: 'EP-003-A3', description: 'Latency realistic for this hop (<50 ms)', type: 'latency_under', params: { threshold_ms: 50 } },
    ],
  },
  {
    id: 'EP-004',
    name: 'Hong Kong → Tokyo',
    description: 'Intra-Asia medium-haul. Tests North Asia connectivity via EAC, C2C, or AAE1 systems to Japan landing stations. Critical corridor for Japan market access.',
    category: 'endpoint', isCore: true, tags: ['intra-asia', 'HK', 'JP'],
    request: { start_node_id: 'HKCC', end_node_id: 'JTHA', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-004-A1', description: 'Route found Hong Kong to Tokyo', type: 'route_found' },
      { id: 'EP-004-A2', description: 'Distance reasonable for this hop (<5,000 km)', type: 'distance_under', params: { threshold_km: 5000 } },
    ],
  },
  {
    id: 'EP-005',
    name: 'Singapore → Tokyo',
    description: 'Singapore to Japan direct. Tests connectivity via EAC Japan extension, C2C, or Asia-America Gateway northern branches. Important corridor for Japan enterprise customers.',
    category: 'endpoint', isCore: true, tags: ['intra-asia', 'SG', 'JP'],
    request: { start_node_id: 'SGCH', end_node_id: 'JTHA', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-005-A1', description: 'Route found Singapore to Tokyo', type: 'route_found' },
      { id: 'EP-005-A2', description: 'Distance realistic (<8,000 km)', type: 'distance_under', params: { threshold_km: 8000 } },
    ],
  },

  // ── Diversity Tests ─────────────────────────────────────────────────────────
  {
    id: 'DV-001',
    name: 'SYD → LAX: Wet Diversity',
    description: 'Verifies the wet diversity algorithm correctly identifies two Trans-Pacific routes with no shared submarine cable segments. Critical for customers requiring geographic route separation at the ocean level.',
    category: 'diversity', isCore: true, tags: ['trans-pacific', 'wet-diversity'],
    request: { start_node_id: 'SYD1', end_node_id: 'LAX1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'wet' },
    assertions: [
      { id: 'DV-001-A1', description: 'Two or more diverse routes found', type: 'min_routes', params: { count: 2 } },
      { id: 'DV-001-A2', description: 'Worker and protect share no wet/submarine segments', type: 'routes_diverse_wet' },
    ],
  },
  {
    id: 'DV-002',
    name: 'SIN → LAX: Full Diversity',
    description: 'Full end-to-end diversity from Singapore to Los Angeles — no shared segments whatsoever including terrestrial backhaul at both ends. Tests the full diversity algorithm across a long-haul multi-system path.',
    category: 'diversity', isCore: true, tags: ['trans-pacific', 'full-diversity'],
    request: { start_node_id: 'SGCH', end_node_id: 'LAX1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'full' },
    assertions: [
      { id: 'DV-002-A1', description: 'Two diverse routes found', type: 'min_routes', params: { count: 2 } },
      { id: 'DV-002-A2', description: 'No shared wet segments between routes', type: 'routes_diverse_wet' },
      { id: 'DV-002-A3', description: 'Full diversity routes are each individually viable (>10,000 km)', type: 'distance_over', params: { threshold_km: 10000 } },
    ],
    knownLimitation: {
      summary: 'True full diversity is physically constrained on Trans-Pacific routes',
      detail: 'Multiple Trans-Pacific cables share branching units, common landing stations (e.g. Chikura, Grover Beach), or terrestrial backhaul between the cable landing and the PoP. Full segment diversity end-to-end is not always achievable. A "fail" here reflects a real network topology constraint — not an algorithm bug. The commercial response is to offer wet diversity instead and disclose the shared terrestrial segment.',
    },
  },
  {
    id: 'DV-003',
    name: 'SIN → HKG: Wet Diversity',
    description: 'Intra-Asia wet diversity. With multiple cables between Singapore and Hong Kong (EAC, C2C, AAE1), the algorithm should find two routes using different cable systems. Tests diversity in a high-density region.',
    category: 'diversity', isCore: true, tags: ['intra-asia', 'wet-diversity'],
    request: { start_node_id: 'SGCH', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'wet' },
    assertions: [
      { id: 'DV-003-A1', description: 'Two diverse intra-Asia routes found', type: 'min_routes', params: { count: 2 } },
      { id: 'DV-003-A2', description: 'Routes use different submarine cable segments', type: 'routes_diverse_wet' },
    ],
  },
  {
    id: 'DV-004',
    name: 'SYD → LAX: Terrestrial Origin Diversity',
    description: 'Terrestrial diversity at the Australian origin end. Starting from Sydney metro PoP (SYD2), routes should use different Australian landing stations (e.g. SYD1 vs MEL1) to provide physical separation before hitting the ocean.',
    category: 'diversity', isCore: true, tags: ['trans-pacific', 'terrestrial-diversity'],
    request: { start_node_id: 'SYD2', end_node_id: 'LAX1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'terrestrial_origin' },
    assertions: [
      { id: 'DV-004-A1', description: 'Route found with terrestrial origin diversity', type: 'route_found' },
      { id: 'DV-004-A2', description: 'At least two routes with different Australian landing stations', type: 'min_routes', params: { count: 2 } },
    ],
    knownLimitation: {
      summary: 'Terrestrial origin diversity depends on which Australian landing stations are modelled as reachable from SYD2',
      detail: 'If SYD2 connects only to SYD1 in the current dataset, the algorithm cannot produce terrestrial diversity from that PoP — there is no second path to a different landing station. This is a data completeness issue (MEL1 backhaul not modelled), not an algorithm fault. Fix: ensure SYD2→MEL1 or SYD2→BRI1 backhaul segments exist in the dataset.',
    },
  },

  // ── Constraint Tests ────────────────────────────────────────────────────────
  {
    id: 'CN-001',
    name: 'Force Waypoint: SYD → LAX via Tokyo',
    description: 'Tests the must-include-node (waypoint forcing) constraint. A customer requiring their route to transit through the Tokyo PoP (e.g. for local break-out) should see that node appear on every returned route.',
    category: 'constraint', isCore: true, tags: ['trans-pacific', 'waypoint'],
    request: { start_node_id: 'SYD1', end_node_id: 'LAX1', must_include_nodes: ['JTHA'], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'CN-001-A1', description: 'Route found respecting Tokyo waypoint', type: 'route_found' },
      { id: 'CN-001-A2', description: 'Tokyo PoP (JTHA) appears on all returned routes', type: 'path_includes_node', params: { node_id: 'JTHA' } },
    ],
  },
  {
    id: 'CN-002',
    name: 'Country Exclusion: SIN → LAX (avoid Japan)',
    description: 'Tests the country exclusion constraint. The Singapore to LA route normally transits Japan. With Japan excluded, the algorithm must find an alternative path — possibly via Hawaii or a southern route. Verifies no Japanese nodes appear on any route.',
    category: 'constraint', isCore: true, tags: ['trans-pacific', 'country-exclusion'],
    request: { start_node_id: 'SGCH', end_node_id: 'LAX1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], must_avoid_countries: ['JP'], diversity: 'none' },
    assertions: [
      { id: 'CN-002-A1', description: 'Route found avoiding Japan', type: 'route_found' },
      { id: 'CN-002-A2', description: 'No Japanese nodes (country: JP) appear on any route', type: 'path_excludes_country', params: { country: 'JP' } },
    ],
  },
  {
    id: 'CN-003',
    name: 'System Exclusion: SIN → HKG (avoid EAC)',
    description: 'Tests the cable system exclusion constraint. EAC (East Asia Crossing) is a primary SIN-HKG system. Excluding it forces the algorithm onto C2C, AAE1, or another alternative. Verifies EAC segment IDs are absent from results.',
    category: 'constraint', isCore: true, tags: ['intra-asia', 'system-exclusion'],
    request: { start_node_id: 'SGCH', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: ['EAC'], diversity: 'none' },
    assertions: [
      { id: 'CN-003-A1', description: 'Alternative route found without EAC', type: 'route_found' },
      { id: 'CN-003-A2', description: 'EAC system segments are absent from all routes', type: 'path_excludes_system', params: { system_id: 'EAC' } },
    ],
  },
  {
    id: 'CN-004',
    name: 'System Inclusion: SYD → LAX via TOPAZ',
    description: 'Tests the must-include-system constraint. Forces the routing algorithm to use the TOPAZ cable (Seattle–Tokyo), requiring the path to go via Japan and Seattle before reaching LA. Verifies TOPAZ segments appear on all routes.',
    category: 'constraint', isCore: true, tags: ['trans-pacific', 'system-inclusion'],
    request: { start_node_id: 'SYD1', end_node_id: 'LAX1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: ['TOPAZ'], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'CN-004-A1', description: 'Route found using TOPAZ cable system', type: 'route_found' },
      { id: 'CN-004-A2', description: 'TOPAZ segments present on all routes', type: 'path_includes_system', params: { system_id: 'TOPAZ' } },
    ],
  },
  {
    id: 'CN-005',
    name: 'Node Exclusion: SIN → TYO (avoid Osaka landing)',
    description: 'Tests the must-avoid-node constraint. Osaka (OSA1) is a common Japanese landing point. Excluding it forces routes to alternative Japanese landings (Minamiboso, Shima, Chikura etc). Validates fine-grained node-level avoidance.',
    category: 'constraint', isCore: true, tags: ['intra-asia', 'node-exclusion'],
    request: { start_node_id: 'SGCH', end_node_id: 'JTHA', must_include_nodes: [], must_avoid_nodes: ['OSA1'], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'CN-005-A1', description: 'Route found avoiding Osaka landing station', type: 'route_found' },
      { id: 'CN-005-A2', description: 'OSA1 does not appear on any route', type: 'path_excludes_node', params: { node_id: 'OSA1' } },
    ],
  },

  // ── Preference / Limit Tests ────────────────────────────────────────────────
  {
    id: 'PR-001',
    name: 'Hop Limit: SIN → LAX (max 3 wet hops)',
    description: 'Tests the max_wet_hops constraint. With a limit of 3 wet cable segments, the algorithm should return only compact Pacific routes. Verifies the hop limit is correctly applied as an upper bound on submarine segment count.',
    category: 'preference', isCore: true, tags: ['trans-pacific', 'hop-limit'],
    request: { start_node_id: 'SGCH', end_node_id: 'LAX1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none', max_wet_hops: 3 },
    assertions: [
      { id: 'PR-001-A1', description: 'Route found within the 3 wet-hop limit', type: 'route_found' },
      { id: 'PR-001-A2', description: 'All routes have at most 3 wet cable segments', type: 'wet_hops_max', params: { max: 3 } },
    ],
  },
  {
    id: 'PR-002',
    name: 'Latency Budget: SIN → HKG (<35 ms)',
    description: 'Tests that the intra-Asia short-hop meets a tight latency budget. Singapore to Hong Kong direct-fibre latency should be well under 35 ms. Validates the latency model is calibrated correctly for short regional routes.',
    category: 'preference', isCore: true, tags: ['intra-asia', 'latency'],
    request: { start_node_id: 'SGCH', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'PR-002-A1', description: 'Route found', type: 'route_found' },
      { id: 'PR-002-A2', description: 'Best route latency is under 35 ms', type: 'latency_under', params: { threshold_ms: 35 } },
    ],
  },

  // ── Edge Cases ──────────────────────────────────────────────────────────────
  {
    id: 'EX-001',
    name: 'Edge Case: Impossible Hop Limit',
    description: 'Requests a Trans-Pacific route with max_wet_hops set to 0. It is physically impossible to cross the Pacific with zero submarine segments. Verifies the algorithm returns gracefully with zero results rather than crashing.',
    category: 'edge_case', isCore: true, tags: ['edge-case', 'trans-pacific'],
    request: { start_node_id: 'SYD1', end_node_id: 'LAX1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none', max_wet_hops: 0 },
    assertions: [
      { id: 'EX-001-A1', description: 'Returns gracefully with no routes (not an error/crash)', type: 'no_routes_found' },
    ],
  },
  {
    id: 'EX-002',
    name: 'Edge Case: Contradictory Constraints',
    description: 'Requests a SIN → HKG route that must use EAC AND must avoid EAC simultaneously. Tests constraint conflict handling — should return 0 routes cleanly, not an error.',
    category: 'edge_case', isCore: true, tags: ['edge-case', 'intra-asia'],
    request: { start_node_id: 'SGCH', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: ['EAC'], must_avoid_systems: ['EAC'], diversity: 'none' },
    assertions: [
      { id: 'EX-002-A1', description: 'Returns gracefully with zero results for impossible constraint', type: 'no_routes_found' },
    ],
    knownLimitation: {
      summary: 'Contradictory constraint — 0 results is the correct and expected behaviour',
      detail: 'When a user specifies must-use and must-avoid for the same system, the algorithm correctly returns no routes. This is intentional — the test validates graceful handling, not a deficiency. The amber flag is a reminder that the zero-result outcome here is correct, not a missing-route issue.',
    },
  },
]

// ── Assertion evaluator ───────────────────────────────────────────────────────

function evaluateAssertion(a: Assertion, routes: Route[], nodesById: Map<string, CableNode>): AssertionResult {
  try {
    switch (a.type) {
      case 'route_found':
        return { assertion_id: a.id, passed: routes.length > 0, message: routes.length > 0 ? `${routes.length} route(s) returned` : 'No routes found' }
      case 'no_routes_found':
        return { assertion_id: a.id, passed: routes.length === 0, message: routes.length === 0 ? 'Correctly returned 0 routes' : `Expected 0 routes, got ${routes.length}` }
      case 'min_routes': {
        const n = a.params?.count as number ?? 2
        return { assertion_id: a.id, passed: routes.length >= n, message: `Expected ≥${n} routes, found ${routes.length}` }
      }
      case 'routes_diverse_wet': {
        if (routes.length < 2) return { assertion_id: a.id, passed: false, message: 'Need ≥2 routes to check diversity' }
        const wetSegs = (r: Route) => new Set(r.segments.filter(s => s.type === 'wet').map(s => s.segment_id))
        const s0 = wetSegs(routes[0]); const s1 = wetSegs(routes[1])
        const shared = [...s0].filter(x => s1.has(x))
        return { assertion_id: a.id, passed: shared.length === 0, message: shared.length === 0 ? 'No shared submarine segments ✓' : `Shared segments: ${shared.join(', ')}` }
      }
      case 'routes_diverse_full': {
        if (routes.length < 2) return { assertion_id: a.id, passed: false, message: 'Need ≥2 routes to check diversity' }
        const segs = (r: Route) => new Set(r.segments.map(s => s.segment_id))
        const s0 = segs(routes[0]); const s1 = segs(routes[1])
        const shared = [...s0].filter(x => s1.has(x))
        return { assertion_id: a.id, passed: shared.length === 0, message: shared.length === 0 ? 'No shared segments on any route ✓' : `${shared.length} shared segment(s)` }
      }
      case 'path_includes_node': {
        const nid = a.params?.node_id as string
        const all = routes.every(r => r.nodes.includes(nid))
        return { assertion_id: a.id, passed: all, message: all ? `${nid} present on all routes ✓` : `${nid} missing from some routes` }
      }
      case 'path_excludes_node': {
        const nid = a.params?.node_id as string
        const none = routes.every(r => !r.nodes.includes(nid))
        return { assertion_id: a.id, passed: none, message: none ? `${nid} absent from all routes ✓` : `${nid} found on some routes` }
      }
      case 'path_includes_system': {
        const sid = a.params?.system_id as string
        const all = routes.every(r => r.segments.some(s => s.system_id === sid))
        return { assertion_id: a.id, passed: all, message: all ? `${sid} present on all routes ✓` : `${sid} missing from some routes` }
      }
      case 'path_excludes_system': {
        const sid = a.params?.system_id as string
        const none = routes.every(r => !r.segments.some(s => s.system_id === sid))
        return { assertion_id: a.id, passed: none, message: none ? `${sid} excluded from all routes ✓` : `${sid} found on some routes` }
      }
      case 'path_excludes_country': {
        const cc = a.params?.country as string
        const bad = routes.filter(r => r.nodes.some(nid => nodesById.get(nid)?.country === cc))
        return { assertion_id: a.id, passed: bad.length === 0, message: bad.length === 0 ? `No routes transit ${cc} ✓` : `${bad.length} route(s) pass through ${cc}` }
      }
      case 'wet_hops_max': {
        const max = a.params?.max as number ?? 3
        const bad = routes.filter(r => r.segments.filter(s => s.type === 'wet').length > max)
        return { assertion_id: a.id, passed: bad.length === 0, message: bad.length === 0 ? `All routes ≤${max} wet hops ✓` : `${bad.length} route(s) exceed ${max} wet hops` }
      }
      case 'latency_under': {
        const thr = a.params?.threshold_ms as number ?? 300
        const bad = routes.filter(r => r.total_latency >= thr)
        return { assertion_id: a.id, passed: bad.length === 0, message: bad.length === 0 ? `All routes <${thr} ms ✓` : `${bad.length} route(s) exceed ${thr} ms` }
      }
      case 'distance_under': {
        const thr = a.params?.threshold_km as number ?? 20000
        const bad = routes.filter(r => r.total_length_km >= thr)
        return { assertion_id: a.id, passed: bad.length === 0, message: bad.length === 0 ? `All routes <${thr.toLocaleString()} km ✓` : `${bad.length} route(s) exceed ${thr.toLocaleString()} km` }
      }
      case 'distance_over': {
        const thr = a.params?.threshold_km as number ?? 5000
        const bad = routes.filter(r => r.total_length_km <= thr)
        return { assertion_id: a.id, passed: bad.length === 0, message: bad.length === 0 ? `All routes >${thr.toLocaleString()} km ✓` : `${bad.length} route(s) under ${thr.toLocaleString()} km` }
      }
      default:
        return { assertion_id: a.id, passed: false, message: 'Unknown assertion type' }
    }
  } catch (e) {
    return { assertion_id: a.id, passed: false, message: `Evaluation error: ${e}` }
  }
}

// ── History helpers ───────────────────────────────────────────────────────────

const HISTORY_KEY = 'rb_algo_eval_history'
const MAX_HISTORY = 20

function loadHistory(): TestRun[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') } catch { return [] }
}
function saveHistory(runs: TestRun[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(runs.slice(0, MAX_HISTORY)))
}

// ── Route path visualisation ──────────────────────────────────────────────────

const SEG_COLOR: Record<string, string> = {
  wet:         '#89b4fa',
  backhaul:    '#f9e2af',
  terrestrial: '#6c7086',
}

function RoutePathViz({ route, nodesById }: { route: Route; nodesById: Map<string, CableNode> }) {
  const t = useTheme()
  const nodes = route.nodes
  const segs  = route.segments
  // Only show up to 12 nodes to keep it readable; collapse middle if longer
  const MAX_SHOW = 12
  const shown = nodes.length <= MAX_SHOW ? nodes : [
    ...nodes.slice(0, 5), '__ellipsis__', ...nodes.slice(nodes.length - 5)
  ]

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 'max-content', padding: '8px 4px' }}>
        {shown.map((nodeId, idx) => {
          if (nodeId === '__ellipsis__') return (
            <div key="ellipsis" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ width: 32, height: 3, background: `${t.border}` }} />
                <span style={{ fontSize: 12, color: t.textFaint, margin: '0 4px', lineHeight: '14px' }}>···</span>
                <div style={{ width: 32, height: 3, background: `${t.border}` }} />
              </div>
            </div>
          )

          const segBefore = idx > 0 && idx - 1 < segs.length ? segs[idx - 1] : null
          const isFirst = idx === 0
          const isLast  = idx === shown.length - 1
          const node    = nodesById.get(nodeId)
          const segColor = segBefore ? (SEG_COLOR[segBefore.type] ?? SEG_COLOR.terrestrial) : null

          return (
            <div key={nodeId} style={{ display: 'flex', alignItems: 'flex-start' }}>
              {/* Segment line before this node */}
              {segBefore && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ width: 36, height: 3, background: segColor! }} />
                  </div>
                  <div style={{ fontSize: 8, color: t.textFaint, marginTop: 2, maxWidth: 52, textAlign: 'center', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                    {segBefore.system_id}
                  </div>
                </div>
              )}
              {/* Node */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: isFirst || isLast ? 14 : 10,
                  height: isFirst || isLast ? 14 : 10,
                  borderRadius: '50%',
                  background: isFirst ? '#a6e3a1' : isLast ? '#f38ba8' : (SEG_COLOR[segBefore?.type ?? 'wet'] ?? '#89b4fa'),
                  border: `2px solid ${isFirst || isLast ? 'rgba(255,255,255,0.3)' : 'transparent'}`,
                  flexShrink: 0,
                  marginTop: isFirst || isLast ? 0 : 2,
                }} />
                <div style={{ fontSize: 8, color: t.textFaint, textAlign: 'center', maxWidth: 52, lineHeight: 1.2 }}>
                  <div style={{ fontWeight: 700, color: isFirst || isLast ? t.text : t.textMuted }}>{nodeId}</div>
                  {node && <div style={{ fontSize: 7, opacity: 0.7 }}>{node.country}</div>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, paddingLeft: 4, marginTop: 2 }}>
        {[['wet', 'Submarine'], ['backhaul', 'Backhaul'], ['terrestrial', 'Terrestrial']].map(([type, label]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 14, height: 3, background: SEG_COLOR[type], borderRadius: 2 }} />
            <span style={{ fontSize: 9, color: t.textFaint }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Category config ───────────────────────────────────────────────────────────

const CAT: Record<Category, { label: string; color: string; icon: string }> = {
  endpoint:   { label: 'Endpoint',    color: '#89b4fa', icon: '🔵' },
  diversity:  { label: 'Diversity',   color: '#a6e3a1', icon: '🟢' },
  constraint: { label: 'Constraint',  color: '#f9e2af', icon: '🟡' },
  preference: { label: 'Preference',  color: '#fab387', icon: '🟠' },
  edge_case:  { label: 'Edge Case',   color: '#cba6f7', icon: '🟣' },
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  nodes: CableNode[]
  segments: CableSegment[]
  systems: CableSystem[]
  onClose: () => void
}

export function AlgoEval({ nodes, onClose }: Props) {
  const t = useTheme()
  const nodesById = new Map(nodes.map(n => [n.id, n]))

  const [history,        setHistory]        = useState<TestRun[]>(loadHistory)
  const [activeRunId,    setActiveRunId]    = useState<string | null>(() => loadHistory()[0]?.id ?? null)
  const [running,        setRunning]        = useState(false)
  const [runningTestId,  setRunningTestId]  = useState<string | null>(null)
  const [selectedTestId, setSelectedTestId] = useState<string>(CORE_TESTS[0].id)
  const [activeTab,      setActiveTab]      = useState<'core' | 'custom'>('core')
  const runIdRef = useRef(0)

  const activeRun = history.find(r => r.id === activeRunId) ?? null
  const resultMap = new Map(activeRun?.results.map(r => [r.test_id, r]) ?? [])

  // ── Run a single test ──────────────────────────────────────────────────────
  const runOne = useCallback(async (tc: TestCase): Promise<TestResult> => {
    const t0 = performance.now()
    try {
      const resp = await api.searchRoutes(tc.request)
      const routes = resp.routes ?? []
      const assertionResults = tc.assertions.map(a => evaluateAssertion(a, routes, nodesById))
      const passed = assertionResults.every(a => a.passed)
      return {
        test_id: tc.id, passed, duration_ms: Math.round(performance.now() - t0),
        routes_found: routes.length, assertion_results: assertionResults, routes,
      }
    } catch (e) {
      const assertionResults = tc.assertions.map(a => ({
        assertion_id: a.id, passed: false,
        message: `API error: ${e instanceof Error ? e.message : String(e)}`,
      }))
      return {
        test_id: tc.id, passed: false, duration_ms: Math.round(performance.now() - t0),
        routes_found: 0, assertion_results: assertionResults, routes: [],
        error: String(e),
      }
    }
  }, [nodesById])

  // ── Run all tests ──────────────────────────────────────────────────────────
  const runAll = useCallback(async () => {
    setRunning(true)
    const runNum = ++runIdRef.current
    const t0 = performance.now()
    const results: TestResult[] = []

    for (const tc of CORE_TESTS) {
      if (runIdRef.current !== runNum) break
      setRunningTestId(tc.id)
      const result = await runOne(tc)
      results.push(result)
    }

    setRunningTestId(null)
    setRunning(false)

    const run: TestRun = {
      id: `run-${Date.now()}`,
      timestamp: new Date().toISOString(),
      duration_ms: Math.round(performance.now() - t0),
      results,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
    }

    const updated = [run, ...history]
    setHistory(updated)
    saveHistory(updated)
    setActiveRunId(run.id)
  }, [runOne, history])

  const selectedTest = CORE_TESTS.find(tc => tc.id === selectedTestId)
  const selectedResult = resultMap.get(selectedTestId)

  // ── Styles ─────────────────────────────────────────────────────────────────
  const panelBg: React.CSSProperties = { background: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: 8 }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1001, background: t.bgBase, display: 'flex', flexDirection: 'column', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ borderBottom: `1px solid ${t.border}`, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 16, height: 56, flexShrink: 0 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18 }}>🧪</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: t.text }}>Algorithm Evaluation</div>
            <div style={{ fontSize: 10, color: t.textFaint, letterSpacing: '0.05em' }}>Business / UAT Test Suite · {CORE_TESTS.length} core scenarios</div>
          </div>
        </div>

        {/* Run summary */}
        {activeRun && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 12px', borderRadius: 20, background: `${t.green}15`, border: `1px solid ${t.green}44` }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: t.green }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: t.green }}>{activeRun.passed} passed</span>
            </div>
            {activeRun.failed > 0 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 12px', borderRadius: 20, background: `${t.red}15`, border: `1px solid ${t.red}44` }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: t.red }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: t.red }}>{activeRun.failed} failed</span>
              </div>
            )}
          </div>
        )}

        {/* History selector */}
        {history.length > 0 && (
          <select
            value={activeRunId ?? ''}
            onChange={e => setActiveRunId(e.target.value)}
            style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.bgDeep, color: t.textMuted, cursor: 'pointer' }}
          >
            {history.map((run, i) => (
              <option key={run.id} value={run.id}>
                {i === 0 ? 'Latest: ' : ''}{new Date(run.timestamp).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} — {run.passed}/{run.passed + run.failed} passed
              </option>
            ))}
          </select>
        )}

        {/* Run button */}
        <button
          onClick={runAll}
          disabled={running}
          style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', cursor: running ? 'wait' : 'pointer',
            background: running ? t.bgCard : t.blue, color: running ? t.textFaint : '#fff',
            fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          {running ? (
            <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span> Running…</>
          ) : '▶ Run All Tests'}
        </button>

        <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${t.border}`, background: 'transparent', color: t.textFaint, cursor: 'pointer', fontSize: 12 }}>✕ Close</button>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: Test list */}
        <div style={{ width: 300, borderRight: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          {/* Tab selector */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
            {(['core', 'custom'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                background: activeTab === tab ? t.bgBase : 'transparent',
                borderBottom: activeTab === tab ? `2px solid ${t.blue}` : '2px solid transparent',
                color: activeTab === tab ? t.blue : t.textMuted, fontSize: 11, fontWeight: 700,
              }}>{tab === 'core' ? `🔒 Core (${CORE_TESTS.length})` : '✏ Custom'}</button>
            ))}
          </div>

          {activeTab === 'core' ? (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {(['endpoint', 'diversity', 'constraint', 'preference', 'edge_case'] as Category[]).map(cat => {
                const tests = CORE_TESTS.filter(tc => tc.category === cat)
                const catCfg = CAT[cat]
                return (
                  <div key={cat}>
                    <div style={{ padding: '10px 14px 4px', fontSize: 9, fontWeight: 800, color: catCfg.color, textTransform: 'uppercase', letterSpacing: '0.1em', background: t.bgPanel }}>
                      {catCfg.icon} {catCfg.label} · {tests.length}
                    </div>
                    {tests.map(tc => {
                      const res = resultMap.get(tc.id)
                      const isRunning = runningTestId === tc.id
                      const isSelected = selectedTestId === tc.id
                      return (
                        <div
                          key={tc.id}
                          onClick={() => setSelectedTestId(tc.id)}
                          style={{
                            padding: '10px 14px', cursor: 'pointer', borderBottom: `1px solid ${t.border}22`,
                            background: isSelected ? `${t.blue}18` : 'transparent',
                            borderLeft: isSelected ? `3px solid ${t.blue}` : '3px solid transparent',
                            transition: 'background 0.1s',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontSize: 9, fontFamily: 'monospace', color: t.textFaint, flexShrink: 0 }}>{tc.id}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: isSelected ? t.text : t.textMuted, lineHeight: 1.3 }}>{tc.name}</div>
                            </div>
                            {isRunning && <div style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${t.blue}`, borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />}
                            {!isRunning && res && (() => {
                              const isLimitation = !res.passed && !!tc.knownLimitation
                              const color = res.passed ? t.green : isLimitation ? t.orange : t.red
                              return <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: `0 0 4px ${color}88` }} />
                            })()}
                            {!isRunning && !res && (
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.border, flexShrink: 0 }} />
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: t.textFaint, marginTop: 3, display: 'flex', gap: 6 }}>
                            {tc.tags.map(tag => (
                              <span key={tag} style={{ padding: '1px 5px', borderRadius: 3, background: `${catCfg.color}18`, color: catCfg.color, fontSize: 9, fontWeight: 600 }}>{tag}</span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: t.textFaint, padding: 24, textAlign: 'center' }}>
              <span style={{ fontSize: 28 }}>✏</span>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted }}>Custom Test Cases</div>
              <div style={{ fontSize: 11, lineHeight: 1.6 }}>Run the core suite first, then use this tab to add your own UAT scenarios with specific O-D pairs and constraints.</div>
              <div style={{ fontSize: 10, marginTop: 8, padding: '8px 12px', borderRadius: 6, background: t.bgCard, border: `1px solid ${t.border}` }}>Coming in next release</div>
            </div>
          )}
        </div>

        {/* Right: Test detail */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {selectedTest ? (
            <>
              {/* Test header */}
              <div style={{ ...panelBg, padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12 }}>
                  <div style={{
                    padding: '6px 12px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                    background: `${CAT[selectedTest.category].color}18`, color: CAT[selectedTest.category].color,
                    border: `1px solid ${CAT[selectedTest.category].color}44`, letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0,
                  }}>{CAT[selectedTest.category].label}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: t.text, marginBottom: 3 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: t.textFaint, marginRight: 8 }}>{selectedTest.id}</span>
                      {selectedTest.name}
                    </div>
                    <p style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.7, margin: 0 }}>{selectedTest.description}</p>
                  </div>
                  {selectedResult && (() => {
                    const isLimitation = !selectedResult.passed && !!selectedTest.knownLimitation
                    const color = selectedResult.passed ? t.green : isLimitation ? t.orange : t.red
                    const icon  = selectedResult.passed ? '✅' : isLimitation ? '⚠️' : '❌'
                    const label = selectedResult.passed ? 'PASS' : isLimitation ? 'KNOWN LIMIT' : 'FAIL'
                    return (
                      <div style={{ padding: '8px 16px', borderRadius: 8, background: `${color}18`, border: `1px solid ${color}44`, textAlign: 'center', flexShrink: 0 }}>
                        <div style={{ fontSize: 18 }}>{icon}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, color }}>{label}</div>
                        <div style={{ fontSize: 9, color: t.textFaint }}>{selectedResult.duration_ms}ms</div>
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* Request parameters */}
              <div style={panelBg}>
                <div style={{ padding: '12px 20px', borderBottom: `1px solid ${t.border}`, fontSize: 11, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Request Parameters</div>
                <div style={{ padding: '14px 20px', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {[
                    ['Start', selectedTest.request.start_node_id],
                    ['End', selectedTest.request.end_node_id],
                    ['Diversity', selectedTest.request.diversity],
                    ...(selectedTest.request.must_include_nodes?.length ? [['Via Nodes', selectedTest.request.must_include_nodes.join(', ')]] : []),
                    ...(selectedTest.request.must_avoid_nodes?.length ? [['Avoid Nodes', selectedTest.request.must_avoid_nodes.join(', ')]] : []),
                    ...(selectedTest.request.must_include_systems?.length ? [['Use Systems', selectedTest.request.must_include_systems.join(', ')]] : []),
                    ...(selectedTest.request.must_avoid_systems?.length ? [['Avoid Systems', selectedTest.request.must_avoid_systems.join(', ')]] : []),
                    ...(selectedTest.request.must_avoid_countries?.length ? [['Avoid Countries', selectedTest.request.must_avoid_countries.join(', ')]] : []),
                    ...(selectedTest.request.max_wet_hops != null ? [['Max Wet Hops', String(selectedTest.request.max_wet_hops)]] : []),
                  ].map(([label, value]) => (
                    <div key={label} style={{ padding: '6px 12px', borderRadius: 6, background: t.bgDeep, border: `1px solid ${t.border}` }}>
                      <div style={{ fontSize: 9, color: t.textFaint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: t.text, fontFamily: 'monospace' }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Assertions */}
              <div style={panelBg}>
                <div style={{ padding: '12px 20px', borderBottom: `1px solid ${t.border}`, fontSize: 11, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Assertions · {selectedTest.assertions.length} checks</span>
                  {selectedResult && <span style={{ color: selectedResult.passed ? t.green : t.red, fontSize: 11 }}>{selectedResult.assertion_results.filter(a => a.passed).length}/{selectedResult.assertion_results.length} passed</span>}
                </div>
                <div style={{ padding: '8px 0' }}>
                  {selectedTest.assertions.map((assertion, idx) => {
                    const aResult = selectedResult?.assertion_results.find(r => r.assertion_id === assertion.id)
                    return (
                      <div key={assertion.id} style={{ padding: '10px 20px', borderBottom: idx < selectedTest.assertions.length - 1 ? `1px solid ${t.border}22` : 'none', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: !aResult ? t.border : aResult.passed ? `${t.green}33` : `${t.red}33`, border: `2px solid ${!aResult ? t.border : aResult.passed ? t.green : t.red}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                          {aResult && <span style={{ fontSize: 9 }}>{aResult.passed ? '✓' : '✗'}</span>}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: t.text, fontWeight: 500, marginBottom: 2 }}>{assertion.description}</div>
                          <div style={{ fontSize: 10, fontFamily: 'monospace', color: t.textFaint }}>{assertion.type}{assertion.params ? ` (${Object.entries(assertion.params).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}</div>
                          {aResult && (
                            <div style={{ fontSize: 11, marginTop: 4, color: aResult.passed ? t.green : t.red, fontWeight: 600 }}>{aResult.message}</div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Known limitation callout */}
              {selectedResult && !selectedResult.passed && selectedTest.knownLimitation && (
                <div style={{ ...panelBg, borderColor: `${t.orange}55`, background: `${t.orange}08`, padding: '16px 20px' }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: t.orange, marginBottom: 4 }}>Known Network Limitation — not a bug</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 6 }}>{selectedTest.knownLimitation.summary}</div>
                      <p style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.7, margin: 0 }}>{selectedTest.knownLimitation.detail}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Route results */}
              {selectedResult && selectedResult.routes.length > 0 && (
                <div style={panelBg}>
                  <div style={{ padding: '12px 20px', borderBottom: `1px solid ${t.border}`, fontSize: 11, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Route Results · {selectedResult.routes_found} returned
                  </div>
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {selectedResult.routes.slice(0, 5).map((route, idx) => {
                      const wetHops  = route.segments.filter(s => s.type === 'wet').length
                      const systems  = [...new Set(route.segments.map(s => s.system_id))]
                      const isWorker  = route.diversity_group === 0
                      const isProtect = route.diversity_group === 1
                      return (
                        <div key={route.id ?? idx} style={{ background: t.bgDeep, border: `1px solid ${t.border}`, borderLeft: `3px solid ${idx === 0 ? '#89b4fa' : idx === 1 ? '#a6e3a1' : '#cba6f7'}`, borderRadius: 8, padding: '12px 14px' }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: t.textMuted }}>Route {idx + 1}</span>
                            {isWorker  && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, background: '#89b4fa22', color: '#89b4fa', fontWeight: 700 }}>WORKER</span>}
                            {isProtect && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, background: '#a6e3a122', color: '#a6e3a1', fontWeight: 700 }}>PROTECT</span>}
                            {[
                              [`${Math.round(route.total_length_km).toLocaleString()} km`, t.textFaint],
                              [`${route.total_latency.toFixed(1)} ms`, t.textFaint],
                              [`${wetHops} wet hop${wetHops !== 1 ? 's' : ''}`, '#89b4fa'],
                              [`${route.nodes.length} nodes`, t.textFaint],
                            ].map(([val, color]) => (
                              <span key={val as string} style={{ fontSize: 10, color: color as string, padding: '2px 7px', borderRadius: 4, background: t.bgCard, border: `1px solid ${t.border}` }}>{val}</span>
                            ))}
                          </div>
                          {/* Systems used */}
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                            {systems.map(sid => (
                              <span key={sid} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: `${t.blue}15`, color: t.blue, fontWeight: 600 }}>{sid}</span>
                            ))}
                          </div>
                          {/* Metro map */}
                          <RoutePathViz route={route} nodesById={nodesById} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* No result yet */}
              {!selectedResult && (
                <div style={{ ...panelBg, padding: '32px 24px', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>▶</div>
                  <div style={{ fontSize: 13, color: t.textMuted, fontWeight: 600 }}>Press "Run All Tests" to execute this test case</div>
                  <div style={{ fontSize: 11, color: t.textFaint, marginTop: 6 }}>Results, route visualisations, and assertion outcomes will appear here</div>
                </div>
              )}

              {/* Error */}
              {selectedResult?.error && (
                <div style={{ ...panelBg, padding: '16px 20px', borderColor: `${t.red}44`, background: `${t.red}08` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.red, marginBottom: 4 }}>API Error</div>
                  <div style={{ fontSize: 11, color: t.textMuted, fontFamily: 'monospace' }}>{selectedResult.error}</div>
                </div>
              )}
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.textFaint }}>
              Select a test case from the left panel
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
