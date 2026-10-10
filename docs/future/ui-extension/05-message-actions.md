# Phase 05: add message and turn actions

Status: done, October 10, 2026. Branch `phase-05-message-actions`, from `9b638379a`.

## Completion note

Another plugin can add rows to a transcript message and to a finished turn. A message's rows draw
after **Copy as text**, **Copy as Markdown**, and **Copy as JSON** in the same menu. A turn's rows draw
in an actions menu on its `Turn complete` line. Both hosts draw the same rows. A row reaches only its
own plugin's route, with the target's identity and, for a message, the text the card shows. It can't
send, answer, retry, or edit anything, and no stored event or message identity changed.

### What landed

- **Protocol.** `agent.message` and `agent.turn` join `CONTEXT_MENU_LOCATIONS`. A message's facts are
  `projectId`, `role`, and `status`. A turn's are `projectId` and `status`. The manifest schema, the
  generated `acorn-plugin.schema.json`, and the `plugin_authoring` brief follow, and the brief names
  both bodies.
- **Targets.** `AgentMessageTarget` and `AgentTurnTarget` sit in client-core's `contextMenus.ts`,
  exported through `@acorn/plugin-api/client`. A message is `{ location, nodeId, taskId, projectId,
  sessionId, itemId, turnId, role, status, text, textTruncated?, revision }`. A turn is `{ location,
  nodeId, taskId, projectId, sessionId, turnId, status, revision }`.
- **Dispatch.** `chromeContextMenus.ts` treats file, message, and turn targets alike: same location,
  Node in view, and task still in the target's project. `ownerTargetBody` names every key that leaves
  the client. `runNodeAction` posts `{ message: {...} }` or `{ turn: {...} }`, without `location` or
  `nodeId`. A failed route shows the existing `<plugin>: action failed` toast.
- **Owner.** `plugins/agents/src/client/sessions/transcriptMenus.tsx` builds both targets and draws
  the rows. `messageText.ts` holds the text a message card shows, with attachment-placeholder and
  pasted-marker cleanup moved out of `AgentEventCard.tsx`, so the card and the target share it.
  `AgentTranscript.tsx` binds the Node (taken at mount, the way Editor does) and the task's project
  from the tasks query.
- **Card.** An agent response's Copy menu keeps its three rows and adds contributed rows after a
  separator. Its label becomes "Copy this response or act on it" when it has any. A reader's message
  gets the same menu only when a plugin offers a row on it. A finished turn's `Turn complete` line
  gets **Actions for this turn** only when a plugin offers a row.
- **Types.** `ContextMenuOpening` and `ContextMenuHost` take the location as a type parameter, because
  the rail menus read `target.title`, which message and turn targets don't have.

### Decisions and deviations

- **Finished means settled.** A turn target exists for `completed`, `failed`, `cancelled`, and
  `interrupted`, the set the Node calls settled. `status` is a fact, so `when: { status: 'completed' }`
  narrows it. The menu sits on the `Turn complete` line, so a turn that ended with only an error card
  has no turn menu.
- **`turnId` is required on a message,** not optional as the contract said. A message card without a
  turn row in the snapshot offers no rows. The snapshot holds every turn of the session, so this
  doesn't happen in practice, and a message's `status` would otherwise have nothing to report.
- **`revision` is a number:** the sequence number of the newest event behind the card. A message that
  streams on raises it.
- **Stale checks.** The kit draws a menu's rows only while it's open, so the target is taken then.
  A row runs only while the card still builds the same location, Node, task, project, session, item,
  turn, status, and revision. The host then checks the Node and task as for a file. A plugin disable or
  a registration replacement is refused by the existing registry checks.
- **No menu on a reader's message without rows.** With no contributor, the transcript looks as it did.
- **Text ceiling.** `TextEncoder.encodeInto` into a 64 KiB buffer gives a whole-character prefix. Text
  of up to a third of the limit in UTF-16 units skips the encoder.
- **Plan proposals and subagent messages.** A plan proposal keeps its Copy menu with no rows. A
  subagent's messages get rows like any other, with `role` from the event type.
