# Phase 5: start a workflow from an item

Status: SHIPPED 2026-09-08. [docs/workflows.md](../../workflows.md) § Starting a run from an item
owns the flow, [docs/plugins.md](../../plugins.md) § Context menus owns `item.row` and the three
lists, and [docs/integrations.md](../../integrations.md) § The row menu owns the menu itself.

Five deviations from what is written below, each for a reason:

- **GitHub's source had no `promotion`, so the modal could not draw for a pull request.** It has one
  now (`plugins/github/src/client/pullTasks.ts` § `githubPullPromotion`), deliberately thinner than
  the list's own `promotePullToTask`: it keeps the find-or-create, which is what "attach to the PR's
  task" means here, and drops the Linear link seeding, which needs a QueryClient the contract cannot
  hand over. The list's own **Create task** row still runs the full path, unchanged. There is no
  `attachToCurrentTask`, because a pull is recorded as `pullNumber` on the task row rather than as a
  link.
- **The modal is mounted in the shell's `overlay` slot by the workflows plugin**, not "through the
  existing overlay path", which turned out to be the only always-present mount a plugin has. That
  needed `PromoteToTaskModal` on `@acorn/plugin-api/ui/host` and a terminal counterpart, which is a
  one-line stub: the terminal mounts no overlay slot and its source panel draws no row menu.
- **`ContextMenuItems`, the host's `<For>`, did not go onto the plugin API.** `contextMenuItems` and
  `runContextMenuItem` did instead, and github's list writes its own eight-line loop with its own
  host's `Menu.Item`. Exporting the component would have meant a second terminal counterpart for a
  node the terminal already has.
- **Neither Rollbar nor Linear had a description on a list row to put in `body`.** Linear's triage
  query asks for one now, capped at 2,000 characters where the row is built. Rollbar's list carries
  no prose at all — an item's body is its stack trace, a second call per row — so its `body` is the
  facts the row already has: level, environment, occurrences, permalink. GitHub's comes from the
  warmed detail cache when there is one.
- **The prefill rule takes no `inputs`.** It returns the five names it knows and the modal picks the
  ones its definition declared, which is the same rule with one fewer argument.

`PLUGIN_API_MAJOR` stayed at 10: every change to the surface was additive.

## Goal

A Rollbar error, a Linear issue, and a GitHub pull request each have "Start workflow…" in their row
menu. It picks a workflow, fills its inputs from the item, creates a task or attaches to one, starts
the run, and lands on the run pane. The three menus draw from one registry.

## Why this phase, and why now

It is the one-click version of the owner's first workflow. It comes last among the desktop phases
because it needs a definition to pick (2), a picker and an inputs form to draw (3), and a pane to
land on (4).

## Scope

In: the `item.row` location, the three lists on the registry, the existing **Create task…** row
moved onto it, the modal's workflow step, `PluginRailTask.body` read and filled, the prefill rule.

Out: the terminal client's descriptor source panel, which omits the row menu today (a door left
open).

## Design detail

**Location.** `CONTEXT_MENU_LOCATIONS` in `packages/protocol/src/contextMenus.ts` gains `item.row`
with facts `providerId` and `projectId`. `ContextMenuTarget` in
`packages/client-core/src/host/registries/panes/contextMenus.ts` gains `ItemRowTarget { location:
'item.row', id, title, providerId, projectId, body?, link?, item: unknown }`. The manifest
descriptor's `when` check reads the facts table, so a loaded plugin can contribute a row here too.

**Three menus, one registry.** `ChromeSourcePanel.tsx` draws its `RowActions` from
`contextMenuItems('item.row', target)` and registers core's own **Create task…** row through
`registerContextMenuItems` on mount, with `when: (t) => !!t.item.task`. `PullList.tsx` does the
same with its `openAsTask`. The Rollbar and Linear source descriptors change nothing.

