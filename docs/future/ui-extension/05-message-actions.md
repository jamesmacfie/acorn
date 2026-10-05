# Phase 05: add message and turn actions

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 04's menu dispatch and stale-target checks.

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