- **An icon-less row reserves no icon slot,** so its label lines up with the Copy rows. Editor's
  `contributedMenuRows.tsx` reserved one until the final check, which made it match.
- **No committed fixture,** as in phases 01 to 04. The real-host plugin was a scratch build.

### Verification

Run with Node 26.8.1.

- `contextMenus.test.ts` (protocol), `manifest.test.ts` and `pluginAuthoring.test.ts` (node-core): the
  locations, their facts, the refused `text`, `role` on a turn, and a `surface`. Tests that used
  `agent.message` as an unknown location use `task.footer` or `content.preview`.
- `chromeContextMenus.test.ts`: the exact bodies, `role` and `status` matching, and refusals for a
  changed Node, a task gone or moved, a disabled plugin, and a replaced registration.
- `transcriptMenus.test.tsx`: fields, shown text with placeholders and markers removed, the 64 KiB
  cut on ASCII and on four-byte characters, and turns offered only once settled.
- `AgentEventCard.test.tsx`: rows after all three Copy formats, the label, user versus assistant
  matching, a turn menu that appears only once its turn finishes, a row refused after the message
  streamed on, its turn changed, or the card switched session, and a throwing row that leaves Copy
  working. Removing the stale check fails the stale test.
- `apps/tui/src/agents.test.tsx`: by keys, a response's menu files a message, and a finished turn's
  menu runs its row.
- Suites: `@acorn/protocol` (299), `@acorn/plugin-api` (14), `acorn-plugin-types` (5),
  `@acorn/node-core` (1,751), and `@acorn/client-core` (2,653) pass. `@acorn/plugin-agents` fails only
  the known `managedBridge` test. `@acorn/plugin-editor` fails only the four known status-menu tests.
  `@acorn/tui` fails only the two known `chrome.test.tsx` marker tests. The terminal's startup closure
  is 680,182 bytes of 700,000. `@acorn/arch-tests` fails only the known 15 dead links.
- `tsc` is clean for protocol, client-core, node-core, plugin-api, plugin-types, editor, and the
  changed agents files. Agents and the terminal show only the known agents and git plugin errors.
  oxlint reports nothing in the changed files.
- **Desktop, `pnpm dev:agent --fixture tui-navigation`.** A scratch loaded plugin, `msgnote`,
  declared **File as note** (`agent.message`), **File turn as note** (`agent.turn`, `when: { status:
  'completed' }`), and **Broken note** (assistant only, a route that answers 500). It declared no
  capability, and its route recorded each body and whether `agents.transcriptMedia` was reachable.
  - Responses read "Copy this response or act on it", the reader's messages gained "Copy this message
    or act on it", and each finished turn gained **Actions for this turn**.
  - **File as note** on a response posted `{ message: { taskId, projectId, sessionId, itemId, turnId,
    role: 'assistant', status: 'completed', text, revision: 15 } }`, with the response's Markdown as
    `text`. The capability was absent.
  - **File turn as note** posted `{ turn: { ..., status: 'completed', revision: 17 } }`.
  - **Broken note** showed the toast "msgnote: action failed", and the transcript kept working.
  - With a response's menu open, switching to the other task closed the menu. Clicking the detached
    row sent nothing.
- **Terminal, `pnpm dev:tui:agent --fixture tui-navigation`.** The same plugin. From the composer,
  Up reached **Actions for this turn**, and **File turn as note** posted the turn body. One more Up
  reached the response's menu: the three Copy rows, a separator, then the plugin's rows. **File as
  note** posted the message body. With a menu open, Tab, `h`, and Ctrl+B stayed in the menu, so the
  terminal can't leave a session while one is open. Unit tests cover a session change from outside.

### What later phases need to know

- An owner adds a location the same way: protocol facts, a target type in the union, a branch in
  `ownerTargetBody`, and a body key in `ChromeActionContext`. Tests that need an unknown location use
  `task.footer`.
- `ContextMenuHost` is generic over its location. A new rail-style host passes its location type.
- In the terminal, a bare `IconButton` draws no focus highlight, so a real-host walk can't see which
  menu button has the keys. The order of stops is visible in the raw output, `logs/tui.ansi`.
