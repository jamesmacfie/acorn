# Agent panels and apps in the browser extension

Date: October 21, 2026. Status: phases 1 to 3 done, phases 4 and 5 proposed. Checked against `a6842f9b7`.

This programme makes the browser extension's sidebar draw what an agent builds in a conversation: the
dashboard panel from `panel_show` and the app from `app_show`. Today the sidebar draws both as one
line of text, such as "panel_show · completed", with nothing to show what the agent made.

## The problem

The [dynamic UI programme](../dynamic-ui/README.md) shipped panel cards and app cards for the desktop
and the terminal client. The extension wasn't part of it, and its design docs never mention the
extension. Two things stop the sidebar from drawing a card:

1. **The bridge drops the data.** The native host keeps a tool call's ID, title, and status and drops
   its name, input, and output (`conversationEvent` in `apps/cli/src/browser/agents.ts`). The comment
   on `BridgeConversationEvent` gives the reason: a summary never shows them, and they can be
   megabytes. So the sidebar never learns that a call was `panel_show`, or what it drew.
2. **The sidebar has no card slot.** The desktop chooses a card through the agents plugin's
   `agents:tool-card` point. The sidebar's `ToolLineItem` in
   `apps/extension/src/sidebar/Conversation.tsx` draws every call the same way.

Behind those two, the desktop's cards can't simply be mounted in the sidebar:

