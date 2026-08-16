# Placements: the two unbuilt surfaces

**Unbuilt.** Panels are placement-agnostic and **placement** — where a panel renders, under whose
constraints — is the first-class concept; "dashboard" is just the default placement. All of that
machinery exists: the scope key `(surface, ownerId?, projectId?)` is in `persist.ts` with all three
surface names already in the union (`home` | `pane` | `plugin-region`), segments percent-encoded,
`PanelGrid` takes a scope rather than assuming home, `Panel` is placement-agnostic, and `layouts` is
keyed by scope so geometry for a surface nothing draws yet already has somewhere to live
(`docs/dashboards.md § Placements`).

So each deliverable below is **a renderer and a declaration seam, not a key format**. The task pane
is the worked example to copy: a scope constant, a container, and nothing else.

Three rules the existing surfaces already settle. Inherit them; do not re-decide them:

- **A placement's chrome offers "Remove from here" and a separate armed "Delete panel".** Unplacing
  and destroying are different acts wherever more than one surface exists.
- **A pane placement is keyed by PANE, not by task.** Definitions are per-user-per-node and
  surface-free, so the same board renders in that pane in every task. Per-task boards are a non-goal:
  a task is ephemeral, and composing a board per task is labour nobody repeats — if someone asks, the
  answer is the `projectId` segment, not a task segment. A region placement follows the same shape.
- **The narrow-window collapse is inherited free.** A surface too narrow for twelve cells is simply
  always collapsed, and its stored geometry returns intact when it is widened.

The `ownerId` segment now also carries **Home tabs** (`tabs.md`): a tab is the scope
`home/<tabId>`, the first consumer of that segment on the home surface, and proof the key format
needed no change to grow a surface a second dimension.

**Where placements surface in the accepted UX** (`wizard.md`): the wizard's Place step renders
every surface as a card — Home and the task pane live, unbuilt surfaces present but disabled with
their gate named — so shipping one of the deliverables below means enabling a card, not designing a
step. The panel overflow menu's "Move to…" submenu (README § smaller items) is the other seam:
each new surface is one more row there, current placement checked.

Two deliverables, nearest first. Neither changes the wire contract.

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
contributions**. Cooperative extension points already exist
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

Home and the task pane hold these already. Each new surface must hold them too, not re-derive them:

- A placement whose owning plugin is disabled or uninstalled disappears from view; its persisted
  definition survives inert and returns with the plugin.
- A panel whose collection is unavailable renders as the inert "source unavailable" panel inside
  any placement.
- The user's hand-built compositions are never collateral damage of plugin lifecycle events.

## Verify before building

- `dashboards/DashboardPane.tsx` — the worked example both items copy: a scope constant, a
  container, and nothing else.
- The extension-point contract (`docs/plugins.md § Cooperative extension points`) — regions must
  ride it; check what its declaration shape can already express before adding constraint keys.
- The frame `layout` template vocabulary (`pluginManifest.ts`, `plugins/frames/`) — the
  host-drawn-region rule assumes reserving regions via layout templates is still the pattern.
- `ChromeSourcePanel` — the side-panel deliverable assumes source panels are still host-rendered
  there.
- The grid's narrow-window collapse (`PanelGrid.tsx`) — a region too narrow for twelve cells inherits
  it for free, and the per-scope `layouts` key already carries these new scopes.
