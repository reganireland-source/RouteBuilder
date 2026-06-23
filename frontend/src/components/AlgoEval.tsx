import { useState, useCallback, useRef } from 'react'
import { useTheme } from '../theme'
import { api } from '../api/client'
import type { CableNode, CableSegment, CableSystem, DiversityType, NodeType, Route, RouteRequest } from '../types'

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

  // ── Additional Intra-Asia Endpoint Tests ─────────────────────────────────────
  {
    id: 'EP-006',
    name: 'Alt SG Landing (SGCL) → Hong Kong',
    description: 'Tests connectivity from the secondary Singapore cable landing station (SGCL) to Hong Kong. Verifies that the graph correctly models both SG entry points and that SGCL is reachable from the same downstream networks as SGCH.',
    category: 'endpoint', isCore: true, tags: ['intra-asia', 'SG', 'HK'],
    request: { start_node_id: 'SGCL', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-006-A1', description: 'Route found from SGCL to Hong Kong', type: 'route_found' },
      { id: 'EP-006-A2', description: 'Short intra-Asia hop (<5,000 km)', type: 'distance_under', params: { threshold_km: 5000 } },
    ],
    knownLimitation: {
      summary: 'SGCL connectivity depends on correct terrestrial backhaul between Singapore landing stations',
      detail: 'If SGCL does not have a modelled backhaul segment connecting it to the wider SG-area graph, it will appear isolated and return 0 routes. A failure here is a data completeness issue — ensure a terrestrial or backhaul segment links SGCL to SGCH or directly to a cable system node.',
    },
  },
  {
    id: 'EP-007',
    name: 'Hong Kong → Osaka',
    description: 'Intra-Asia northward route from Hong Kong to the Osaka cable landing (OSA1). Important for customers with Japan cloud presence in the Kansai region — tests Japan connectivity via an alternative landing to Tokyo.',
    category: 'endpoint', isCore: true, tags: ['intra-asia', 'HK', 'JP'],
    request: { start_node_id: 'HKCC', end_node_id: 'OSA1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-007-A1', description: 'Route found Hong Kong to Osaka', type: 'route_found' },
      { id: 'EP-007-A2', description: 'Distance realistic for HK-Osaka hop (<3,500 km)', type: 'distance_under', params: { threshold_km: 3500 } },
      { id: 'EP-007-A3', description: 'Latency appropriate for this corridor (<30 ms)', type: 'latency_under', params: { threshold_ms: 30 } },
    ],
  },
  {
    id: 'EP-008',
    name: 'Singapore → Osaka',
    description: 'Singapore to the Kansai region of Japan. Tests whether the algorithm can route from Southeast Asia to OSA1 without forcing transit through Tokyo (JTHA). Useful for Kansai-based enterprise customers seeking a direct Japan entry point.',
    category: 'endpoint', isCore: true, tags: ['intra-asia', 'SG', 'JP'],
    request: { start_node_id: 'SGCH', end_node_id: 'OSA1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-008-A1', description: 'Route found Singapore to Osaka', type: 'route_found' },
      { id: 'EP-008-A2', description: 'Distance reasonable for this corridor (<6,000 km)', type: 'distance_under', params: { threshold_km: 6000 } },
    ],
  },
  {
    id: 'EP-009',
    name: 'Melbourne → Los Angeles',
    description: 'Australian origin diversity — tests whether MEL1 has independent Trans-Pacific connectivity. A key test for customers with a Melbourne presence wanting direct Pacific access without routing everything via Sydney.',
    category: 'endpoint', isCore: true, tags: ['trans-pacific', 'AU', 'US'],
    request: { start_node_id: 'MEL1', end_node_id: 'LAX1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-009-A1', description: 'Route found Melbourne to Los Angeles', type: 'route_found' },
      { id: 'EP-009-A2', description: 'Distance reflects Trans-Pacific reach (>10,000 km)', type: 'distance_over', params: { threshold_km: 10000 } },
    ],
    knownLimitation: {
      summary: 'MEL1 may reach Pacific cables only via SYD1 terrestrial backhaul',
      detail: 'If Melbourne (MEL1) is not directly landed by a Trans-Pacific cable, the algorithm routes via Sydney (SYD1) over terrestrial backhaul first. A failure may indicate either a missing MEL1→SYD1 backhaul segment or missing MEL1 cable landing data. Verify the terrestrial segment exists in the dataset.',
    },
  },
  {
    id: 'EP-010',
    name: 'Hong Kong → Los Angeles',
    description: 'Primary North Asia to US West Coast corridor. HK enterprise customers seeking US connectivity typically transit Japan before crossing the Pacific. Tests full-corridor graph traversal from HKCC to LAX1.',
    category: 'endpoint', isCore: true, tags: ['trans-pacific', 'HK', 'US'],
    request: { start_node_id: 'HKCC', end_node_id: 'LAX1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-010-A1', description: 'Route found Hong Kong to Los Angeles', type: 'route_found' },
      { id: 'EP-010-A2', description: 'Distance reflects Trans-Pacific reach (>10,000 km)', type: 'distance_over', params: { threshold_km: 10000 } },
    ],
  },

  // ── Additional Intra-Asia Diversity Tests ─────────────────────────────────────
  {
    id: 'DV-005',
    name: 'HKG → TYO: Wet Diversity',
    description: 'Hong Kong to Tokyo wet diversity. Multiple cable systems (EAC, C2C, FLAG, PCCS) serve this corridor. Verifies the algorithm finds two geographically separated submarine paths — critical for Japanese enterprise customers requiring carrier resilience.',
    category: 'diversity', isCore: true, tags: ['intra-asia', 'wet-diversity', 'HK', 'JP'],
    request: { start_node_id: 'HKCC', end_node_id: 'JTHA', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'wet' },
    assertions: [
      { id: 'DV-005-A1', description: 'Two diverse HK-Japan routes found', type: 'min_routes', params: { count: 2 } },
      { id: 'DV-005-A2', description: 'Routes use different submarine cable segments', type: 'routes_diverse_wet' },
    ],
    knownLimitation: {
      summary: 'HK-Japan wet diversity requires at least two independent cable systems in the dataset',
      detail: 'If only one submarine path exists between HKCC and JTHA in the current data, wet diversity will fail. The commercially available EAC, C2C, and PCCS systems should each provide an independent path. Check that all are correctly modelled with complete landing nodes at both ends.',
    },
  },
  {
    id: 'DV-006',
    name: 'SIN → TYO: Wet Diversity',
    description: 'Singapore to Tokyo wet diversity across the full two-hop intra-Asia corridor. The algorithm must find pairs that use different cable systems for both the SG-HK and HK-Japan legs — or a combination that avoids any shared wet segment.',
    category: 'diversity', isCore: true, tags: ['intra-asia', 'wet-diversity', 'SG', 'JP'],
    request: { start_node_id: 'SGCH', end_node_id: 'JTHA', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'wet' },
    assertions: [
      { id: 'DV-006-A1', description: 'Two diverse SG-Japan routes found', type: 'min_routes', params: { count: 2 } },
      { id: 'DV-006-A2', description: 'Routes share no submarine cable segments', type: 'routes_diverse_wet' },
    ],
    knownLimitation: {
      summary: 'Two-hop intra-Asia wet diversity requires independent cable options on both legs',
      detail: 'SG→Japan diversity requires independent cables on both the SG-HK leg and the HK-Japan leg. If the dataset shows only one cable on either leg, full wet diversity is not achievable and the algorithm returns the best available near-diverse pair. A failure here may indicate that one leg lacks a second cable system in the data.',
    },
  },
  {
    id: 'DV-007',
    name: 'SIN → HKG: Full Diversity',
    description: 'Full end-to-end diversity on the SG-HK corridor — no shared segments of any kind, including terrestrial backhaul at both ends. With multiple cables (EAC, C2C, AAE1) and landing stations (SGCH, SGCL / HKCC, HKG1), this corridor should be the strongest for full diversity in the dataset.',
    category: 'diversity', isCore: true, tags: ['intra-asia', 'full-diversity', 'SG', 'HK'],
    request: { start_node_id: 'SGCH', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'full' },
    assertions: [
      { id: 'DV-007-A1', description: 'Two fully diverse SG-HK routes found', type: 'min_routes', params: { count: 2 } },
      { id: 'DV-007-A2', description: 'No shared wet segments between routes', type: 'routes_diverse_wet' },
    ],
    knownLimitation: {
      summary: 'Full diversity may share terrestrial backhaul at Singapore or Hong Kong',
      detail: 'Even with multiple submarine cables, full segment diversity fails if both routes share the same terrestrial backhaul to the PoP. At Singapore, multiple landing stations (SGCH, SGCL) should enable backhaul diversity. At Hong Kong, HKCC and HKG1 serve the same purpose. If the data shows only one terrestrial path at either end, full diversity reduces to wet diversity — the correct commercial response is to disclose the shared terrestrial segment.',
    },
  },

  // ── Additional Intra-Asia Constraint Tests ────────────────────────────────────
  {
    id: 'CN-006',
    name: 'System Exclusion: SIN → HKG (avoid C2C)',
    description: 'Companion to CN-003 (avoid EAC). Excluding C2C forces routing onto EAC, AAE1 or another intra-Asia system. Validates that single-system exclusions work on the same corridor with a different system blocked.',
    category: 'constraint', isCore: true, tags: ['intra-asia', 'system-exclusion'],
    request: { start_node_id: 'SGCH', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: ['C2C'], diversity: 'none' },
    assertions: [
      { id: 'CN-006-A1', description: 'Alternative route found without C2C', type: 'route_found' },
      { id: 'CN-006-A2', description: 'C2C system segments absent from all routes', type: 'path_excludes_system', params: { system_id: 'C2C' } },
    ],
  },
  {
    id: 'CN-007',
    name: 'Dual Exclusion: SIN → HKG (avoid EAC + C2C)',
    description: 'Stress-tests exclusion constraints by blocking both primary intra-Asia systems simultaneously. The algorithm must find a third path (via AAE1 or another cable) or correctly return 0 routes if none exists in the dataset.',
    category: 'constraint', isCore: true, tags: ['intra-asia', 'system-exclusion'],
    request: { start_node_id: 'SGCH', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: ['EAC', 'C2C'], diversity: 'none' },
    assertions: [
      { id: 'CN-007-A1', description: 'Route found via a third cable system', type: 'route_found' },
      { id: 'CN-007-A2', description: 'EAC absent from all routes', type: 'path_excludes_system', params: { system_id: 'EAC' } },
      { id: 'CN-007-A3', description: 'C2C absent from all routes', type: 'path_excludes_system', params: { system_id: 'C2C' } },
    ],
    knownLimitation: {
      summary: 'If no third cable connects SG to HK, 0 routes is correct — not a bug',
      detail: 'When EAC and C2C are both excluded, the algorithm must find a path via AAE1, FLAG, or another system. If no such path exists in the data, 0 results is the correct response. A failure on CN-007-A1 (route_found) indicates either: (a) no third cable exists between SG-HK in the dataset — a data completeness issue to verify against the commercial network — or (b) the dual exclusion constraint is not being applied correctly.',
    },
  },
  {
    id: 'CN-008',
    name: 'Waypoint: SIN → TYO via Hong Kong',
    description: 'Forces the Singapore to Tokyo route to transit Hong Kong (HKCC). Models a customer requiring a mid-path breakout or co-location at a Hong Kong PoP before continuing to Japan. Verifies must-include-node works on a two-hop intra-Asia corridor.',
    category: 'constraint', isCore: true, tags: ['intra-asia', 'waypoint', 'SG', 'JP'],
    request: { start_node_id: 'SGCH', end_node_id: 'JTHA', must_include_nodes: ['HKCC'], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'CN-008-A1', description: 'Route found transiting via Hong Kong', type: 'route_found' },
      { id: 'CN-008-A2', description: 'HKCC appears on all returned routes', type: 'path_includes_node', params: { node_id: 'HKCC' } },
    ],
  },
  {
    id: 'CN-009',
    name: 'Waypoint: HKG → TYO via Osaka',
    description: 'Forces Hong Kong to Tokyo routing via the Osaka cable landing (OSA1). Tests mid-path waypoint enforcement on a short intra-Asia corridor. Useful for customers needing a Kansai presence point before Tokyo.',
    category: 'constraint', isCore: true, tags: ['intra-asia', 'waypoint', 'HK', 'JP'],
    request: { start_node_id: 'HKCC', end_node_id: 'JTHA', must_include_nodes: ['OSA1'], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'CN-009-A1', description: 'Route found transiting via Osaka', type: 'route_found' },
      { id: 'CN-009-A2', description: 'OSA1 appears on all returned routes', type: 'path_includes_node', params: { node_id: 'OSA1' } },
    ],
  },
  {
    id: 'CN-010',
    name: 'Country Exclusion: SYD → LAX (avoid Japan)',
    description: 'Sydney to LA without transiting Japan. With Japan excluded, the algorithm must find a southern Trans-Pacific route via Hawaii or a direct cable. Tests country exclusion on a long-haul corridor where Japan is the typical transit.',
    category: 'constraint', isCore: true, tags: ['trans-pacific', 'country-exclusion', 'AU', 'US'],
    request: { start_node_id: 'SYD1', end_node_id: 'LAX1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], must_avoid_countries: ['JP'], diversity: 'none' },
    assertions: [
      { id: 'CN-010-A1', description: 'Route found Sydney to LA avoiding Japan', type: 'route_found' },
      { id: 'CN-010-A2', description: 'No Japanese nodes on any route', type: 'path_excludes_country', params: { country: 'JP' } },
    ],
    knownLimitation: {
      summary: 'A Japan-free Trans-Pacific path from AU requires Hawaii landing nodes in the dataset',
      detail: 'The primary AU Trans-Pacific cables (Southern Cross, PPC-1) typically land in Hawaii rather than Japan. If Hawaii landing nodes are correctly modelled, a Japan-free path exists. If the dataset does not include Hawaii waypoints, all AU Trans-Pacific paths may route via Japan — making this test a useful indicator of Hawaii landing station coverage in the data.',
    },
  },

  // ── Additional Preference / Latency Tests ─────────────────────────────────────
  {
    id: 'PR-003',
    name: 'Latency Budget: HKG → TYO (<40 ms)',
    description: 'Tight latency check on the Hong Kong to Tokyo corridor (~3,000 km). Direct-fibre latency should sit comfortably under 40 ms. A failure indicates either an incorrect propagation model or a route being looped through unnecessary additional hops.',
    category: 'preference', isCore: true, tags: ['intra-asia', 'latency', 'HK', 'JP'],
    request: { start_node_id: 'HKCC', end_node_id: 'JTHA', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'PR-003-A1', description: 'Route found HK to Tokyo', type: 'route_found' },
      { id: 'PR-003-A2', description: 'Best route latency under 40 ms', type: 'latency_under', params: { threshold_ms: 40 } },
    ],
  },
  {
    id: 'PR-004',
    name: 'Latency Budget: SYD → LAX (<85 ms)',
    description: 'Trans-Pacific latency sanity check. Sydney to LA should sit around 70–80 ms on a direct Pacific cable. Tests that the latency model correctly accounts for ~12,000 km of fibre propagation plus typical amplifier and equipment delays.',
    category: 'preference', isCore: true, tags: ['trans-pacific', 'latency', 'AU', 'US'],
    request: { start_node_id: 'SYD1', end_node_id: 'LAX1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'PR-004-A1', description: 'Route found Sydney to LA', type: 'route_found' },
      { id: 'PR-004-A2', description: 'Best route latency under 85 ms', type: 'latency_under', params: { threshold_ms: 85 } },
    ],
    knownLimitation: {
      summary: 'SYD-LAX latency depends on the propagation delay model — actual values vary 70–90 ms',
      detail: 'Typical fibre propagation delay SYD→LAX is approximately 67–75 ms on Southern Cross (direct) and up to 90 ms on routes transiting Japan. If the algorithm returns latencies significantly outside this range, check whether per-segment latency values in the dataset correctly reflect actual cable specs. The 85 ms threshold passes the best-case direct cable while flagging over-long routes.',
    },
  },

  // ── Additional Edge Cases ─────────────────────────────────────────────────────
  {
    id: 'EX-003',
    name: 'Edge Case: Single Wet Hop SIN → TYO',
    description: 'Requests Singapore to Tokyo with max_wet_hops: 1. Tests whether any direct single-segment submarine cable between SG and Japan exists in the dataset. Most SG-Japan paths require two wet hops (SG→HK then HK→JP). A direct cable (e.g. an AAE1 direct branch) would satisfy the constraint.',
    category: 'edge_case', isCore: true, tags: ['edge-case', 'intra-asia', 'hop-limit'],
    request: { start_node_id: 'SGCH', end_node_id: 'JTHA', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none', max_wet_hops: 1 },
    assertions: [
      { id: 'EX-003-A1', description: 'Returns gracefully — 0 routes expected if no direct cable exists', type: 'no_routes_found' },
    ],
    knownLimitation: {
      summary: 'A direct single-segment SG→Japan cable may or may not exist in the current dataset',
      detail: 'This test expects 0 routes on the basis that most SG-Japan connectivity requires two submarine hops. If a direct SG→Japan cable is correctly modelled in the data (e.g. a direct branch of EAC or AAE1), this test will "fail" the no_routes_found assertion — but that failure actually confirms correct data modelling. Review the result and update the assertion type to route_found if the direct cable is confirmed in the dataset.',
    },
  },
  {
    id: 'EX-004',
    name: 'Edge Case: Node Exclusion on Short Intra-Asia (avoid HKG1)',
    description: 'Tests node exclusion on a short corridor where the excluded node (HKG1) is a Hong Kong cable landing. Excluding HKG1 forces the algorithm onto HKCC or other available HK nodes. Verifies the constraint applies cleanly on dense intra-Asia topology.',
    category: 'edge_case', isCore: true, tags: ['edge-case', 'intra-asia', 'node-exclusion'],
    request: { start_node_id: 'SGCH', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: ['HKG1'], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EX-004-A1', description: 'Route still found avoiding HKG1', type: 'route_found' },
      { id: 'EX-004-A2', description: 'HKG1 does not appear on any route', type: 'path_excludes_node', params: { node_id: 'HKG1' } },
    ],
  },

  // ── Even More Intra-Asia Endpoint Tests ──────────────────────────────────────
  {
    id: 'EP-011',
    name: 'Alt SG Landing (SGCL) → Tokyo',
    description: 'Full intra-Asia corridor from the secondary Singapore landing station (SGCL) to Tokyo. Companion to EP-006 (SGCL→HKCC) — verifies SGCL can route beyond Hong Kong and reach Japan.',
    category: 'endpoint', isCore: true, tags: ['intra-asia', 'SG', 'JP'],
    request: { start_node_id: 'SGCL', end_node_id: 'JTHA', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-011-A1', description: 'Route found SGCL to Tokyo', type: 'route_found' },
      { id: 'EP-011-A2', description: 'Distance realistic for SG-Japan corridor (<8,000 km)', type: 'distance_under', params: { threshold_km: 8000 } },
    ],
    knownLimitation: {
      summary: 'SGCL connectivity to Japan depends on backhaul between SG landing stations',
      detail: 'If SGCL does not have a modelled backhaul to SGCH or a direct cable system reaching Japan, it will appear isolated and return 0 routes. A failure here is commercially significant — it means customers ingressing at SGCL cannot reach Japan without an unmodelled path.',
    },
  },
  {
    id: 'EP-012',
    name: 'Hong Kong (HKG1) → Tokyo',
    description: 'Tests connectivity from the HKG1 cable landing to Tokyo. Companion to EP-004 (HKCC→JTHA) — verifies the secondary HK landing station also participates correctly in northbound Japan routing.',
    category: 'endpoint', isCore: true, tags: ['intra-asia', 'HK', 'JP'],
    request: { start_node_id: 'HKG1', end_node_id: 'JTHA', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-012-A1', description: 'Route found HKG1 to Tokyo', type: 'route_found' },
      { id: 'EP-012-A2', description: 'Distance reasonable for HK-Japan hop (<5,000 km)', type: 'distance_under', params: { threshold_km: 5000 } },
    ],
    knownLimitation: {
      summary: 'HKG1 may have fewer cable systems than HKCC, limiting northbound routing options',
      detail: 'If no cable landing at HKG1 continues northward to Japan, the algorithm must bridge HKG1→HKCC over terrestrial backhaul first. A failure may indicate that HKG1 is a termination point for specific systems only and requires a backhaul segment to participate in the wider northbound graph.',
    },
  },
  {
    id: 'EP-013',
    name: 'Singapore → JUNO (alternate Japan landing)',
    description: 'Singapore to the JUNO Japan cable landing — an alternative Japan entry point beyond JTHA (Tokyo) and OSA1 (Osaka). Tests that the JUNO node has valid graph connectivity from Singapore.',
    category: 'endpoint', isCore: true, tags: ['intra-asia', 'SG', 'JP'],
    request: { start_node_id: 'SGCH', end_node_id: 'JUNO', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EP-013-A1', description: 'Route found Singapore to JUNO', type: 'route_found' },
      { id: 'EP-013-A2', description: 'Distance within expected SG-Japan range (<8,000 km)', type: 'distance_under', params: { threshold_km: 8000 } },
    ],
  },

  // ── Even More Intra-Asia Diversity Tests ─────────────────────────────────────
  {
    id: 'DV-008',
    name: 'HKG → OSA: Wet Diversity',
    description: 'Hong Kong to Osaka wet diversity. With multiple cables on the HK-Japan corridor, the algorithm should find two routes that do not share any submarine segments on the way to the Osaka landing.',
    category: 'diversity', isCore: true, tags: ['intra-asia', 'wet-diversity', 'HK', 'JP'],
    request: { start_node_id: 'HKCC', end_node_id: 'OSA1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'wet' },
    assertions: [
      { id: 'DV-008-A1', description: 'Two diverse HK-Osaka routes found', type: 'min_routes', params: { count: 2 } },
      { id: 'DV-008-A2', description: 'Routes use different submarine cable segments', type: 'routes_diverse_wet' },
    ],
    knownLimitation: {
      summary: 'HK-Osaka wet diversity may be limited if cables converge before the Osaka landing',
      detail: 'If cables serving HK and Japan share a common branching unit near the Japanese coast before diverging to OSA1 vs JTHA, full wet diversity to Osaka specifically may not be achievable. Wet diversity to JTHA (Tokyo) may have more cable options remaining distinct further north.',
    },
  },
  {
    id: 'DV-009',
    name: 'SIN → OSA: Wet Diversity',
    description: 'Singapore to Osaka wet diversity across the two-leg SG-HK-Japan corridor. Both legs must use different submarine cables — tests the most demanding diversity scenario on this particular intra-Asia route.',
    category: 'diversity', isCore: true, tags: ['intra-asia', 'wet-diversity', 'SG', 'JP'],
    request: { start_node_id: 'SGCH', end_node_id: 'OSA1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'wet' },
    assertions: [
      { id: 'DV-009-A1', description: 'Two diverse SG-Osaka routes found', type: 'min_routes', params: { count: 2 } },
      { id: 'DV-009-A2', description: 'Routes share no submarine cable segments', type: 'routes_diverse_wet' },
    ],
    knownLimitation: {
      summary: 'SG-Osaka diversity requires independent cables on both the SG-HK and HK-Osaka legs',
      detail: 'A two-hop diverse path SG→Osaka needs both legs to have independent cable options. If only one cable serves the HK-Osaka segment, diversity collapses to shared protection on that final leg — which should be disclosed commercially as a topological constraint.',
    },
  },
  {
    id: 'DV-010',
    name: 'SIN → HKG: Wet Diversity from Alt SG Landing',
    description: 'Wet diversity from the secondary Singapore landing station (SGCL) to Hong Kong. Tests that SGCL itself has access to multiple cable systems, enabling diversity even from a secondary entry point.',
    category: 'diversity', isCore: true, tags: ['intra-asia', 'wet-diversity', 'SG', 'HK'],
    request: { start_node_id: 'SGCL', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'wet' },
    assertions: [
      { id: 'DV-010-A1', description: 'Two diverse routes found from SGCL to HKCC', type: 'min_routes', params: { count: 2 } },
      { id: 'DV-010-A2', description: 'Routes share no submarine cable segments', type: 'routes_diverse_wet' },
    ],
    knownLimitation: {
      summary: 'SGCL wet diversity depends on multiple independent cables landing at this secondary station',
      detail: 'If SGCL is the landing point for only one cable system, wet diversity from that entry is impossible without bridging to SGCH first. A failure here tells the sales team that SGCL-ingressed circuits cannot be independently diversified at the cable level.',
    },
  },

  // ── Even More Intra-Asia Constraint Tests ────────────────────────────────────
  {
    id: 'CN-011',
    name: 'Waypoint: SIN → TYO via HKG1 (alt HK landing)',
    description: 'Forces the Singapore to Tokyo route via HKG1 specifically — the secondary HK cable landing rather than HKCC. Tests that must-include-node works with alternative landing stations that are on the same geographic corridor.',
    category: 'constraint', isCore: true, tags: ['intra-asia', 'waypoint', 'SG', 'JP'],
    request: { start_node_id: 'SGCH', end_node_id: 'JTHA', must_include_nodes: ['HKG1'], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'CN-011-A1', description: 'Route found transiting via HKG1', type: 'route_found' },
      { id: 'CN-011-A2', description: 'HKG1 appears on all returned routes', type: 'path_includes_node', params: { node_id: 'HKG1' } },
    ],
    knownLimitation: {
      summary: 'If no cable from HKG1 connects to the northbound Japan system, routing via HKG1 is impossible',
      detail: 'The constraint forces the route to physically touch HKG1. If HKG1 only terminates cables that serve the SG-HK segment and has no northbound continuation, the algorithm cannot complete the path to Tokyo. This indicates HKG1 is a termination node on the northbound corridor — an important topology finding.',
    },
  },
  {
    id: 'CN-012',
    name: 'Node Exclusion: HKG → TYO (avoid Osaka, force alt Japan landing)',
    description: 'Hong Kong to Tokyo with Osaka (OSA1) excluded. Forces the route to arrive via JUNO, TKOH or another Japan landing point — testing whether the HK-Japan corridor has enough alternative entry points.',
    category: 'constraint', isCore: true, tags: ['intra-asia', 'node-exclusion', 'HK', 'JP'],
    request: { start_node_id: 'HKCC', end_node_id: 'JTHA', must_include_nodes: [], must_avoid_nodes: ['OSA1'], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'CN-012-A1', description: 'Route found HK to Tokyo avoiding Osaka', type: 'route_found' },
      { id: 'CN-012-A2', description: 'OSA1 absent from all returned routes', type: 'path_excludes_node', params: { node_id: 'OSA1' } },
    ],
  },
  {
    id: 'CN-013',
    name: 'System Inclusion: SIN → HKG (force EAC)',
    description: 'Forces the SG-HK route to use EAC specifically. Companion to CN-003 (exclude EAC) — verifies the must-include-system constraint works in both directions on the same intra-Asia corridor.',
    category: 'constraint', isCore: true, tags: ['intra-asia', 'system-inclusion', 'SG', 'HK'],
    request: { start_node_id: 'SGCH', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: ['EAC'], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'CN-013-A1', description: 'Route found using EAC', type: 'route_found' },
      { id: 'CN-013-A2', description: 'EAC segments present on all routes', type: 'path_includes_system', params: { system_id: 'EAC' } },
    ],
  },
  {
    id: 'CN-014',
    name: 'Country Exclusion: SIN → TYO (avoid Hong Kong)',
    description: 'Singapore to Tokyo with Hong Kong excluded entirely. Tests whether a direct SG-Japan cable exists in the dataset. Most SG-Japan paths transit HK — this is a key data discovery test.',
    category: 'constraint', isCore: true, tags: ['intra-asia', 'country-exclusion', 'SG', 'JP'],
    request: { start_node_id: 'SGCH', end_node_id: 'JTHA', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], must_avoid_countries: ['HK'], diversity: 'none' },
    assertions: [
      { id: 'CN-014-A1', description: 'Route found SG to Tokyo without transiting Hong Kong', type: 'route_found' },
      { id: 'CN-014-A2', description: 'No Hong Kong nodes on any route', type: 'path_excludes_country', params: { country: 'HK' } },
    ],
    knownLimitation: {
      summary: 'Most SG-Japan cables transit Hong Kong — a HK-free path may not exist in the current dataset',
      detail: 'If EAC, C2C and all other SG-Japan cables route via Hong Kong, excluding HK returns 0 results — which is the correct response. This test is most valuable as a data discovery exercise: a pass confirms a direct SG-Japan cable (e.g. SJC, SMW3/5 direct branch) is modelled; a fail tells the sales team that any SG-Japan quote currently requires transiting Hong Kong infrastructure.',
    },
  },
  {
    id: 'CN-015',
    name: 'Chained Waypoints: SIN → TYO via HKCC then OSA1',
    description: 'Forces the Singapore to Tokyo route through both Hong Kong (HKCC) and Osaka (OSA1) in sequence — building a SG→HK→OSA→TYO path. Tests that multi-node waypoint chaining works correctly.',
    category: 'constraint', isCore: true, tags: ['intra-asia', 'waypoint', 'SG', 'JP'],
    request: { start_node_id: 'SGCH', end_node_id: 'JTHA', must_include_nodes: ['HKCC', 'OSA1'], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'CN-015-A1', description: 'Route found transiting both HKCC and OSA1', type: 'route_found' },
      { id: 'CN-015-A2', description: 'HKCC appears on all routes', type: 'path_includes_node', params: { node_id: 'HKCC' } },
      { id: 'CN-015-A3', description: 'OSA1 appears on all routes', type: 'path_includes_node', params: { node_id: 'OSA1' } },
    ],
  },

  // ── Even More Intra-Asia Preference Tests ─────────────────────────────────────
  {
    id: 'PR-005',
    name: 'Latency Budget: SIN → OSA (<50 ms)',
    description: 'Latency check on the Singapore to Osaka corridor (~5,000 km including HK transit). A failure indicates route looping through unnecessary additional hops or an incorrectly calibrated per-segment latency model.',
    category: 'preference', isCore: true, tags: ['intra-asia', 'latency', 'SG', 'JP'],
    request: { start_node_id: 'SGCH', end_node_id: 'OSA1', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'PR-005-A1', description: 'Route found SG to Osaka', type: 'route_found' },
      { id: 'PR-005-A2', description: 'Best route latency under 50 ms', type: 'latency_under', params: { threshold_ms: 50 } },
    ],
  },
  {
    id: 'PR-006',
    name: 'Hop Budget: SIN → TYO (max 2 wet hops)',
    description: 'Singapore to Tokyo with max_wet_hops: 2. Most SG-Japan paths use exactly 2 submarine hops (SG→HK then HK→JP). This should pass cleanly — confirms the natural hop count of the corridor is within budget.',
    category: 'preference', isCore: true, tags: ['intra-asia', 'hop-limit', 'SG', 'JP'],
    request: { start_node_id: 'SGCH', end_node_id: 'JTHA', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none', max_wet_hops: 2 },
    assertions: [
      { id: 'PR-006-A1', description: 'Route found within 2 wet hops', type: 'route_found' },
      { id: 'PR-006-A2', description: 'All routes use at most 2 wet cable segments', type: 'wet_hops_max', params: { max: 2 } },
    ],
  },

  // ── Even More Intra-Asia Edge Cases ───────────────────────────────────────────
  {
    id: 'EX-005',
    name: 'Edge Case: SIN → HKG (max 1 wet hop — should succeed)',
    description: 'Opposite of EX-003 (SIN→TYO single wet hop). SG and HK are directly connected by multiple submarine cables (EAC, C2C, AAE1), so max_wet_hops: 1 should return valid routes — confirming direct cable coverage exists.',
    category: 'edge_case', isCore: true, tags: ['edge-case', 'intra-asia', 'hop-limit'],
    request: { start_node_id: 'SGCH', end_node_id: 'HKCC', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none', max_wet_hops: 1 },
    assertions: [
      { id: 'EX-005-A1', description: 'At least one 1-hop route found SG to HK', type: 'route_found' },
      { id: 'EX-005-A2', description: 'All routes use at most 1 wet cable segment', type: 'wet_hops_max', params: { max: 1 } },
    ],
  },
  {
    id: 'EX-006',
    name: 'Edge Case: Reverse Intra-Asia (TYO → SIN)',
    description: 'Tests graph symmetry — Tokyo to Singapore should return routes with the same distance and hop count as SG to Tokyo (EP-005). Any asymmetry in the graph would surface as a significant distance or latency discrepancy.',
    category: 'edge_case', isCore: true, tags: ['edge-case', 'intra-asia', 'JP', 'SG'],
    request: { start_node_id: 'JTHA', end_node_id: 'SGCH', must_include_nodes: [], must_avoid_nodes: [], must_include_segments: [], must_avoid_segments: [], must_include_systems: [], must_avoid_systems: [], diversity: 'none' },
    assertions: [
      { id: 'EX-006-A1', description: 'Route found Tokyo to Singapore', type: 'route_found' },
      { id: 'EX-006-A2', description: 'Distance comparable to SG→TYO direction (<8,000 km)', type: 'distance_under', params: { threshold_km: 8000 } },
    ],
  },
]

// ── Random test generator ─────────────────────────────────────────────────────

let _rndSeq = 0

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const ENDPOINT_TYPES: NodeType[] = ['landing_station', 'primary_pop', 'secondary_pop']

function buildRandomTest(_idx: number, nodes: CableNode[], systems: CableSystem[]): TestCase {
  const seq = ++_rndSeq
  const endpointNodes = nodes.filter(n => ENDPOINT_TYPES.includes(n.type))
  if (endpointNodes.length < 2) throw new Error('Not enough endpoint nodes')

  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
  const maybe = (prob: number) => Math.random() < prob

  const start = pick(endpointNodes)
  const end   = pick(endpointNodes.filter(n => n.id !== start.id && n.country !== start.country))

  const straightLineKm = haversineKm(start.lat, start.lng, end.lat, end.lng)

  // Weighted diversity pick — mostly none, some wet, rare full
  const diversityPool: DiversityType[] = ['none', 'none', 'none', 'none', 'wet', 'wet', 'full']
  const diversity = pick(diversityPool)

  // Optional system exclusion (20% chance, skip TERRESTRIAL)
  const wetSystems = systems.filter(s => s.id !== 'TERRESTRIAL')
  const excludeSystem = maybe(0.20) && wetSystems.length > 0 ? pick(wetSystems) : null

  const id = `RND-${String(seq).padStart(3, '0')}`

  const assertions: Assertion[] = [
    {
      id: `${id}-A1`,
      description: 'At least one route returned',
      type: 'route_found',
    },
    {
      // Route can't be longer than 3× straight-line + 5,000 km overhead (cable curves, backhaul)
      id: `${id}-A2`,
      description: `Route distance plausible (< ${Math.round(straightLineKm * 3 + 5000).toLocaleString()} km)`,
      type: 'distance_under',
      params: { threshold_km: Math.round(straightLineKm * 3 + 5000) },
    },
    {
      // Latency sanity: 200 km/ms fibre speed × 2× margin + 50 ms overhead
      id: `${id}-A3`,
      description: `Latency plausible (< ${Math.round(straightLineKm / 100 + 80)} ms)`,
      type: 'latency_under',
      params: { threshold_ms: Math.round(straightLineKm / 100 + 80) },
    },
  ]

  if (diversity !== 'none') {
    assertions.push({
      id: `${id}-A4`,
      description: 'At least 2 diverse routes returned',
      type: 'min_routes',
      params: { count: 2 },
    })
    assertions.push({
      id: `${id}-A5`,
      description: 'Routes share no submarine cable segments',
      type: 'routes_diverse_wet',
    })
  }

  if (excludeSystem) {
    assertions.push({
      id: `${id}-A${assertions.length + 1}`,
      description: `Excluded system (${excludeSystem.id}) absent from all routes`,
      type: 'path_excludes_system',
      params: { system_id: excludeSystem.id },
    })
  }

  const distLabel = straightLineKm < 3000 ? 'short-haul' : straightLineKm < 8000 ? 'medium-haul' : 'long-haul'
  const constraintParts = [
    diversity !== 'none' && `${diversity} diversity`,
    excludeSystem && `avoid ${excludeSystem.id}`,
  ].filter(Boolean).join(', ')

  return {
    id,
    name: `${start.id} → ${end.id}${constraintParts ? ` · ${constraintParts}` : ''}`,
    description: `Auto-generated ${distLabel} test (${Math.round(straightLineKm).toLocaleString()} km straight-line). ${start.name} (${start.country}) → ${end.name} (${end.country}). Assertions are generic bounds derived from the straight-line distance — they will catch impossible routes, distance model errors, and badly looped paths.`,
    category: 'endpoint',
    isCore: false,
    tags: ['random', start.country, end.country, distLabel].filter(Boolean),
    request: {
      start_node_id:     start.id,
      end_node_id:       end.id,
      must_include_nodes: [],
      must_avoid_nodes:   [],
      must_include_segments: [],
      must_avoid_segments:   [],
      must_include_systems:  [],
      must_avoid_systems:    excludeSystem ? [excludeSystem.id] : [],
      diversity,
    },
    assertions,
    knownLimitation: diversity !== 'none' ? {
      summary: 'Diversity on randomly selected corridors may not be achievable',
      detail: `The randomly selected O-D pair (${start.id} → ${end.id}) may not have multiple independent cable systems. A failure on diversity assertions reflects a real topology constraint, not an algorithm bug.`,
    } : undefined,
  }
}

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

export function AlgoEval({ nodes, systems, onClose }: Props) {
  const t = useTheme()
  const nodesById = new Map(nodes.map(n => [n.id, n]))

  const [history,        setHistory]        = useState<TestRun[]>(loadHistory)
  const [activeRunId,    setActiveRunId]    = useState<string | null>(() => loadHistory()[0]?.id ?? null)
  const [running,        setRunning]        = useState(false)
  const [runningTestId,  setRunningTestId]  = useState<string | null>(null)
  const [selectedTestId, setSelectedTestId] = useState<string>(CORE_TESTS[0].id)
  const [activeTab,      setActiveTab]      = useState<'core' | 'custom'>('core')
  const runIdRef = useRef(0)

  // ── Random test generator state ────────────────────────────────────────────
  const [randomTests,      setRandomTests]      = useState<TestCase[]>([])
  const [randomResults,    setRandomResults]    = useState<Map<string, TestResult>>(new Map())
  const [selectedRandomId, setSelectedRandomId] = useState<string | null>(null)
  const [runningRandomId,  setRunningRandomId]  = useState<string | null>(null)
  const [randomCount,      setRandomCount]      = useState(5)
  const [randomRunning,    setRandomRunning]    = useState(false)

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

  // ── Run all random tests ───────────────────────────────────────────────────
  const runAllRandom = useCallback(async () => {
    if (randomTests.length === 0) return
    setRandomRunning(true)
    setRandomResults(new Map())
    const acc = new Map<string, TestResult>()
    for (const tc of randomTests) {
      setRunningRandomId(tc.id)
      const result = await runOne(tc)
      acc.set(tc.id, result)
      setRandomResults(new Map(acc))
    }
    setRunningRandomId(null)
    setRandomRunning(false)
  }, [randomTests, runOne])

  // ── Active test / result (unified for core + random) ──────────────────────
  const selectedTest   = activeTab === 'custom'
    ? (selectedRandomId ? randomTests.find(t => t.id === selectedRandomId) ?? null : null)
    : (CORE_TESTS.find(tc => tc.id === selectedTestId) ?? null)
  const selectedResult = activeTab === 'custom'
    ? (selectedRandomId ? randomResults.get(selectedRandomId) : undefined)
    : resultMap.get(selectedTestId)

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
            <div style={{ fontSize: 10, color: t.textFaint, letterSpacing: '0.05em' }}>UAT Test Suite · {CORE_TESTS.length} scenarios across {(['endpoint','diversity','constraint','preference','edge_case'] as const).length} categories</div>
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
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {/* Generator controls */}
              <div style={{ padding: '12px 14px', borderBottom: `1px solid ${t.border}`, flexShrink: 0, background: t.bgPanel }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: t.blue, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                  🎲 Random Generator
                </div>
                <div style={{ fontSize: 10, color: t.textFaint, lineHeight: 1.5, marginBottom: 10 }}>
                  Picks random O-D pairs from live network data. Assertions are auto-derived from straight-line distance — covering distance bounds, latency sanity, and constraint compliance.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, color: t.textMuted, flexShrink: 0 }}>Count</span>
                  <input
                    type="number" min={1} max={20} value={randomCount}
                    onChange={e => setRandomCount(Math.max(1, Math.min(20, Number(e.target.value))))}
                    style={{ width: 52, padding: '4px 7px', borderRadius: 5, border: `1px solid ${t.border}`, background: t.bgDeep, color: t.text, fontSize: 12, textAlign: 'center' }}
                  />
                  <button
                    onClick={() => {
                      const tests: TestCase[] = []
                      for (let i = 0; i < randomCount; i++) {
                        try { tests.push(buildRandomTest(i, nodes, systems)) } catch { /* skip if not enough nodes */ }
                      }
                      setRandomTests(tests)
                      setRandomResults(new Map())
                      setSelectedRandomId(tests[0]?.id ?? null)
                    }}
                    style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: `1px solid ${t.blue}44`, background: `${t.blue}15`, color: t.blue, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    🎲 Generate
                  </button>
                </div>
                {randomTests.length > 0 && (
                  <button
                    onClick={runAllRandom}
                    disabled={randomRunning}
                    style={{
                      width: '100%', padding: '7px 0', borderRadius: 6, border: 'none',
                      background: randomRunning ? t.bgCard : t.green, color: randomRunning ? t.textFaint : '#0d1117',
                      fontSize: 11, fontWeight: 700, cursor: randomRunning ? 'wait' : 'pointer',
                    }}
                  >
                    {randomRunning
                      ? <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span> Running…</>
                      : `▶ Run ${randomTests.length} Random Tests`}
                  </button>
                )}
              </div>

              {/* Random test list */}
              {randomTests.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: t.textFaint, padding: 20, textAlign: 'center' }}>
                  <span style={{ fontSize: 24 }}>🎲</span>
                  <div style={{ fontSize: 11, color: t.textMuted }}>Set a count and click Generate</div>
                </div>
              ) : (
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {/* Summary bar after run */}
                  {randomResults.size > 0 && (
                    <div style={{ padding: '6px 14px', borderBottom: `1px solid ${t.border}`, display: 'flex', gap: 10, fontSize: 10, background: t.bgPanel }}>
                      {(() => {
                        const passed = [...randomResults.values()].filter(r => r.passed).length
                        const failed = randomResults.size - passed
                        return <>
                          <span style={{ color: t.green, fontWeight: 700 }}>✓ {passed} passed</span>
                          {failed > 0 && <span style={{ color: t.red, fontWeight: 700 }}>✗ {failed} failed</span>}
                          <span style={{ color: t.textFaint }}>{randomResults.size}/{randomTests.length} run</span>
                        </>
                      })()}
                    </div>
                  )}
                  {randomTests.map(tc => {
                    const res = randomResults.get(tc.id)
                    const isRunning = runningRandomId === tc.id
                    const isSelected = selectedRandomId === tc.id
                    const isLimitation = !res?.passed && !!tc.knownLimitation
                    const dotColor = !res ? t.border : res.passed ? t.green : isLimitation ? t.orange : t.red
                    return (
                      <div
                        key={tc.id}
                        onClick={() => setSelectedRandomId(tc.id)}
                        style={{
                          padding: '9px 14px', cursor: 'pointer', borderBottom: `1px solid ${t.border}22`,
                          background: isSelected ? `${t.blue}18` : 'transparent',
                          borderLeft: isSelected ? `3px solid ${t.blue}` : '3px solid transparent',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontSize: 9, fontFamily: 'monospace', color: t.textFaint, flexShrink: 0 }}>{tc.id}</div>
                          <div style={{ flex: 1, fontSize: 11, fontWeight: 600, color: isSelected ? t.text : t.textMuted, lineHeight: 1.3 }}>{tc.name}</div>
                          {isRunning && <div style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${t.blue}`, borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />}
                          {!isRunning && <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, boxShadow: res ? `0 0 4px ${dotColor}88` : 'none' }} />}
                        </div>
                        <div style={{ fontSize: 9, color: t.textFaint, marginTop: 3 }}>
                          {tc.tags.slice(0, 4).map(tag => (
                            <span key={tag} style={{ marginRight: 5, padding: '1px 4px', borderRadius: 3, background: `${t.blue}15`, color: t.blue }}>{tag}</span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
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
                  <div style={{ fontSize: 13, color: t.textMuted, fontWeight: 600 }}>{activeTab === 'custom' ? 'Press "Run Random Tests" to execute' : 'Press "Run All Tests" to execute this test case'}</div>
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
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: t.textFaint, textAlign: 'center', padding: 24 }}>
              {activeTab === 'custom' ? (
                <>
                  <span style={{ fontSize: 28 }}>🎲</span>
                  <div style={{ fontSize: 13, color: t.textMuted, fontWeight: 600 }}>Generate random tests to begin</div>
                  <div style={{ fontSize: 11, color: t.textFaint, lineHeight: 1.6, maxWidth: 340 }}>
                    Set a count in the left panel and click Generate. Random tests pick real nodes from your live dataset and auto-build assertions based on corridor distance.
                  </div>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 28 }}>▶</span>
                  <div style={{ fontSize: 13, color: t.textMuted, fontWeight: 600 }}>Select a test case from the left panel</div>
                </>
              )}
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
