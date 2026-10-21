# Phase 4: app cards in the sidebar

Date: October 21, 2026. Status: done. Needs phase 3.

## Completion note

Landed on October 21, 2026, on the `phase-4-app-cards` branch.

What landed:

- The split. `plugins/trellis/src/embed/AppRuntime.tsx` runs a program and holds every check that
  bounds one: plain data, the web-only rule for links, the confirms, the read-only rule, and the row
  check against the plan's last run. `bindings.tsx` and `plainData.ts` moved to `embed/`, and
  `embed/appState.ts` holds `keepState` with the 400 millisecond save delay. The desktop's
  `client/AppView.tsx` builds an `AppHost` from `writeJson`, `taskById`, and `composeForAgent`, and
  `client/appState.ts` keeps the query cache copy that a card and the pane share.
- The bridge. `app.view`, `app.run`, `app.state`, and `app.restore` in `extensionBridge.ts`, and the
  host's handlers in `apps/cli/src/browser/bridge.ts`, with the trellis routes and the revision cache
  in `browser/apps.ts`. `runDraftPlan` and `activeTask` are shared with `panel.run`.
- The sidebar. `AppCard.tsx` loads with `lazy` from `Conversation.tsx`. The composer hands the
  conversation an insert function through `insertRef`, which **Ask the agent** uses.
  `apps/extension/src/sidebar/appKit.ts` is the sidebar's `@acorn/plugin-api/ui`.
- Docs: native messaging, the conversation view, agent-built apps, security, conventions, package
  shape, and first-party plugins. The site page "Talk to an agent from the browser" too, marked
  checked.
- Tests: checkpoints 2 and 3 as written, plus the schema's caps, an archived task, an older host, a
  hint that collapses a card, and a restore that collapses another card.

Decisions and deviations:

- `embed/` is an eighth plugin folder name, not a package. It's trellis's library, bindings, and
  runtime together, and splitting the library into a package would have moved the Node's checks too.
  The arch tests hold `embed/` to the client tier's rules: kit purity, the client side, and app
  imports only through a listed edge. The exports map names each `embed/` file, not a wildcard, so
  `plainData.test.ts` can stay beside its module.
- Requirement 3 isn't met as written. A program's `Panel` draws with a `Panel` component the client
  hands `AppRuntime`, not with `RunPanel` everywhere. The desktop passes `PlanPanel`, so its panels
  keep their row menus, drill-downs, refresh intervals, and pause when off screen, none of which
  `RunPanel` has without the 873 lines of `PublishedDashboardPanel` around it. The terminal keeps its
  one line. The sidebar passes a `RunPanel` that runs through `host.runPlan`. Importing `RunPanel` in
  `embed/` would also have made trellis depend on client-core at run time.
- `AppHost.rowAction` answers `{ outcome, url? }`, not `{ outcome }`. The desktop's action can answer
  with a link, and the runtime confirms and opens it, so the confirm stays in the runtime.
- `loadState` is on `AppHost`, but the desktop reads state through its shared query, whose query
  function is `loadState`. `AppRuntime` calls `loadState` itself only when its client passes no shared
  copy, as the sidebar doesn't.
- The runtime refuses a state over 256 KiB before it calls a host, so both clients say the same
  thing. `APP_STATE_MAX_BYTES` moved to trellis's `shared/api.ts` from its store. The bridge schema
  has its own copy, because protocol can't import trellis.
- `app.view` answers the task, or null once it isn't active. That gives the card its task for
  `Query("task")` and tells it to draw one line, with no extra operation.
- `app.run` inputs are capped at 64 KiB of JSON. The doc set no cap.
- `@acorn/plugin-api/ui` needed an alias. client-core has no `sideEffects` flag, so the facade's
  barrel would have pulled the whole kit, the diff viewer, and the editor into the sidebar. The alias
  is in `vite.config.ts`, `vitest.config.ts`, and `tsconfig.json`'s `paths`, as the terminal's is.
- A restore moves an app's head without a hint, and each sidebar card reads its own summary. So
  `Conversation` counts restores and every app card reads again on one. The real sidebar check found
  this: the head's card stayed interactive after another card restored.
- Verify before building. The summary's `taskId` is the task's ID for a task app, and absent for a
  project app. Every `/v1/*` route honors `Idempotency-Key`, so a restore retried with the same key
  makes one revision. The desktop debounces saves by 400 milliseconds and flushes on unmount, and the
  sidebar uses the same code.

Checks:

- Trellis (49 tests), the extension (287), the CLI (176), protocol (325), the terminal client (866),
  and the arch tests (95) pass. `tsc` passes in those packages, the desktop, and plugin-api.
- Checkpoint 1 wasn't run in `pnpm dev:agent`. The desktop's trellis tests and the terminal's
  `trellis.test.tsx` pass unchanged, apart from one import path.
