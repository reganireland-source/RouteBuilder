# RouteBuilder — Engineering Backlog

Everything known-but-not-done, as of 2026-09-14. Ordered by kind.

**Status 2026-09-15.** RFS is now DONE end to end — backend constraint, client
mirror, Current/Planned selector, future-network banner — and EOL has shipped
as its exact reverse (see 1.3). Outstanding from the list below: the coverage
import data loss (2.1), the new bulk-import gap (2.6), and the remaining lint
debt (4.3).

**Status 2026-09-14.** A session rate limit stopped five parallel workstreams
partway, so several items below are genuinely half-done rather than merely
planned. What actually landed: the RFS routing constraint backend (1.1, DONE
and live-verified), `generateUserGuide.ts` deleted (3.2, DONE), route-path
chains confirmed names-only (1.2, CLOSED), and lint cleared in two of four
files (4.3, PARTIAL). What was cut off mid-flight: the guide update (3.1,
PARTIAL), the RFS badge on route cards (1.1, NOT STARTED) and the coverage
import fix (2.1, NOT STARTED — no code was written for either).

This is the *engineering* backlog. Product ideas from users live in the app's
own Feature Backlog page (Guide → 📋 Feature Backlog, `/api/feature-requests`),
and the forward-looking product roadmap lives on the Product Overview page.

---

## 1. Deferred on purpose

### 1.1 RFS as a routing constraint
**BACKEND DONE. UI REMAINING.** `backend/app/rfs.py` resolves the dates and
`build_graph` drops out-of-service segments before they become edges; backend
tests went 29 to 80. Live-verified at the quarter boundary.

Still to do:
  * The search form does not yet send `service_date`, so nothing filters in the
    app. The frontend `RouteRequest` type carries the field; SearchForm needs a
    date input defaulting to today, and App.tsx/MobileLayout need to thread it.
  * **The RFS badge on route cards is NOT STARTED.** When a future date is set
    and a returned route uses a planned segment, the card should badge the
    LATEST RFS quarter on that path (a route is only usable once its last
    planned piece is in service), in `t.orange`, with a tooltip naming the
    segments holding it up. A planned segment with a missing quarter should
    still badge, reading `RFS unknown`. Only render it when a planned segment
    is actually present, so a normal search is visually unchanged.

Agreed design: a **service date on the search, defaulting to today**, so the
common case is "only what is in service right now" and you can never quote a
route over a cable that does not exist yet. Pushing the date forward is how you
plan against future capacity.

Resolution rules: a segment is unavailable when its effective RFS date is after
the service date; the effective date is the **later** of the segment's own and
its owning system's, because a segment cannot be in service before its cable;
`YYYY-Qn` resolves to the **last** day of that quarter, since RFS promises
service *by the end of* it; and a row marked planned with a missing or
malformed quarter is treated as never in service rather than waved through.
Filtering happens at graph-build time so excluded segments simply do not exist
for the pathfinder, leaving diversity and k-shortest-path logic untouched.

When the date IS pushed forward and a returned route uses a planned segment,
the route card carries an `RFS 2027-Q2` badge showing the LATEST quarter on
that path — a route is only usable once its last planned piece is in service —
with a tooltip naming which segments are holding it up.

### 1.3 EOL — DONE
End of Life shipped as the exact mirror of RFS: `eol_status`/`eol_quarter` on
systems and segments, migration m061, and a segment must now be both built and
not-yet-retired to be routable. Effective EOL is the EARLIER of segment and
system (a ceiling, where RFS has a floor); a quarter resolves to its last day in
both directions; an `eol` row with an unparseable quarter counts as already
retired, mirroring RFS.

One consequence worth revisiting: because the mirror is exact, a typo in an EOL
quarter silently removes a cable that is carrying traffic today. That is
defensibly conservative — "if we cannot tell when a cable is usable, do not
offer it" — but the cost is higher in the EOL direction than the RFS one. If
that proves wrong in practice, the fix is to treat a malformed EOL quarter as
"never retires" instead.

### 1.2 Node codes in RouteList path chains
Route cards render a path as `Sydney → Auckland → Guam`, names only. Everywhere
else a node is written code-first (`SYD1 - Sydney`) via `utils/nodeLabel.ts`.
**CLOSED — stays names-only.** A five-hop chain with codes gets long enough to
wrap, and the Segment Breakdown underneath already shows codes.

---

## 2. Bugs

### 2.1 Coverage CSV import silently wipes node fields — data loss
**NOT STARTED** — dispatched but cut off by the rate limit before any code was
written. Still fully open.
`backend/app/api/bulk.py:1072` rebuilds each `Node` from only `id, name, lat,
lng, type, country, owner, trading_name, description, capabilities`. Every node
touched by a coverage import therefore loses `city`, `street_address`,
`verification_status`, `last_verified_date` and `on_net`. Fix by merging onto
the existing node (`model_copy(update=...)`) instead of reconstructing it, the
way `PUT /api/nodes/{id}` already does.

### 2.6 Bulk CSV import silently resets lifecycle dates
`backend/app/api/bulk.py` does not carry `rfs_status`/`rfs_quarter` in
`SEGMENT_COLS`/`SYSTEM_COLS`, and its importers reconstruct `CableSegment` /
`CableSystem` from the CSV columns alone. A segment or system import in upsert
mode therefore resets those fields to their defaults — and now `eol_status` /
`eol_quarter` with them. Pre-existing for RFS, doubled by EOL. Same shape as
2.1 and the same fix: merge onto the existing row rather than rebuilding it.

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
**PARTIAL.** Some coverage of the recent features landed; the Node Full View
and Network Editor deep-dive sections were still being written when the run
stopped. Re-check what is and is not covered before resuming.
The in-app guide and its print/PDF export were last brought up to date on
2026-08-04. Since then these shipped and are undocumented: Esri basemaps with
English labels, segment spotlighting and the 1 Hz route glow, verbose build
info, Australian highway backhaul routing, the whole Visual Network Editor,
RFS dates, in-app confirm dialogs, node codes in data views, and node Full
View. (The Product History page covers *that* these happened; the guide should
cover *how to use* them.)

### 3.2 `generateUserGuide.ts` — DONE, deleted
`generateUserGuidePDF()` was 1,032 lines of hand-drawn jsPDF that nothing
imported: the "Export as PDF" button calls `handlePrint`, which uses the
print-portal path. Deleted rather than wired up, because the print portal
already exports every guide page automatically and stays correct as pages are
added, whereas the jsPDF document had to be hand-updated page by page and had
silently fallen months of features behind. `jspdf` remains a dependency — the
SLD export
(`utils/generateDiagram.ts`) still uses it.

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
**PARTIAL — half cleared.** `MobileLayout.tsx` (was 14) and `ProductHistory.tsx`
(was 7) are now 0. Remaining: `App.tsx` 14 and `Map.tsx` 14, both mostly
`sonarjs/no-nested-conditional` plus `App.tsx`'s render at cognitive complexity
62. `UserGuide.tsx` has 2. None are bugs, but lint can't gate CI until they're
cleared.

### 4.4 `ALLOW_OPEN_WRITES` is a local-only escape hatch
Worth a CI assertion that it is never set in a deployed environment. Today
nothing prevents it being switched on in production, where it would disable the
admin write guard entirely.
