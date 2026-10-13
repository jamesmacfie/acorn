# Phase 02: agent conversation

Status: implemented October 13, 2026, with the real-browser gaps listed in
[real-browser results](#real-browser-results). [Browser extension](../../browser-extension/conversations.md)
owns the shipped contract.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

[Native pairing](./01-native-pairing.md).

## Deliverable

Continue the same task conversation from the browser, or start a session in a selected existing
task.

## Starting point and owners

- `plugins/agents/src/server/routes/managed.ts` owns session reads, creation, event pages, and
  interactive turns.
- `plugins/agents/src/contract/wire.ts` defines sessions, events, profiles, and snapshots.
- `plugins/agents/src/client/composer/submitOperation.ts` demonstrates ordinary human turn
  submission.

## Implementation steps

1. Add narrow native operations for task lists, provider/profile discovery, task sessions,
   snapshots/event pages, session creation, and interactive submission. Reuse agent routes and
   idempotency conventions.

2. Build explicit node, project, task, and session selection. Offer installed profiles for chat
   creation and report unavailable or unauthenticated providers. Use normal session defaults rather
   than creating an extension-only agent policy.

3. Render human/agent messages and simple tool activity summaries. Fold append/update events using
   their durable identity. Page earlier conversation history instead of fetching an unbounded
   transcript. Do not bring over the desktop host or its plugin renderer.

4. Use NodeBroker events as coalesced invalidation hints. Refetch durable state on reconnection or a
   sequence gap. Avoid a second conversation database or transport recovery implementation.

5. Persist drafts locally by node, task, and session. Preserve unsent text across sidebar closure,
   reconnection, and selection changes. Protect draft loading from late asynchronous replies.

6. Submit interactive turns with an operation key and acknowledge only the submitted draft. Retain
   the draft on an uncertain result, refresh the session, and offer an explicit retry with the same
   key. Bind writes to the originating node and session.

7. Display the selected destination and connection status. Disable submission while that destination
   is unavailable. A switch must not relabel or send a previous session's draft to another
   conversation.

## Demo and acceptance

Choose an existing task, continue its conversation, see a reply from another client, and
close/reopen the sidebar with an unsent draft. Start a second chat using an installed profile.

- Verify append-event rendering, history pagination, reconnect refresh, and event-gap recovery
  without duplicate messages.
- Switch tasks and nodes during draft loads and submissions; confirm exact destination binding and
  retained drafts.
- Drop the connection after a turn is accepted. Confirm refresh/retry does not create a second turn.
- Show missing providers, archived/unavailable sessions, and revoked connections without losing the
  draft.

## Verify and complete

Run extension and CLI/native adapter tests plus the agents suite and direct consumers of any
extracted contract helper. Demonstrate a real conversation in both browsers.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop once task chat works. Capture, detailed tool renderers, request forms, and a full Acorn
navigation client belong to other phases or remain deferred.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.

## Decisions made while building

The plan was silent or the code disagreed in these places:

- The host narrows every agents answer before it crosses native messaging. A page of 500 raw events
  with tool output could pass the 16 Mi character reply limit, so `session.read` keeps only messages,
  tool titles and statuses, and errors, and reports `reach` so the next read skips what it left out.
  The narrowed shapes are the bridge's own, in `@acorn/protocol`, because protocol may not import a
  plugin. The host type-imports the agents plugin's `contract/wire.ts` to build them, so a contract
  change fails its type check.
- The agents routes page events forward only. Rather than add a backward page to the Node, the sidebar
  opens 200 seqs before the session's `lastEventSeq` and reads forward from there. **Earlier
  messages** reads the 200 below. Seqs can have holes, so a page may be shorter, never longer.
- The extension folds the bridge's narrow records itself, with no dependency on the agents plugin. The
  plugin's transcript fold lives in its `client/` folder, which other packages may not import, and a
  summary needs only its message-append and tool-merge rules.
- Writes check the selection only before sending. A write that gets no answer fails with
  `ambiguous_mutation`, the CLI's code for the same case. Its key is kept with the draft and reused
  only while the text is unchanged.
- Hints carry IDs only, gathered for 250 ms in the host, because a working agent sends dozens of frames
  a second. `ws:shed` sets `missed`, which reads everything again. A real sequence gap already closes
  the broker's socket, so it arrives as a status return and needs no handling of its own.
- New chats offer one choice per provider on its default account. The desktop's account and custom
  agent choices come from its `client/` folder and the custom agents route; they can follow when the
  sidebar needs them.
- The session list is the newest 100 unarchived sessions, one page of the route.
- The sidebar remembers each Node's last project, task, and session in `destination:<nodeId>`, so
  reopening it lands on the conversation that holds the draft.
- `dev:extension:ui fill` now types into text areas and picks select options.

## Real-browser results

October 13, 2026, with Chrome 154.0.8037.99 and Firefox 151.0.3 on macOS. Chrome session `p02-chrome`
ran through `pnpm dev:extension`. Firefox through `pnpm dev:extension` (`p02-firefox`) failed as in
phase 01: web-ext's read of `~/Library/Application Support/Firefox/profiles.ini` is denied in the agent
sandbox, even with an `open` wrapper as the browser binary. The Firefox checks ran in
`p02-firefox-bidi` instead: the seeded Node of `p02-firefox`, the development build, the host
registered with `acorn browser install --development`, Firefox started with `open`, and the extension
installed over BiDi. A fresh Chrome session, `p02-chrome-final`, repeated pairing, a live reply from
the other client, and a send on the committed code.

Both used real Codex sessions on an isolated loopback Node. "Another client" was a second device paired
to the same Node, calling its HTTP routes. Claude Code wasn't installed on the Node, which gave a real
unavailable profile.

| Check | Chrome | Firefox |
| --- | --- | --- |
| Choose project, task, and conversation; transcript shows | Passed | Passed |
| Send from the sidebar; one turn, reply streams in through hints | Passed | Passed |
| Another client's message and reply appear live | Passed | Passed |
| Generated session title reaches the list through a hint | Passed | Not checked |
| Close and reopen the sidebar page; draft and destination restored | Passed | Passed |
| New chat lists Codex, and Claude Code disabled with its diagnostic; chat starts and replies | Passed | Passed |
| Each chat keeps its own draft | Passed | Passed |
| Node frozen, send, host killed, Node resumes: draft kept, Retry, still one turn | Passed | Passed |
| Bridge killed, other client talks, Retry: missed messages appear once | Passed | Not repeated |
| Node frozen past the heartbeat: Offline, then Online and read again | Passed | Not repeated |
| Send, switch chats before the answer: turn lands in the first, its draft clears, the second's stays | Passed | Not repeated |
| Device revoked: Revoked shown, draft kept, sending off | Passed | Not repeated |
| Stop the session, development registration removed | Passed | Removed by `acorn browser uninstall` |

These gaps remain:

- Firefox reload on save and session stop through `pnpm dev:extension` stay unchecked, for the sandbox
  reason above.
- Firefox's first native port after start stalled again. The 10-second deadline recovered it, as in
  phase 01.
- A real WebSocket sequence gap wasn't produced. The broker turns one into a reconnect, and the
  reconnect path passed above. The `missed` hint is covered by unit tests only.
- History paging, the far-behind jump, and an archived or deleted conversation were checked in unit
  tests, not against a real Node with that much history or those states.
- The panel itself needs a toolbar click, so the sidebar page ran in a tab, as in phase 01. The Node was
  on loopback, not a second computer.