- Checkpoint 4 ran without a live agent. A seed script wrote a task, a two-revision app, and two
  `app_show` calls into a `pnpm dev:extension` session's Node. The sidebar drew v2 with its panel, and
  collapsed v1 to "v1: First checklist. Replaced by v2." Two ticks reached the app's `state.json` on
  the Node and came back after a reload. The link confirm showed `https://example.com/runbook?step=2`
  and opened it in a new tab. **Ask the agent** added "Which step should I do next?" on a line after
  "Hi" in the message box and sent nothing. **Restore v1** made v3, which the v1 card drew. **Restore
  v2** made v4, and the v3 card collapsed at once. The desktop's Apps pane wasn't opened, so a tick
  showing there was checked only by the shared `state.json`.
- Sizes. The sidebar's first load went from 374,984 B to 385,440 B of JavaScript, 116,621 B to
  119,866 B gzipped, measured against a build with the app card import cut out. Rollup moved the kit's
  `Modal` and more of Zod into chunks the card shares with the sidebar. The first app card loads
  `AppCard`'s chunk, 102,124 B (34,533 B gzipped), and `RunPanel`'s shared chunk, 148,162 B in all
  (49,456 B gzipped). The Node service measured 1,915,652 B, under the 1,917,500 B ceiling, from
  1,915,624 B after phase 3. The native host's bundle wasn't measured.

For phase 5:

- Give the sidebar's `AppHost` a `rowAction` that sends `row.act`. The runtime already finds the row
  and action in the plan's last run, confirms, and passes the inputs the plan last ran with. The
  "This action runs in the Acorn app." refusal is the runtime's answer to a host with no `rowAction`.
- The sidebar's `AppPanel` in `AppCard.tsx` draws `RunPanel` with no press handlers, as
  `PanelCard` did before phase 5.

## Goal

An agent's `app_show` call draws as a running app in the sidebar's conversation: its program, its
panels, its saved state, its links, and its **Ask the agent** buttons. Row actions wait for phase 5.

## What the person gets

- The phase 1 line grows into the app, drawn with the kit and the dashboard's views, capped at 480
  pixels with **Expand**.
- Ticks and typed values are saved, and come back in the desktop's card and Apps pane, and the other
  way round.
- An older revision collapses to "v2: added owners. Replaced by v3." with **Show v2** and **Restore
  v2**, as in the desktop.
- A link in the app asks first, showing the full address, and then opens in a new tab.
- **Ask the agent** puts the app's text in this conversation's message box. It never sends.
- **Open in Acorn** opens the app in the task's Apps pane, where **Publish to project** is.

## Starting point

- `plugins/trellis/src/client/AppToolCard.tsx` draws the card. It reads the app's summary from
  `GET /v1/p/trellis/apps/<appId>` and the revision's files from `.../revisions/<n>`, and restores
  with `POST .../restore`. It uses TanStack Query, `openPane`, and the task list.
- `AppView.tsx` runs a revision. It hands the program five things: each plan, run through
  `POST /v1/core/dashboards/run`; the task's ID, title, and branch; one row-action tool, which calls
  `POST /v1/core/data-sources/act`; **OpenUrl**, after a confirm; and **ContinueConversation**, which
  calls `composeForAgent`. It copies every value a program hands it into plain data first
  (`plainData.ts`).
