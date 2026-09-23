---
name: RouteBuilder
description: International Telco · Subsea Circuit Design
colors:
  chart-table-blue: "#5b9cf6"
  neutral-bg-deep: "#161828"
  neutral-bg-panel: "#21233a"
  neutral-bg-base: "#1c1e30"
  neutral-bg-selected: "#272a42"
  neutral-border: "#383c58"
  neutral-border-subtle: "#4a4f72"
  neutral-text: "#cdd6f4"
  neutral-text-muted: "#a0a8c8"
  neutral-text-faint: "#70788c"
  neutral-text-faintest: "#505870"
  status-green: "#34c77a"
  status-red: "#dc2626"
  status-orange: "#ea6c00"
  status-pink: "#be185d"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "normal"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.06em"
rounded:
  xs: "3px"
  sm: "6px"
  md: "10px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.chart-table-blue}"
    textColor: "#0b1220"
    rounded: "{rounded.xs}"
    padding: "10px 16px"
    typography: "{typography.body}"
  button-primary-disabled:
    backgroundColor: "{colors.neutral-border-subtle}"
    textColor: "#0b1220"
    rounded: "{rounded.xs}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.neutral-bg-panel}"
    textColor: "{colors.neutral-text-muted}"
    rounded: "{rounded.md}"
    padding: "7px 14px"
    typography: "{typography.body}"
  button-secondary-active:
    backgroundColor: "rgba(91,156,246,0.13)"
    textColor: "{colors.chart-table-blue}"
    rounded: "{rounded.md}"
    padding: "7px 14px"
  input:
    backgroundColor: "{colors.neutral-bg-base}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.xs}"
    padding: "4px 7px"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.neutral-bg-panel}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.sm}"
    padding: "{spacing.md}"
---

# Design System: RouteBuilder

## Overview

**Creative North Star: "The Deep Chart"**

RouteBuilder reads like a nautical chart table at night: a dark, precise instrument surface for reading real infrastructure, with the network itself — the map, the routes, the data — doing the talking. The default Dusk theme is the clearest expression of this: dark UI chrome floating over a lit street map, exactly like a lamp-lit chart table over paper laid on a real sea. Chart-Table Blue (the one accent) behaves the way an instrument light does — rare, purposeful, never decorative — and everything else stays quiet so it can stand out when it appears.

The UI is precise and quiet: bold labels (Inter at 700-weight is the default, not the exception) keep a dense information surface scannable, while a mostly-neutral, low-saturation palette and short, purposeful motion (120–180ms) keep that density from ever feeling loud. This is an Operate-mode tool — sales engineers and customers reading a real, buildable route through a real network — so scanability and trustworthiness outrank expression at every turn.

**Key Characteristics:**
- Dark instrument-panel chrome over a legible map, in three interchangeable light levels (Dark / Dusk / Light) — Dusk is the canonical world.
- One accent color, spent sparingly, on the one active/selected thing per view.
- Bold (700-weight) labels by default; regular weight is reserved for read-only prose.
- Shadow depth is a hierarchy signal, not a decoration — heavier shadow means "more above everything else."
- Motion is short, purposeful, and fully respects `prefers-reduced-motion`.

## Colors

A mostly-neutral, low-saturation palette built to stay legible under three light levels, with a single accent spent on purpose.

### Primary
- **Chart-Table Blue** (`#5b9cf6` in Dusk; `#89b4fa` in Dark; `#1e66f5` in Light): the one accent. Active tabs, the selected route/pin, the primary CTA, focused/active dropdown triggers. Never used decoratively — its rarity is what makes it legible as "this is the active thing."