- **The cards reach the Node directly.** `PanelToolCard`, `PublishedDashboardPanel`, and the trellis
  plugin's `AppToolCard` and `AppView` call Node routes through `writeJson` and `readJson`, under the
  desktop's device. The sidebar holds no token and reaches the Node only through typed bridge
  operations, which the host maps to routes ([browser extension](../../browser-extension.md#what-runs-where)).
- **The views assume the desktop's shell.** `views/Cell.tsx` calls `useNavigate` from the router, and
  `views/StatView.tsx` calls `createMeasureHistory`, which calls TanStack Query's `createQuery`. Both
  run on every mount. The sidebar has neither a router nor a query client, so both throw.
- **The app runtime lives in the trellis plugin's client.** The extension may import a plugin's
  `src/contract/` files only, each one listed in `tools/arch/boundaries.test.ts`. Trellis has no
  contract folder.

## What the person gets

When every phase ships:

- An agent's panel draws in the sidebar's conversation as it does in the desktop: a table, list, stat,
  chart, board, or heatmap, with the run's description above it, and live data.
- An agent's app draws in the sidebar as a card. Its ticks and typed values are saved, an older
  revision collapses with **Show** and **Restore**, and its **Ask the agent** buttons fill the
  sidebar's message box.
- Row actions work in both, after the same confirm the desktop shows.
- Everything the sidebar doesn't do opens in the desktop with **Open in Acorn**: placing a panel on a
  dashboard, editing in the studio, the Apps pane, and publishing an app to the project.

## The phases at a glance

| Phase | What the person gets at the end | Depends on |
| --- | --- | --- |
| [1](./01-card-lines.md) | Each panel and app call reads as a named line with its description and **Open in Acorn**, as in the terminal client. | Nothing. |
| [2](./02-portable-panel-views.md) | Nothing visible. The dashboard views draw without the desktop's router and query client, and a run draws without `PublishedDashboardPanel`. | Nothing. Can run beside 1. |
| [3](./03-panel-cards.md) | Panel cards draw in the sidebar with live data, read only. | 1 and 2. |
| [4](./04-app-cards.md) | App cards draw in the sidebar, with saved state, links, compose, and restore. | 3. |
| [5](./05-row-actions.md) | Row actions in panel cards and app cards, after a confirm. | 3, and 4 for apps. |

Phase 1 is worth shipping alone. It costs a day or two and brings the sidebar level with the terminal
client.

## The decisions that shape it

- **The browser names a call, and the host reads it.** The sidebar never sends a plan, a program, or
  a record to the host. It names a session and tool call, or an app, revision, plan name, and row ID.
  The host reads the plan or program from the Node and runs it. This is the rule the bridge already
  follows for handoffs, where "the task seed never comes from the browser." It also keeps plans out of
  `session.read`: one plan's supplied rows can be 256 KiB (`SUPPLIED_ROW_LIMITS`), and a page holds
  up to 500 records.
- **One bridge operation per thing a card does.** `panel.run`, `app.view`, `app.run`, `app.state`,
  `app.restore`, and `row.act`. No general route proxy, which would give the browser the device's
  whole reach.
- **The sidebar draws with the desktop's views, not copies of them.** Phase 2 makes the existing
  views portable instead of writing a second set. The extension already imports the kit this way.
- **The sidebar's cards are its own components.** They're built from shared parts: the views, the
  run-to-rows step, and the app runtime. `PanelToolCard` and `AppToolCard` stay the desktop's, because
  most of each is desktop work: Add to dashboard, the studio, panes, and toasts.
- **Row actions are checked by the host against a fresh run.** The desktop finds a row's action in its
  own last run, so a program can't name an action the source didn't offer. The host can't trust the
  sidebar's last run, so it runs the plan again and finds the row there. This costs one run per
  action, and keeps the host stateless.
- **The sidebar does no placing, publishing, or editing.** Those flows need Home tabs, regions, the
  studio, and drafts, which the sidebar doesn't have. **Open in Acorn** hands them to the desktop.

## Out of scope

- **Add to dashboard** and **Edit in studio** on a panel card.
- The Apps pane, project apps, the Apps source, and apps on Home tabs.
- **Publish to project** and **Turn into a plugin** on an app card.
- Drawing a dashboard or a Home tab in the sidebar.
- Subagents' tool calls. The sidebar doesn't draw a subagent's stream at all.

## Risks

- **Bundle size.** The panel views, the chart code, and the app runtime (`@acorn/openui-solid` and
  lang-core) join the sidebar. Phases 3 and 4 load them only with the first card, through a dynamic
  import. The sidebar page can import dynamically. Only the background service worker can't. Measure
  the sidebar's first load before and after each phase.
- **The Node's service size ceiling.** Phase 3 adds an agents plugin route. The ceiling in
  `apps/node/scripts/check-service-budget.mjs` has sat within a few kilobytes of the measured size
  through October 2026. Keep the route's handler on the plugin's lazy path, or plan to raise the
  ceiling.
- **A paired browser can do more.** Each phase adds reach to the browser's device credential: running
  a panel's plan, reading and saving an app's state, restoring a revision, and running a row action.
  None of these goes past what the same device can do in the desktop. Each one is named in its phase
  and in [security](../../security.md).
- **Older hosts and sidebars.** The sidebar and the native host ship separately: the extension as a
  build, and the host with the CLI. A newer sidebar talking to an older host gets no `card` field and
  draws plain lines. An older sidebar ignores the field. A new operation an older host doesn't know
  fails with `bad_request`, and the card says to update the CLI.

## Open questions

- **Whether the extension should draw panels at all, or link.** Phase 1 alone answers most "what did
  the agent make" questions. Phases 2 to 5 are about two weeks of work. Decide after phase 1 ships and
  the sidebar has seen real use.
- **Where the app runtime lives.** Phase 4 proposes `plugins/trellis/src/embed/`. A small package
  of its own would also work, and would suit the terminal client too. Decide in phase 4.
- **Panel history.** A stat's history trend reads samples kept for a published panel. An agent's panel
  is never published, so it has no history. Phase 2 makes history optional, and the sidebar never
  supplies it.

## Owning documents this programme extends

Read these before changing code: [browser extension](../../browser-extension.md),
[native messaging](../../browser-extension/native-messaging.md),
[the conversation view](../../browser-extension/transcript.md),
[agent conversations](../../browser-extension/conversations.md), [dashboards](../../dashboards.md)
and its [views](../../dashboards/views.md), [agent-built apps](../../agent-built-apps.md),
[agent tools](../../agent-tools.md), [the managed agent transcript](../../managed-agents/transcript.md),
and [security](../../security.md).

## Verify before building

Recheck the starting point named in each phase against the code before building it. Don't describe
anything in this folder as shipped until its phase has a completion note.