- `appState.ts` reads and saves the program's `$` variables through `GET` and `PUT
  .../apps/<appId>/state`, at most 256 KiB.
- `bindings.tsx` maps the app library to kit components through `@acorn/plugin-api/ui`, and draws a
  `Panel` with `PlanPanel`, which runs through `PublishedDashboardPanel`.
- Every `/v1/p/trellis/apps` route requires a device (`requireDevice` in
  `plugins/trellis/src/server/routes.ts`). None checks which task asks, because a device isn't
  confined to a task. An app's summary names its task.
- lang-core has no `eval` or `new Function`, so the runtime runs under the extension's content
  security policy. lang-core reads `OPENUI_RUNTIME_TELEMETRY_ENABLED` only from a process
  environment, which a browser doesn't have.
- The extension may import only listed plugin files (`tools/arch/boundaries.test.ts`).

## Requirements

### Split the runtime from the desktop

1. `AppView` splits in two:
   - `AppRuntime`, which takes the program, the plan names, a read-only flag, the saved state, and an
     `AppHost`, and draws the program. It owns everything that bounds a program: `plainData`, the
     web-only rule for links, the confirm, and the read-only rule.
   - The desktop's `AppView`, which builds an `AppHost` from `writeJson`, `taskById`, and
     `composeForAgent`, and draws `AppRuntime`.
2. `AppHost` is the whole of what a program reaches:

   ```ts
   type AppHost = {
     runPlan(name: string, inputs: Record<string, unknown>): Promise<{ plan: PanelPlan; run: DashboardRun }>
     task(): Promise<{ id: string; title: string; branch: string | null }>
     compose(text: string): Promise<{ ok: boolean; reason?: string }>
     openUrl(url: string): void
     rowAction?(plan: string, row: string, action: string, inputs: Record<string, unknown>): Promise<{ outcome: string }>
     loadState(): Promise<Record<string, unknown>>
     saveState(state: Record<string, unknown>): Promise<void>
   }
   ```

   `openUrl` is called only after `AppRuntime`'s confirm. `rowAction` is absent until phase 5, and
   the runtime says "This action runs in the Acorn app" when a program calls it without one.
3. A `Panel` in a program draws with `RunPanel` from `runPlan`'s answer, not with `PlanPanel`, so it
   needs no desktop shell. The desktop keeps its row presses by passing its handlers through.
4. `AppRuntime`, the library bindings, and `plainData` move to `plugins/trellis/src/embed/`, with the
   app schemas already in `src/contract/` from phase 1. `tools/arch/boundaries.test.ts` lists the
   extension's imports from both, with reasons.

### The bridge operations

Each names a task, and the host refuses with `not_found` unless the app's summary names that task.
This is the check the host already makes for an attachment, because the Node doesn't confine a
device.

5. `app.view` takes `nodeId`, `taskId`, `appId`, and `revision`, and answers the app's summary, the
   revision's program, and its plan names. It's a read.
6. `app.run` takes `nodeId`, `taskId`, `appId`, `revision`, `plan`, `inputs`, and the viewer's time
   zone. The host reads the revision's files, takes the named plan from them, and runs it as a draft.
   It answers `{ plan, run }`. The browser never sends a plan.
7. `app.state` takes `nodeId`, `taskId`, `appId`, and an optional `state`. Without `state` it reads
   the saved state. With `state` it saves it with a `key`, and the bridge schema caps it at 256 KiB.
8. `app.restore` takes `nodeId`, `taskId`, `appId`, `revision`, and `key`, and posts to the restore
   route.
9. Revisions never change, so the host may keep the last few revisions' files it read, keyed by Node,
   app, and revision, to save a read on every `app.run`. It keeps nothing else between calls.

### The sidebar card

10. `AppCard` in `apps/extension/src/sidebar/` replaces the phase 1 line for a completed app call. It
    loads the runtime, lang-core, and the views with a dynamic import on the first app card.
11. Its `AppHost`:
    - `runPlan` sends `app.run`.
    - `task` answers from the task the conversation belongs to.
    - `compose` puts the text into this conversation's draft, which the sidebar already keeps in
      browser storage. It never sends a turn.
    - `openUrl` opens a new tab.
    - `loadState` and `saveState` send `app.state`. Saves are debounced, as the desktop's are.
12. Only the card showing the app's head is interactive. Older cards collapse, with **Show** drawing
    that revision read only, and **Restore** sending `app.restore`. The summary is read again on the
    session's `agent` hint, so a new revision collapses the older card without a reload.
13. A card in a task that's no longer active draws one line, as in the desktop, because the task's
    data may not resolve.
14. A host that doesn't know `app.view` answers `bad_request`, and the card falls back to its phase 1
    line with "Update the Acorn CLI to see this app here."

## Out of scope

- **Publish to project**, **Turn into a plugin**, and the Apps pane. **Open in Acorn** covers them.
- Row actions. That's phase 5.
- Project apps and apps on dashboards. The sidebar has neither a rail nor a dashboard to show them in.

## Risks

- **A second place that draws programs.** Every check that bounds a program must live in `AppRuntime`,
  not in either host. A review of the split confirms that neither host's `AppHost` calls a value a
  program handed it, the rule recorded in [the October 19 review](../../security/review-2026-10-19.md).
- **Reach.** A paired browser can read and save an app's state and restore a revision, for apps in
  tasks the device can read. The desktop can do the same. Record it in [security](../../security.md).
- **Bundle size.** lang-core, the renderer, and Zod's app schemas load with the first app card. Record
  the size of that chunk and the sidebar's first load.
- **Two windows editing state.** The sidebar and the desktop each keep a copy, and the last save wins,
  as two desktop windows do today. A tick in the desktop shows in the sidebar only after the card
  reads its state again.

## Steps and checkpoints

**Checkpoint 1.** The split, with every trellis test passing and the desktop's card and Apps pane
unchanged in `pnpm dev:agent`.

**Checkpoint 2.** The four operations in the host, with tests for another task's app, an unknown plan
name, a state over 256 KiB, and a restore retried with the same key.

**Checkpoint 3.** The sidebar card, with tests for a fixture program with a `Query`, a `Panel`, a
saved checkbox, a link, and an **Ask the agent** button, and for the collapse and restore.

**Checkpoint 4.** In `pnpm dev:extension`, ask an agent to "build me a checklist for this migration."
The app draws. Tick two items, then open the task's Apps pane in the desktop: both are ticked. Ask
the agent to change the app. The older card collapses, and **Restore** brings it back as the next
revision.

## Docs that change

- [Native messaging](../../browser-extension/native-messaging.md): the four `app.*` operations.
- [The conversation view](../../browser-extension/transcript.md): app cards.
- [Agent-built apps](../../agent-built-apps.md): the extension draws app cards, and the `AppHost` split.
- [Security](../../security.md): what the browser's device can reach in an app.

## Verify before building

- The trellis routes' shapes, especially the summary's `taskId` for a task app.
- Whether `@acorn/plugin-api/ui` resolves to client-core's kit in the extension's build, as it does in
  the desktop's, or needs an alias in `apps/extension/vite.config.ts`.
- How the desktop debounces state saves (`appState.ts`), so the sidebar matches it.
