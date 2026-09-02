# Analysis: how acorn notifies today

The read, 2026-09-02. Every finding names the file it was read from. Paths are hints; the tree moves.

## The boxes as drawn

Two clients, one node. The node runs the agents (`plugins/agents/src/server/`) and the terminals
(`plugins/terminal/src/server/`) and projects a state onto every session row. The desktop renderer
and the terminal client both boot `@acorn/client-core`, which holds the bell, the notice ring, the
attention inbox, and the toast store under `packages/client-core/src/features/notifications/`. The
desktop shell (`apps/desktop/src-tauri/`) owns the window and installs the platform seam; the
terminal client (`apps/tui/`) installs the same seam from a Node process.

Nothing on the node knows what a notification is. That is the right shape and it stays: the node
knows state, the client decides what is news.

## What is sound and stays

- **The kind registry.** `packages/client-core/src/host/registries/rail/notices.ts` gives every
  notice kind a glyph, a severity, and a `toast` flag, and
  `packages/client-core/src/features/notifications/kindContributions.ts` lists the 14 built-in kinds.
  A plugin adds a kind through `ctx.contribute`. The registry is the right place for "does this kind
  reach the OS", and it keeps that job.
- **Target handlers.** `registerNoticeTargetHandler(kind, handler)` in
  `packages/client-core/src/features/notifications/notifications.ts` is one dispatch table for
  "what opens when you click this", shared by notices and attention rows. The agents plugin
  registers `managed-agent` in `plugins/agents/src/client/sessions/managedSelection.ts`.
- **Node stamping.** `pushNotice` stamps `nodeId` from the active node, and every count and
  mark-read filters by it, so a fleet with two nodes never badges a task you cannot see.
- **The attention inbox.** `packages/client-core/src/features/notifications/attentionInbox.ts`
  fans one query per source out across the fleet and merges the rows. The agents plugin's source
  in `plugins/agents/src/client/index.ts` asks the node for `attention: true` sessions, one request
  per node. This is state, not events, and it is fetched, not pushed.
- **The bell.** `packages/client-core/src/features/notifications/NotificationBell.tsx` draws
  "Needs you" above "Notifications" in one popover, and its pill is the sum of unread notices and
  attention rows. The two-section shape is right and the user asked to keep it.
- **The notice-versus-attention distinction.** `docs/frontend.md` § Shell state states it: an
  attention item is a state on the node and cannot be dismissed from the client; a notice is an event
  that already happened and is client-local.

## Findings

1. **A notice is a client-local event in a ring of 50.** `Notice` in
   `packages/client-core/src/features/notifications/notifications.ts` is
   `{ id, taskId, kind, title, detail?, at, read, action?, target?, nodeId? }`. The ring is a module
   signal capped at `NOTICE_CAP = 50`, mirrored to the `notices` device preference through the
   `core.notices` slice in `packages/client-core/src/infra/persistence/stateSlices.ts`, 64 KB max.
   There is no table, no route, and no node-side record. `docs/state-ownership.md` § Scope rules
   lists notices as device state on purpose.

2. **Managed agents notify on three of seventeen event types, and on every occurrence of each.**
   `notifyForEvent` in `plugins/agents/src/client/sessions/managedStore.ts` raises a notice for every
   `request` (each permission prompt, question, or workflow gate), every `turn_completed`, and every
   `error`. `AgentNormalizedEvent` in `packages/protocol/src/managedAgents.ts` has 17 variants; the
   other 14 are silent. The subscription is app-lifetime, opened by
   `activateManagedAgentNotifications` whether or not any agent surface is mounted. This is the
   function the complaint is about. A session that asks for permission five times in one turn and
   then finishes raises six rows and up to six OS toasts.

3. **`turn_completed` is per turn, not per session.** The node's reducer in
   `plugins/agents/src/server/sessions/stateMachine.ts` clears `working` only on `turn_completed`,
   and a workflow session completes a turn per step. A ten-step workflow raises ten "Managed agent
   completed a turn" rows, beside the `run-done` notice the workflows plugin already sends from
   `plugins/workflows/src/node/index.ts`. The same fact reaches the bell twice.

4. **The node already projects the state herdr has to scrape for.** `projectAgentEvent` in
   `plugins/agents/src/server/sessions/stateMachine.ts` maps every event onto `AgentAttentionReason`:
   `request` becomes `permission`, `question`, or `workflow_gate`; `turn_completed` becomes
   `completed`; `error` becomes `error`; a stray assistant message becomes `unread`; `user_message`
   and `request_resolved` reset to `none`. The row is re-serialised and broadcast on the
   `agent:session` channel after every event, so the client sees each attention change as a row
   upsert. The notification layer ignores this and reads the raw events instead.

5. **PTY agents have a second edge detector with its own rules.** `detectEdges` in
   `packages/client-core/src/features/notifications/notifications.ts` diffs consecutive terminal
   session snapshots on every `term:status` ping (`packages/client-core/src/features/tasks/agentSessions.ts`)
   and raises `finished` on running-to-idle, `needs-input` on entering `blocked`, and `exited` or
   `error` on exit. The `AgentState` vocabulary is `packages/protocol/src/terminal.ts`. The
   function is pure and tested, and it is the right shape. It is just one of two shapes.

