# UI

## Parity first

A fresh vNext install must look and behave like V1. That means, concretely:

- Shell: left TabRail (sources → workspaces → tasks), topbar, one main region (fleet view,
  workspace source, task view, or GitHub browse), terminal drawer, overlays.
- Task view: the flat left-to-right pane row (`panes[] + weights + pinned`) — show/add/close/
  pin/move/resize/equalize/maximize. Closing the last unpinned pane falls back to the PR pane.
- The 13 panes with their V1 order and chords: agents (15, ⌘⇧A), pr (10, ⌘⇧R), changes (20, ⌘⇧G),
  notes (30, ⌘⇧D), context (40, ⌘⇧X), editor (50, ⌘⇧E), search (60, ⌘⇧F), database (70, ⌘⇧J),
  docker (75), http (76, ⌘⇧H), preview (80, ⌘⇧B), linear (⌘⇧L), rollbar (⌘⇧O).
- The 6 default sources: GitHub, Docker, API Requests, Linear, Rollbar, Agent Center.
- Command palette, ⌘1–9 pane focus, ⌘⇧T terminal drawer, ⌘⇧N new task, typing protection,
  12 themes × 4 style packs (the two-axis appearance system), settings pages.
- Task creation flows (from PR, Linear issue, Rollbar item, or local), lazy worktree creation,
  branch-prefix rules — all V1 behavior.

Parity is a checklist to walk in the release phase (plan.md), not a wire-compatibility claim.
Storage keys and formats may change; visible behavior may not, except for the recorded
divergences: editor autosave surfaces conflicts instead of unconditionally overwriting;
`/api/v1` automation tokens are gone; preview's raw shell URL-script mode is removed.

## New surfaces (additive)

**Fleet home** — the landing view when more than one node is paired: a card per node with
connection state, health, active agents/tasks, attention count, last-refresh. With only the
bundled local node, this view stays out of the way; first-run never mentions nodes at all.

**Node management (Settings → Nodes)** — add node (pairing flow: endpoint or QR payload +
fingerprint confirmation), rename, reconnect, revoke this or other devices, unpair (local
forget vs node-side revoke are distinct and labeled). Node identity change shows a hard warning
screen with old/new fingerprints.

**Aggregated surfaces** — Agent Center, attention inbox, notifications, and search go
fleet-wide: parallel per-node fetches, per-node timeout, merged results, every row carrying a
node badge. Partial results render with a "node X unavailable" banner. Selecting a workspace
switches node context atomically and restores that workspace's last source/task/layout
(V1's per-workspace restore, now node-qualified).

**Settings → Plugins** — the list of plugins with enable/disable toggles (per node), each
plugin's settings pages, and its connection/credential status. No install flows.

## State ownership

- Client owns presentation: selection, layouts, pane weights/pins, drawer height, theme/style,
  keybindings, window geometry, drafts. All keys that touch node resources include the nodeId.
- Node owns everything else. The client cache is disposable (data.md); the UI must never infer a
  mutation succeeded from cache.
- Restore order on launch: fleet + nodes → selection → main view → task layout → panes. Missing
  nodes render placeholder cards, not errors; unknown pane IDs render placeholders.
- Dirty text (editors, comment boxes) is client memory: survives pane switches, not restart.
  Secret input fields never persist anywhere client-side.

## Connection and staleness vocabulary

Every node-backed surface can render exactly one of: `live`, `refreshing`, `stale` (with age),
`offline` (cached), `disabled` (plugin off), `error` (with retry). No infinite spinners: anything
past its deadline resolves to stale/offline/error. Terminal panes additionally show
attached/disconnected and disable input while disconnected.

Offline behavior: reads come from cache with badges; mutations fail fast with a clear "node
offline" error and keep the user's input as a draft. Nothing is queued for later automatic
replay.

## Prompts and notifications

- Prompts (destructive confirmations, secret entry, agent approvals) are host-owned modal
  chrome, rendered by the shell, not by plugin panes — a UI convention in vNext (all code is
  first-party), kept consistent so approval UX is uniform.
- Notices: toasts for transient info/errors, rate-limited, grouped per node in a notice center.
- Attention inbox: durable items needing action (agent approvals/questions, setup incomplete,
  failures), sourced from node queries + events, resolved by node commands; dismissal of
  informational items is client-local.
- OS notifications: opt-in per kind, contain titles only, never content.