- Never name a scratch plugin after a real one. A scratch `plugins/notes` overwrote the Notes plugin's
  `package.json` here and broke 16 terminal tests until restored.

Let plugins offer actions on a transcript message or completed turn. Reuse the owner's Copy menu
and preserve transcript history, sends, approvals, and retry behavior.

## Starting point and owners

`plugins/agents/src/client/sessions/AgentEventCard.tsx` contains `CopyOutputMenu` with text, Markdown,
and JSON copies. Its `AgentConversationItem` links a normalized event to a stable transcript item.
`plugins/agents/src/contract/wire.ts` defines turns and normalized events.
`packages/client-core/src/host/chrome/chromeContextMenus.ts` dispatches manifest menu verbs.
`packages/client-core/src/host/registries/panes/contextMenuHost.tsx` supplies common menu rows.

Read [the transcript](../../managed-agents/transcript.md),
[client windows](../../managed-agents/client-surfaces.md), and [context menus](../../plugins/menus-and-markers.md#context-menus).

## Contract

Add `agent.message` and `agent.turn` menu locations. `agent.message` targets a user or assistant
text message. Other event types retain their own controls. `agent.turn` targets a completed turn;
running, waiting-approval, and queued turns do not expose that target.

Bind `{ nodeId, taskId, projectId, sessionId, itemId, turnId?, role, status, text, revision }` for
messages, and `{ nodeId, taskId, projectId, sessionId, turnId, status, revision }` for turns.
Allowed facts are `role`, `status`, and `projectId` for messages, and `status`/`projectId` for turns.
Send actions `{ message: {...} }` or `{ turn: {...} }` with the same owner identifiers. Pass message
text only on invocation, cap it at 64 KiB, and include `textTruncated` when a prefix is supplied.
Do not send raw event JSON, hidden reasoning, request payloads, or every message in a turn by default.

Actions can open the contributor's UI, offer a URL, or call its own route. Sending, editing a historic
turn, answering approvals, and retrying through an unrestricted Agents bridge are not menu grants.

## Steps

1. Extend menu locations, facts, target unions, dispatch bodies, schema generation, and authoring
   discovery. Preserve the resource and rail payloads added or supported by earlier phases.
2. Add typed message/turn projections beside the transcript owner. Resolve displayed text through
   the same normalization/copy rules as the owner, including attachment-placeholder cleanup.
3. Extend the Copy menu with contributed rows and a label that includes other actions. Add the
   completed-turn Actions affordance beside its owner controls. Keep one menu per transcript owner.
4. Use the same rows in the terminal. Capture identity at menu open, and refuse a selection after
   Node/session navigation, turn state change, plugin disable, or registration replacement.
5. Add a loaded fixture that files a note from selected message text through its own Node route.
   This fixture must not have managed-agent write permissions or send on the person's behalf.

## Tests and acceptance

Extend `plugins/agents/src/client/sessions/AgentEventCard.test.tsx`, shared menu/dispatch tests, and
terminal transcript tests. Verify copy formats, user versus assistant matching, completed-only turns,
text ceilings, hidden fields absent, historic messages, virtualized item reuse, and stale menu dispatch.
Exercise an action error and confirm the owner transcript remains usable and reports the failure.

Run `pnpm lint`, full suites for `@acorn/plugin-agents`, `@acorn/protocol`, `@acorn/node-core`,
`@acorn/client-core`, `@acorn/tui`, affected schema/declaration packages, and the architecture suite.
Expect exit zero. In both hosts, invoke an action on one message, then a completed turn; navigate
away with a menu open and confirm nothing acts on the replacement session.

Complete when contributed actions coexist with all Copy formats and owner controls without changing
stored events, message identity, or authority to send or approve.

## Verify before building

- Recheck stable item/turn IDs and which events actually represent visible user/assistant messages.
- Recheck the live transcript copy-normalization functions and byte-size rules.
- Stop if a consumer requires full session export or mutable turn control; design that capability separately.