6. **The OS toast is gated; the bell row is not.** `shouldToast` suppresses the toast when
   `document.hasFocus()` is true and applies a 30 second cooldown per task and kind. The row lands
   regardless. So a chatty agent you are watching fills the bell while the toast stays quiet, and the
   pill climbs for things you saw happen.

7. **"Focused" is the whole window, never the session.** Nothing asks whether the notice's task is
   the one on screen. The active task is `activeTaskId` in
   `packages/client-core/src/features/tasks/tasks.ts`, and activating a task already calls
   `markTaskRead` (`packages/client-core/src/features/tasks/activate.ts`), so the concept exists on
   the read side and not on the write side.

8. **The OS notification almost certainly does nothing on the desktop.** Three sites call
   `new Notification(title)` inside a try block. No file in the repo calls
   `Notification.requestPermission()`. `apps/desktop/src-tauri/Cargo.toml` lists no notification
   plugin, `apps/desktop/src-tauri/capabilities/default.json` grants `core:default` only, and
   `apps/desktop/src-tauri/src/lib.rs` initialises dialog, opener, and single-instance. In a WKWebView
   without a granted permission the constructor throws or no-ops, and the catch swallows it.

9. **There is no sound, no badge, and no terminal notification.** No `AudioContext`, no audio
   asset, no `set_badge_count` or dock tile call, no OSC 9, 99, or 777. The only `\x07` in the tree
   is stripped from terminal output in `plugins/terminal/src/server/terminalUtils.ts`, and the one
   OSC the terminal client emits is OSC 52 for the clipboard in `apps/tui/src/kit/copy.ts`.

10. **The terminal client has toasts and nothing else.** `apps/tui/src/chrome/Notifications.tsx`
    draws the shared toast store above the footer. It never calls `initWorkflowNotices` or
    `initSessions`, registers no topbar slot, and has no bell, ring, unread count, or inbox.

11. **Workflow notices are gated on the terminal plugin.** `apps/desktop/src/client/App.tsx` mounts
    `initWorkflowNotices()` inside `hasHostCapability({ plugin: 'terminal' })` beside `initSessions`.
    A node without the terminal plugin loses its gate and run-done notices for no reason.

12. **The workflow notice payload is untyped on the wire.** `packages/node-core/src/server/notify.ts`
    broadcasts `{ channel: 'workflow:notice', notice }` and `wsOnNotice` in
    `packages/client-core/src/infra/node/wsClient.ts` casts it. `docs/api-reference.md` names the
    channel. Not a defect this programme fixes, but a phase that touches the client side should not
    make it worse.

13. **Settings are one registry and one preference mechanism.** `SettingsContribution` in
    `packages/client-core/src/host/registries/shell/settings.ts` takes `{ id, label, group, order, requires?, component }`;
    core's pages are listed in `apps/desktop/src/client/pageContributions.tsx` and a plugin adds
    one through `ctx.settingsPages.register`. A preference is a key in
    `packages/client-core/src/infra/persistence/prefKeys.ts`, written through `savePref` in
    `packages/client-core/src/features/settings/savePref.ts`, and it is device-local when the key is
    listed in `DEVICE_KEYS` in `packages/client-core/src/infra/persistence/devicePrefs.ts`.
    `packages/client-core/src/features/settings/AppearanceSettings.tsx` is the 65-line template.
    There is no Notifications page; `docs/features.md` § Settings and fleet lists the sections and
    does not name one.

14. **The terminal client cannot hold a device preference.** `readDevicePrefs` returns `{}` and
    `writeDevicePref` is a no-op where `localStorage` is undefined, and the terminal client installs
    no storage. Every device-scoped setting, theme included, is unsettable there today. A
    notifications setting that lives in a device preference is therefore a desktop setting until the
    terminal client gains a store, and `docs/tui.md` § Where the TUI keeps things names the config
    directory that store would live in.

15. **Window focus is known on both hosts.** The desktop has `document.hasFocus()`. The terminal
    client's renderer, OpenTUI, enables DEC mode 1004 focus reporting and emits
    `CliRenderEvents.FOCUS` and `BLUR` (`references/opentui/packages/core/src/renderer.ts`,
    `focusHandler`). Nothing in `apps/tui/src` listens for either.

16. **A completed session stays in "Needs you" until the next message.** `needsAttention` in
    `plugins/agents/src/client/sessions/agentActivity.ts` counts `completed` as attention, and only
    `user_message` or `request_resolved` resets the node's field to `none`. A finished turn you have
    read keeps its row and keeps counting in the pill until you type. The reducer is right to record
    it; the client has no way to say it was seen.

17. **A core event already announces the edges, coarsely.** `agent-session:changed` in
    `packages/protocol/src/nodeEvents.ts` carries `{ taskId, sessionId, event: 'completion' | 'attention' }`,
    emitted from `plugins/agents/src/server/sessions/runtimeEngine.ts` through the same classifier
    the webhooks use (`plugins/agents/src/server/webhookService.ts`). It reaches the client event bus
    and the plugin-frame channel allowlist, and nothing in the bell reads it. It is not needed for
    this programme, because the session row carries the same fact with more detail, but it is the
    hook a remote or headless consumer would use.

## Where the noise comes from, in one list

Findings 2, 3, 5, 6, and 7 together. Two detectors with two vocabularies, both keyed on events
rather than on state changes, both blind to what is on screen, one of them firing once per turn on
sessions whose completion another plugin already reports, and a focus gate that quiets the toast but
not the list.
