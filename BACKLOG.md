# RouteBuilder — Engineering Backlog

Everything known-but-not-done, as of 2026-09-14. Ordered by kind, not by
priority — priority is the product owner's call.

This is the *engineering* backlog. Product ideas from users live in the app's
own Feature Backlog page (Guide → 📋 Feature Backlog, `/api/feature-requests`),
and the forward-looking product roadmap lives on the Product Overview page.

---

## 1. Deferred on purpose

### 1.1 RFS as a routing constraint
**Asked for, explicitly deferred.** Systems and segments carry `rfs_status`
(`in_service` / `planned`) and `rfs_quarter` (`YYYY-Qn`), backfilled to
in-service by migration m060. Nothing reads them: `pathfinder.py`, `graph.py`
and `routes.py` ignore both fields entirely, so a planned cable routes today as
if it were live.

To finish: a service-date input on the search form, and a filter in the graph
build that drops segments whose RFS quarter is after the requested date. Worth
deciding whether the date defaults to "today" or "any" — defaulting to today
silently changes every existing search result.

### 1.2 Node codes in RouteList path chains
Route cards render a path as `Sydney → Auckland → Guam`, names only. Everywhere
else a node is written code-first (`SYD1 - Sydney`) via `utils/nodeLabel.ts`.
Left as-is because a five-hop chain with codes gets long, and the Segment
Breakdown underneath already shows codes. Needs a call: codes in the chain, or
codes only on hover.

---

## 2. Bugs

### 2.1 Coverage CSV import silently wipes node fields — data loss
`backend/app/api/bulk.py:1072` rebuilds each `Node` from only `id, name, lat,
lng, type, country, owner, trading_name, description, capabilities`. Every node
touched by a coverage import therefore loses `city`, `street_address`,
`verification_status`, `last_verified_date` and `on_net`. Fix by merging onto
the existing node (`model_copy(update=...)`) instead of reconstructing it, the
way `PUT /api/nodes/{id}` already does.

### 2.2 SolutionNotesOverlay is dark-theme only
`frontend/src/components/SolutionNotesOverlay.tsx:31-35` hard-codes severity
colours as literal hexes (`#89b4fa`, `#fab387`, `#f38ba8`) — those are the dark
palette's blue/orange/red. In the light and dusk themes the overlay reads
wrong. Everywhere else uses `t.blue` / `t.orange` / `t.red`.

### 2.3 Colocation category is unvalidated
`ColocationCapabilities.category` (`backend/app/models.py:67`) is a bare `int`.
The API accepts `category: 99`, which renders as "Cat 99" against an undefined
label. The frontend type says 1-5; the backend should too.

### 2.4 Verification-status write has no error handling
`applyNodeVerif` (`frontend/src/components/RefDataModal.tsx:858`) calls
`api.updateNode` outside the `saveEdit` wrapper, so a failure is an unhandled
rejection with no UI feedback — the badge appears to change and silently
doesn't persist.

### 2.5 Fan-diagram labels still crowd at near-parallel clusters
`SegmentFanDiagram` de-collides labels by pushing them to further radial tiers,
which is purely angular and has no idea how wide the text is. Three
destinations within ~30° of each other (SYD1's Brisbane cluster) still touch
slightly. Proper fix: measure text extents and lay labels out vertically on
each side rather than radially.

---

## 3. Documentation debt

### 3.1 Guide pages are behind
The in-app guide and its print/PDF export were last brought up to date on
2026-08-04. Since then these shipped and are undocumented: Esri basemaps with
English labels, segment spotlighting and the 1 Hz route glow, verbose build
info, Australian highway backhaul routing, the whole Visual Network Editor,
RFS dates, in-app confirm dialogs, node codes in data views, and node Full
View. (The Product History page covers *that* these happened; the guide should
cover *how to use* them.)

### 3.2 `generateUserGuide.ts` is dead code — decide its fate
`generateUserGuidePDF()` is ~1,100 lines of hand-drawn jsPDF and **nothing
imports it**. The "Export as PDF" button calls `handlePrint`, which uses the
print-portal path instead. Either wire the jsPDF generator up (it produces a
much more designed document) or delete it. Right now it is maintenance surface
that can never be seen to break.

---

## 4. Platform gaps

### 4.1 No per-node API reads
There is no `GET /api/nodes/{id}` and `GET /api/solution-notes` takes no query
parameters. Every surface that wants one node, or one node's notes, fetches the
entire collection and filters client-side — including Full View each time you
navigate a hop. There is also no index on `solution_notes.node_id`. Fine at
today's 230 nodes / 322 segments; the first thing to hurt as the dataset grows.

### 4.2 The site map is a third-party iframe
The node "Site Location" panel embeds `openstreetmap.org/export/embed.html`. It
ignores the app's theme and its configured tile provider, can't be styled, and
renders blank on restricted networks. Replacing it with a small Leaflet
instance using the app's own `mapTileUrl` would make it consistent and remove
the external dependency.

### 4.3 Pre-existing lint debt
`App.tsx`, `Map.tsx` and `MobileLayout.tsx` carry 32 eslint errors between them
(mostly `sonarjs/no-nested-conditional`, plus `App.tsx`'s render at cognitive
complexity 62); `ProductHistory.tsx` has 7 of the same kind. None are new and
none are bugs, but they mean lint can't be a clean gate in CI until they're
cleared.

### 4.4 `ALLOW_OPEN_WRITES` is a local-only escape hatch
Worth a CI assertion that it is never set in a deployed environment. Today
nothing prevents it being switched on in production, where it would disable the
admin write guard entirely.
