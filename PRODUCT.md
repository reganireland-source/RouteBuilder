# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are external customers and sales engineers: people quoting or exploring subsea/terrestrial circuit routes for a client, rather than in-house network planners. They use RouteBuilder to find and validate a viable route through the real network (subsea cable systems, terrestrial backhaul, PoPs) for a specific customer request, and to explore the network's structure (systems, city pairs, nodes, outages) to answer "can we get service between these two points, and how." Write access to the underlying network model (Network Editor, KML/sync import, reference data) is restricted to admin-gated internal staff; the route-finding and exploration surfaces are the primary customer/sales-facing experience.

## Product Purpose

RouteBuilder finds and presents valid circuit routes across a real, modeled subsea and terrestrial telecom network, and lets authorized staff maintain that network model (segments, nodes, capacity, ownership, survey/sync data) so the routes it returns stay accurate. Success is a sales engineer or customer being able to get a trustworthy, network-aware route quickly, and the underlying network data staying correct as new systems, surveys, and outages come in.

## Positioning

RouteBuilder's route results come from an actual network graph — real segments, nodes, capacity, and ownership — not a straight line drawn on a map or a spreadsheet lookup. A generic GIS/mapping tool can show geography; RouteBuilder can determine whether a route is actually buildable/available through the network as modeled, including subsea-vs-backhaul composition, capacity constraints, and known hazards/outages along the way.

## Operating Context

- Three modes: RouteBuilder (route finding, customer/sales-facing), NetworkExplorer (browse systems, city pairs, nodes, outages), and Network Editor (admin-gated network model maintenance).
- Network data is kept current via KML survey import and sync from submarinecablemap.com, alongside manual editing.
- Hazard/outage overlays inform route validity, not just geography.

## Capabilities and Constraints

- Authentication via Okta/Entra SSO; write/edit operations across the network model are additionally gated behind an admin key — this separation (broad access to find routes, restricted access to change the network) is a hard requirement to preserve.
- Route results and network data must reflect verifiable sources (KML survey files, submarinecablemap.com sync, manual entry with provenance) rather than inferred/fabricated geometry.

## Product Principles

1. A route is only as trustworthy as the network graph it's computed from — network-data integrity is not a secondary concern to route-finding UX.
2. Customer/sales-facing surfaces (RouteBuilder, NetworkExplorer) stay usable without requiring network-editing privileges; editing stays behind the admin gate.
3. Prefer traceable, source-backed network data over convenient shortcuts — never silently invent or overwrite geometry/provenance.
4. Complexity (subsea/terrestrial composition, capacity, hazards, outages) should surface as clarity in the route result, not be hidden or oversimplified.
