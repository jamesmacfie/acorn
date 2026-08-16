# Placements: the two unbuilt surfaces

**Unbuilt.** Panels are placement-agnostic and **placement** — where a panel renders, under whose
constraints — is the first-class concept; "dashboard" is just the default placement. That model
shipped: the scope key `(surface, ownerId?, projectId?)` is in `persist.ts` with all three surface
names in the union (`home` | `pane` | `plugin-region`), segments percent-encoded, `PanelGrid` takes a
scope rather than assuming home, and `Panel` is placement-agnostic (`docs/dashboards.md §
Placements`). So each deliverable below is **a renderer and a declaration seam, not a key format** —
the seam was built in advance on purpose.

The task-pane placement that used to head this file **shipped on 2026-08-16**
(`dashboards/DashboardPane.tsx`), and it is the proof the seam was worth building: it cost a container
and one behaviour change, and touched neither the key format nor the panel. Two things it settled that
the remaining items inherit rather than re-decide:

- **Remove split in two** — "Remove from here" (`unplacePanel`) beside an armed "Delete panel" — on
  every surface, because with a second placement an unplaced panel is no longer unreachable.
- **Pane placements are keyed by PANE, not by task.** Definitions are per-user-per-node and
  surface-free, so the same board renders in that pane in every task. Per-task boards are a non-goal:
  a task is ephemeral, and composing a board per task is labour nobody repeats — if someone asks, the
  answer is the `projectId` segment, not a task segment.

Two deliverables remain, nearest first. Neither changes the wire contract.

## 1. Rail-source side panel

**What**: a plugin's rail source declares that it allows a user-composed dashboard beside its
source panel. The easy sibling of regions, because the surface it extends (`ChromeSourcePanel`) is
already host-rendered — no frame boundary is involved anywhere.

**Build**: a small manifest key on the source contribution declaring the allowance and its
constraints (default: own-plugin collections only), sharing the constraint vocabulary below; a
region in the source-panel layout; `PanelGrid` with scope `(plugin-region, <pluginId>:<sourceId>)`.

**Done when**: a source that declares it gets an optional panel area beside it whose editor offers
only allowed collections; a source that declares nothing is pixel-identical to today; and the
placement survives the plugin being disabled, inert.

## 2. Plugin-hosted regions

**What**: a plugin's manifest declares "I host a dashboard region" and the **user's panels are the
contributions**. Cooperative extension points shipped since the original design
(`docs/plugins.md § Cooperative extension points`): two-sided, declarative, host-mediated. A
dashboard region is that same shape with the user in the contributor's seat — **build it as one of
those points, not a parallel mechanism**, and extend that declaration shape rather than inventing a
sibling.

**The constraint vocabulary** the declaration carries:

- allowed collections — own-plugin-only as the default; or an explicit list of collection
  references; or a requirement on field roles ("any collection with a status-role field");
- allowed view kinds;
- a panel-count cap;
- where the region sits in the plugin's surface (the rule below).

**Constraints are enforced twice**, the pattern the repo uses everywhere: at edit time the panel
editor's selectors simply do not offer disallowed options (unrepresentable beats validated), and at
render time the host re-validates, because manifest-derived roster rows are untrusted wire
(`chrome/data.ts` re-checks everything the roster claims; this is no different).

**The host-drawn-region rule, kept verbatim**: *host-rendered panels never render inside a frame
document; a plugin's layout **reserves** a region and the host draws it.* Every future plugin
author will read "a rectangle for dashboard items" as "inside my iframe", and it cannot mean that —
panels are host Solid components and a sandboxed frame is a separate realm. The precedent is the
document surface's frame `layout` templates: the manifest reserves part of the rectangle (below the
frame, beside it, a tab) and the host draws that part. No bridge API may pretend otherwise.

**Done when**: a frame plugin's manifest can reserve a region; the user composes panels into it
under the declared constraints, enforced at edit *and* render; and nothing about the frame's own
document changes.

## Survival rules — requirements on every new placement

Shipped for Home; each new surface must hold them, not re-derive them:

- A placement whose owning plugin is disabled or uninstalled disappears from view; its persisted
  definition survives inert and returns with the plugin.
- A panel whose collection is unavailable renders as the inert "source unavailable" panel inside
  any placement.
- The user's hand-built compositions are never collateral damage of plugin lifecycle events.

## Verify before building

- `dashboards/DashboardPane.tsx` — the shipped task pane is the worked example both items copy: a
  scope constant, a container, and nothing else.
- The shipped extension-point contract (`docs/plugins.md § Cooperative extension points`) — regions
  must ride it; check what its declaration shape can already express before adding constraint keys.
- The frame `layout` template vocabulary (`pluginManifest.ts`, `plugins/frames/`) — the
  host-drawn-region rule assumes reserving regions via layout templates is still the pattern.
- `ChromeSourcePanel` — the side-panel deliverable assumes source panels are still host-rendered
  there.
- The grid's narrow-window collapse (`PanelGrid.tsx`) — a region too narrow for twelve cells inherits
  it for free, and the per-scope `layouts` key already carries these new scopes.