**The workflows rows.** `plugins/workflows/src/client/index.ts` registers one `item.row`
contribution, "Start workflow…", `order` after Create task, `run: (target) =>
openStartFromItem(target)`.

**The modal.** `PromoteToTaskModal` gains an optional `workflow?: { definitions, initial?,
onStart(taskId, defId, inputs) }` prop. When present, it draws the picker and inputs above the tabs,
renames the primary buttons to **Create & run** and **Attach & run**, and after `create` or `attach`
succeeds calls `onStart`. The workflows plugin's `openStartFromItem` mounts the modal through the
existing overlay path with `providerId = target.providerId`, the merged definitions for the
workspace, and inputs prefilled by the name rule from the target's `title`, `body`, and `link`. On
start it navigates to `/t/<taskId>?pane=workflows&item=<runId>`.

**Body.** `PluginRailTask.body` is read by the prefill. `plugins/rollbar/src/shared/rail.ts` and
`plugins/linear/src/shared/rail.ts` fill it with the item's description when they do not already.
GitHub's `openAsTask` builds a target with the PR body.

**Prefill rule.** In `plugins/workflows/src/client/startFromItem.ts` (new): `issue`, `item`, or
`context` gets title and body; `link` or `url` gets the link; anything else stays empty.

## Code touched

- `packages/protocol/src/contextMenus.ts`, `packages/protocol/src/plugin/contract.ts` (the
  descriptor's location enum).
- `packages/client-core/src/host/registries/panes/contextMenus.ts`: the target type.
- `packages/client-core/src/host/chrome/ChromeSourcePanel.tsx`, `plugins/github/src/client/PullList.tsx`.
- `packages/client-core/src/features/integrations/PromoteToTaskModal.tsx`: the workflow prop.
- `plugins/workflows/src/client/startFromItem.ts` (new), `plugins/workflows/src/client/index.ts`.
- `plugins/rollbar/src/shared/rail.ts`, `plugins/linear/src/shared/rail.ts`: `body`.
- `packages/protocol/src/api.ts`: `PluginRailTask.body` documented as read.

## Tests

- `packages/client-core/src/host/registries/panes/contextMenus.test.ts` (extend): an `item.row`
  row with `when: { providerId: 'rollbar' }` appears for a Rollbar target and not a Linear one.
- `packages/client-core/src/features/integrations/PromoteToTaskModal.test.tsx` (new or extended):
  with the workflow prop, a required input empty disables the primary button; on create, `onStart`
  is called with the new task's id and the inputs.
- `plugins/workflows/src/client/startFromItem.test.ts` (new): the prefill rule.
- The parity and disable snapshots do not change, because a context-menu row is not a golden-listed
  kind. If they do, that is a finding.

## Docs owed

`docs/plugins.md` § Context menus (`item.row`, its facts, the three lists on the registry);
`docs/contribution-kinds.md` (the row's locations); `docs/workflows.md` § Starting a run (the item
flow); `docs/integrations.md` (the row menu is registry-drawn); `docs/testing.md` smoke items.

## Doors left open

- The terminal client's `apps/tui/src/plugins/SourcePanel.tsx` omits the row menu; adding it there
  gives the terminal both rows at once.
- A loaded plugin contributing an `item.row` action through its manifest, which the facts table
  makes possible and nothing yet exercises.

## Done when

- From a Rollbar row, "Start workflow…" → pick the owner's first workflow → the issue input is
  prefilled → Create & run → the task opens on the run pane with both investigators running.
- The same from a GitHub pull request row, attaching to the PR's task.

## Verify before building

- `CONTEXT_MENU_LOCATIONS` is still `['task.row']`.
- `ChromeSourcePanel.tsx` still draws the row menu inline around line 230; `PullList.tsx` still
  hard-codes its `RowActions` around line 226.
- `PromoteToTaskModal` still takes `providerId, item, itemTitle, headerLabel, attachTasks,
  existingBranches, onClose, onCreated, onAttached`.
- `PluginRailTask.body` is still unread on the client.
