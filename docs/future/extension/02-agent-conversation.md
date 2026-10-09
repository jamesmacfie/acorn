# Phase 02: agent conversation

Status: planned, October 10, 2026.

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
