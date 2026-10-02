# Workstream 4: row actions and navigation

Status: proposed, 2026-10-02, revised the same day. Depends on
[workstream 2](./02-source-first-editor.md). Read
[navigation and row actions](./design.md#navigation-and-row-actions) first.

## Goal

The panel author decides what pressing a row does and which buttons sit at the end of it: open the
item in place or in a side panel, open its task, open a plugin pane, open the browser, start a task
from it, or run one of the record's own actions. Actions run on the Node against the record as it is
now, not as it was when the row was drawn. Plugins declare what they can open, including things that
have no web address. Summary rows, measure cells, and group headers open exactly the rows they stand
for.

## Milestones

| Milestone | Parts of this workstream |
| --- | --- |
| 1 | Run rows carry full record references, and the author chooses what a row press opens and where, using the content-link destinations that exist. |
| 2 | Drill-down from group headers, summary rows, and measure cells. |
| By demand | Named record actions run on the Node, `navigate` and `createTask` as record verbs, targets without URLs, buttons, the row menu, and the terminal row menu. |

## What the owner gets at the end

- A **When a row is pressed** stage in the editor, and up to three buttons per row.
- Pull requests, issues, tasks, agent sessions, workflow runs, and plugin panes as destinations, each
  in the presentations its plugin supports.
- **Start a task from this row** on any row.
- Named record actions such as **Re-run job** as buttons, checked again on the Node before they run,
  with the host's confirmation for anything that writes or runs.
- Pressing "failing CI: 7" in a summary opens those seven pull requests.
- The same actions as a row menu from the keyboard.

## Starting point

- Records carry one optional `action` from the closed set in
  `packages/protocol/src/data/dataActions.ts`: `openPane`, `openTask`, `runNodeAction`, `openUrl`,
  `openOverlay`, and `surfaceAction`, each with an optional risk tier. The source chooses it.
- `runChromeAction` in `packages/client-core/src/host/chrome/actions.ts` also runs `navigate` and
  `createTask`, which data records can't name. For `runNodeAction`, the client posts to the plugin
  route the row carried.
- `PublishedDashboardPanel.tsx` always passes `prefer: 'route'` and builds the item as
  `{ id: row.sourceRowId ?? row.id, title: row.id }`. Projection in
  `packages/dashboards-core/src/typedProjection.ts` keeps the plugin, query-instance source, record
  ID, task ID, and action, and drops the account and scope from the record reference.
- `openInAppUrl` and the content-link registry in
  `packages/client-core/src/host/registries/panes/contentLinks.ts` resolve a recognized URL to a full
  page, a side panel, or a task pane, falling back to the browser. Plugins contribute URL recognizers,
  and link cells in tables already use them.
- The confirmation strip for `write` and `execute` actions is drawn by the host in
  `PublishedDashboardPanel.tsx`.

## Requirements

### Basic presses

1. Run rows carry every record reference they came from, with account and scope, plus task IDs, link
   columns, and each record's actions.
2. The plan's `actions.press` opens a reference, which is the record's own item, its task, or a link
   column, in a preferred presentation: full page, side panel, task pane, or browser. Without a press,
   a row runs the record's default action, as it does today.
3. When the preferred presentation isn't available for a row, the host falls back down the existing
   order. When nothing is available, the row isn't pressable and says why on hover.
4. The editor's press stage lists only references and presentations that resolve for the chosen
   sources, and the describer writes "Pressing a row opens the pull request in a side panel".

### Drill-down

5. Pressing a group header opens its rows in a side panel. The drill-down plan is the panel's plan with
   the group's key values added as a filter and grouping removed.
6. Pressing a summary row or a measure cell opens the rows it stands for. The host builds the
   drill-down plan from the stages before that summary, adds filters for the group's key values and
   for the measure's own filter, and keeps the original evaluation instant, time policy, and resolved
   context values. A count of seven opens seven rows.
7. The drill-down side panel is read-only and offers **Add as panel**.

### Named actions run on the Node

8. Records may declare `actions`: a list of named actions, each with an ID, label, optional icon, a
   verb from the closed set, and a risk tier. The existing `action` stays as the default press.
9. Add an `act` operation on the Node. The client sends the action ID and the full record reference.
   The Node asks the source for that record's current actions, checks the account's authority and the
   action's eligibility again, and dispatches through the plugin's confined route. The client never
   posts a route copied from a row.
10. Write and execute actions show the confirmation strip before the client sends anything. Cancelling
    sends nothing. Each press carries an idempotency key, so a retried request can't run the action
    twice, and the outcome, including a refusal because the action no longer applies, is reported in
    the panel.
11. `navigate` and `createTask` become record verbs. The dashboard supplies what they need: the project
    from the row's task or the panel's scope, and the promotion path the rail uses to start a task.

### Targets

12. The content-link registry accepts targets named by kind and item ID as well as by URL. A kind is
    namespaced as `<plugin>.<thing>`, such as `agents.session`, and is bound to the registering plugin
    by the host.
13. A target declares the presentations it supports: full page, side panel, task pane, overlay, and
    external. Compiled plugins register through the existing contribution path. Loaded plugins declare
    targets in their manifest's `contentLinks`.
14. Records may name targets directly, and link columns resolve through URL recognizers. Agent
    sessions, workflow runs, and task panes declare targets.

### Buttons and menus

15. The plan's `actions.buttons` holds up to three buttons. Each has a label and an optional icon, and
    does one of three things:
    - Opens a reference with a preferred presentation.
    - Runs a named record action through the Node.
    - Starts a task from the row.
16. A row merged from several records offers an **Open** menu listing each record.
17. Buttons are also a row menu, reachable with the context-menu key and Shift+F10. A row's press is
    Enter. The terminal client draws the same row menu once it draws panels.

### Editor and AI

18. `describe` returns the targets and named actions a source's records offer, so the editor and the
    AI see only what resolves.
19. Requirements such as "clicking opens the issue in a side panel" point at `/actions/press`. The
    evaluation suite adds cases for presses, drill-down counts, buttons, and a destination that
    doesn't exist.

## Done when

Milestone 1: a pull request panel opens a row in a side panel on press.

Milestone 2: pressing "failing CI: 7" in a repository summary opens a side panel with exactly those
seven pull requests, evaluated at the same instant as the summary.

By demand: a pull request panel has **Start task** and **Open in browser** buttons, an agent sessions
panel opens a session that has no URL, a **Re-run job** button asks first and then runs only if the
job can still be re-run, and every action works from the keyboard.

## Docs to update

- [Dashboards](../../dashboards.md): presses, drill-down, buttons, and the row menu.
- [Typed data sources](../../data-sources.md): named record actions, the new verbs, and record targets.
- [API reference](../../api-reference.md): the `act` operation.
- [Plugins](../../plugins.md) and [plugin authoring](../../plugin-authoring.md): targets and
  presentations in `contentLinks`.
- [Security](../../security.md): actions resolved on the Node, confinement, confirmation, and
  idempotency.
- [Command palette and shortcuts](../../command-palette-and-shortcuts.md): the row menu keys.

## Verify before building

- The manifest schema for `contentLinks` descriptors and what loaded plugins can declare today.
- How `openPluginContentTarget` and `openRefPanel` choose a pane and a side panel, so kind-and-ID
  targets reuse them.
- How a source can answer "this record's current actions" cheaply, through `details` or a targeted
  query, for each first-party source.
- The promotion path that rail rows use for `createTask`, and what it needs from a row.
- Whether a side panel can host a read-only derived plan, or whether drill-down needs its own
  presentation.