### Neutral
- **Deep** (`#161828`): the base map/void layer and the deepest modal chrome (e.g. RefDataModal's shell).
- **Panel** (`#21233a`): the default surface for side panels, cards, and dropdown menus.
- **Base** (`#1c1e30`): the app's overall background and default input fill.
- **Selected** (`#272a42`): a card's fill when it's the selected item in a list.
- **Border** (`#383c58`) / **Border Subtle** (`#4a4f72`): default hairline vs. a slightly lighter divider/disabled-state border.
- **Text** (`#cdd6f4`) → **Text Muted** (`#a0a8c8`) → **Text Faint** (`#70788c`) → **Text Faintest** (`#505870`): a four-step reading hierarchy from primary content down to disabled/placeholder text.

### Status (semantic, not brand)
- **Green** (`#34c77a`): healthy / saved / on. **Red** (`#dc2626`): error / failed / destructive action. **Orange** (`#ea6c00`): warning / in-progress / capacity concern. **Pink** (`#be185d`): a rare fourth categorical color for map/legend differentiation only, never a UI state.

### Named Rules
**The One Signal Rule.** Chart-Table Blue marks exactly one thing per view — the active tab, the current selection, the primary action. If two things are blue at once, one of them shouldn't be.

## Typography

**Body & UI Font:** Inter (400/500/600/700), with `system-ui, sans-serif` fallback.

**Character:** A single, bold-leaning grotesque doing all the work — no serif or display face, no second family. Weight carries hierarchy far more than size does across this UI's compact 9–16px working range.

### Hierarchy
- **Display** (800, 28px, 1.1 line-height): rare hero/stat numbers — dashboard totals, health figures. Used sparingly; this is an Operate surface, not a marketing one.
- **Headline** (700, 15px, 1.25): dialog and modal titles.
- **Title** (700, 13px, 1.3): section headers within a panel (e.g. a routes-panel or modal section label).
- **Body** (400, 11px, 1.4): the default reading size for list rows, descriptions, and general UI copy — the single most common text style in the app.
- **Label** (700, 10px, uppercase, 0.06em tracking): field labels and column headers (e.g. "ORIGIN", "DESTINATION").

### Named Rules
**The Bold-by-Default Rule.** Interactive and structural text defaults to 700-weight; regular (400) weight is reserved for read-only prose. A user should be able to tell what's interactive by weight alone, before reading it.

## Layout

Three-pane desktop layout: a fixed-width left panel (search/filters), a dynamic middle panel (results/pins/staged edits — collapses to 0 width when it has nothing to show, expands to 520px when it does), and the map filling the remainder. Panels are collapsible via a small edge-docked chevron toggle, and collapse state is respected as a manual override until the next real content change. Mobile collapses the three-pane layout entirely into a full-screen map with a draggable bottom sheet (two snap points: a 76px "peek" and a 91%-height "full").

Spacing is a loose, non-strict micro-scale: 4px steps for compact chrome (4/8/12/16px), stepping up to 24px for modal/panel body padding. Density is high by design — this is a data-dense Operate tool, not a spacious marketing layout.

## Elevation & Depth

Depth is structural, not decorative: shadow weight is a direct signal of a layer's priority and how much it blocks interaction with what's beneath it. The deeper (heavier, more diffuse) the shadow, the more that layer demands attention right now.

### Shadow Vocabulary
- **Modal** (`box-shadow: 0 24px 64px rgba(0,0,0,0.5)`): centered blocking dialogs — the heaviest tier (ConfirmDialog, RefDataModal, full-screen forms).
- **Popover** (`box-shadow: 0 12px 36px rgba(0,0,0,0.45)`): larger floating panels (e.g. the Asset Filter panel).
- **Dropdown** (`box-shadow: 0 8px 32px rgba(0,0,0,0.4)`): menus and dropdown panels.
- **Floating card** (`box-shadow: 0 4px 16px rgba(0,0,0,0.35)`): small hover popups and info cards.
- **Tooltip** (`box-shadow: 0 4px 14px rgba(0,0,0,0.35)`): the lightest tier — informational only, `pointerEvents: none`, never blocks anything.
- **Panel edge** (`box-shadow: 2px 0 6px rgba(0,0,0,0.2)`): directional shadow marking a docked side panel's edge against the map.

Modal backdrops are a consistent `rgba(0,0,0,0.6)` scrim, separate from the dialog's own box-shadow.

### Named Rules
**The Depth-as-Priority Rule.** Shadow tier must track blocking priority: Modal > Popover > Dropdown > Floating card > Tooltip. A lighter-weight element should never cast a heavier shadow than something it can appear above.

## Shapes

Corner radius scales with a surface's size and how "solid" it should feel: small interactive chrome (inputs, small chips) uses a tight 3px; the most common button/menu-item radius is 6px; larger dropdown/pill triggers step up to 10px; centered dialogs use 12px; fully circular (50%) is reserved for status dots and count badges. No sharp (0px) corners appear anywhere in the UI — everything is at least slightly softened.

## Components

### Buttons
- **Shape:** 4px (primary CTA) to 10px (pill-style menu triggers) — see Shapes.
- **Primary:** solid Chart-Table Blue fill, dark (`#0b1220`) text for contrast, disabled state swaps to `neutral-border-subtle` fill with the same dark text (never grays the label to translucent).
- **Secondary / trigger:** transparent-to-panel background at rest, border and text shift to Chart-Table Blue when open or when a filter/toggle it controls is active — the same accent-tint pattern (`rgba(91,156,246,0.13)` fill) recurs across every dropdown trigger in the app.
- **Hover / Active:** a 1px lift (`translateY(-1px)`) on hover, a slight press-down + 0.97 scale on active — short (150ms), plain `ease`, opt-in per element rather than a global button rule so it never fights a component's own hover styling.

### Inputs / Fields
- **Style:** `neutral-bg-base` fill, 1px `neutral-border` (shifts to status-red when invalid), 3px radius, compact `4px 7px` padding.
- **Labels:** always above the field, 10px uppercase `text-faint`, 0.05–0.06em tracking — never inline placeholders standing in for a label.

### Cards / Containers
- **Corner Style:** 6–8px depending on size (small list card vs. panel shell).
- **Background:** `neutral-bg-panel`, swapping to `neutral-bg-selected` for the selected state in a list.
- **Shadow Strategy:** none at rest — see the Elevation section's Named Rule; only floating/layered surfaces cast shadow.
- **Border:** 1px `neutral-border` is the default separator, not a shadow.
- **Severity/selection stripe:** a 3–4px `border-left` in the status or accent color — outage severity (`OutagePanel`), hazard severity (`HazardsNearbyCard`), note severity (`EntityNotesPanel`), and list-row selection (`AlgoEval`) all use this as "the single strongest colour cue on the card" (verbatim from `EntityNotesPanel`'s own comment). Confirmed intentional and consistent, not a one-off habit — keep it when adding a new severity-coded card; don't reach for a full-border or background-tint substitute instead.

### Modals
- **Style:** `neutral-bg-panel`/`neutral-bg-deep` fill, 1px border, 8–14px radius, Modal-tier shadow, `rgba(0,0,0,0.6)` backdrop scrim.
- **Motion:** backdrop fades in (opacity-only, 150ms `ease`); the dialog itself scales + rises in (`scale(0.96)→scale(1)`, `translateY(2px)→0`, 160ms `ease-out-expo`).
- **Mobile:** collapses to full-bleed `inset: 0` with no radius or shadow.

### Navigation / Tabs
- **Style, typography, states:** top-level mode tabs are bold (11px/700) with a 2px Chart-Table Blue underline and a base-color background swap when active, versus transparent/faint text when inactive. Sub-tabs are smaller and denser (9px, uppercase, 0.04em tracking) but share the same blue-underline active convention, so the "which tab is active" signal reads identically at every level of the tab hierarchy.

### Tooltip (signature component)
Subtle by design: fixed-position, `pointerEvents: none`, opacity-only fade-in (never a transform-based entrance, since a CSS animation owns its whole animated property for its duration and would fight the tooltip's own edge-aware positioning transform). Deliberately the one element allowed to render above ConfirmDialog's otherwise-highest z-index, since a control inside a confirm dialog still needs to be labelable.

## Do's and Don'ts

### Do:
- **Do** keep Chart-Table Blue rare — reserve it for the one active/selected thing per view.
- **Do** default interactive and structural labels to 700-weight Inter; keep 400-weight for read-only prose only.
- **Do** scale shadow depth to blocking priority (Modal > Popover > Dropdown > Floating card > Tooltip), never the reverse.
- **Do** use `cubic-bezier(0.16, 1, 0.3, 1)` ("ease-out-expo") for entrance motion (pop/dropdown/rise) and keep durations short (120–180ms) — these fire on every menu and modal open.
- **Do** respect `prefers-reduced-motion`: every custom animation and hover/active transition must collapse to instant/static under it.

### Don't:
- **Don't** introduce a second accent color that competes with Chart-Table Blue for attention.
- **Don't** rely on color alone to convey state — pair it with an icon, label, or border shift, since the palette must stay legible across all three theme modes (Dark / Dusk / Light).
- **Don't** add a resting shadow to a flat, in-place surface (a card or panel at rest) — shadow is earned only by floating/layered elements.
- **Don't** animate a CSS property that another animation on the same element already drives (e.g. `transform`) — a CSS animation owns its whole animated property for its full duration, so a second, independent use of that property (like manual positioning) gets silently overridden. Use an opacity-only entrance instead, or a different property, when an element also needs its own transform.
