# Placements: where panels live

Design notes from the dashboards session (2026-08-12). Nothing here is scheduled. The premise:
panels (`composition.md`) are placement-agnostic, and **placement** — where a panel renders, under
whose constraints — is the first-class concept. "Dashboard" is just the default placement, not the
unit of design. This is the Perses layouts-reference-panels split (`prior-art.md`), and it is what
makes every future home for panels additive: the node↔client contract never changes, because who
composes panels and where they render was always host-side.

## The placements

| Placement | Constraint owner | Notes |
| --- | --- | --- |
| **Home dashboard** | user | The default. Home is already a rail source (`sourceContributions.ts`), so the dashboard is the Home source's content grown from the `FleetHome` card idiom. |
| **Task pane** | user | A dashboard as a pane inside a task — nearly free once the surface is placement-agnostic; register a pane whose content is a placement. |
| **Plugin-hosted region** | declaring plugin | A plugin reserves a region and constrains what panels it accepts. Later phase; see below. |
| **Rail-source side panel** | declaring plugin | A plugin's source declares it allows a user dashboard beside it, constrained to (typically) its own collections. The easy sibling: source panels are already host-rendered (`ChromeSourcePanel`). |

Scope key for persisted placements: `(surface, ownerId, projectId?)` — e.g.
`(home, —, —)`, `(pane, paneId, —)`, `(plugin-region, pluginId:regionId, projectId)`. Persistence
is per-user-per-node **in the owning node's prefs store, not on the device**
(`docs/state.md § Scope rules`), referencing panel definitions by id
(`composition.md § The persisted model`).

## Plugin-hosted regions: the cooperative extension point, inverted

Cooperative extension points have since shipped (`docs/plugins.md § Cooperative extension
points`): two-sided, declarative, host-mediated — plugin A declares a point it hosts, plugin B
contributes descriptors into it. A plugin-hosted dashboard region is the same shape with **the
user in the contributor's seat**: the plugin's manifest declares "I host a dashboard region", and
the user's panels are the contributions. Build it as one of those points, not a parallel
mechanism.

The declaration carries a **constraint vocabulary**:

- allowed collections — own-plugin-only is the sensible default; or an explicit list of
  collection references; or a requirement on field roles ("any collection with a status-role
  field");
- allowed view kinds;
- a panel-count cap;
- where the region sits in the plugin's surface (see the rule below).

Constraints are enforced **twice**, in the pattern the repo already uses everywhere:

1. **At edit time**: the panel editor's selectors simply don't offer disallowed options —
   unrepresentable beats validated (`composition.md § The generated editor`).
2. **At render time**: the host re-validates, because manifest-derived roster rows are untrusted
   wire (`chrome/data.ts` re-checks everything the roster claims; this is no different).

## The host-drawn-region rule

**Host-rendered panels never render inside a frame document. A plugin's layout *reserves* a
region; the host draws it.**

This is the trap in "a plugin decides to have a rectangle that can have dashboard items put into
it": every future plugin author will read that as "inside my iframe", and it cannot mean that.
Panels are host-rendered Solid components; a sandboxed frame is a separate realm with no network
and its own document — host components cannot render there, and no bridge API should pretend
otherwise. The precedent is the **document surface** (`docs/plugins.md`, frame `layout`
templates): the frame's manifest reserves part of the rectangle and the host draws that part. A
dashboard region is the same move — a layout-template answer (below the frame, beside it, a tab),
not a bridge API. Rail side panels don't even face the question: the surface they extend is
already host-rendered.

## Survival rules

The pane-layout precedent (unknown pane ids survive inert, `tasks/layout.ts`) carries over
wholesale:

- A placement whose owning plugin is disabled or uninstalled disappears from view but its
  persisted definition survives inert, and returns if the plugin does.
- A panel whose collection is unavailable renders as an inert "source unavailable" panel inside
  any placement (`composition.md`).
- The user's hand-built compositions are never collateral damage of plugin lifecycle events.

## Phasing

Home dashboard and task-pane placements are phase 2 (`README.md`). Plugin-hosted regions and rail
side panels are a later phase that **requires no contract change** — the seam (placement scope
keys, the constraint vocabulary, panels-by-reference) is designed now so the later phase is
additive. This is the build-the-seam-anyway posture the repo already takes for plugin contracts,
one level up.

## Verify before building

- Whether Home is still a source and what `FleetHome` became — the default placement builds there.
- The shipped extension-point contract (`docs/plugins.md § Cooperative extension points`) — the
  plugin-hosted region must ride it, and its constraint vocabulary should extend that declaration
  shape rather than invent a sibling.
- The frame `layout` template vocabulary (`pluginManifest.ts`, `plugins/frames/`) — the
  host-drawn-region rule assumes reserving regions via layout templates is still the pattern.
- The pane registration path (`registries/panes.ts`) and whether pane ids as persisted layout
  keys still behave as recorded — the task-pane placement keys off it.
- Whether `persistedState` scoping (`persistence/persistedState.ts`) grew a shape that placement
  scope keys should reuse rather than invent.
