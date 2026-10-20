# Phase 4: app cards in the sidebar

Date: October 21, 2026. Status: proposed. Needs phase 3.

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
