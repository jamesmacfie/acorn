# Agent transcript scroll, focus, and view-state repair

Implementation proposal, 2026-09-14. Partly shipped; the reading-position half is done and the owning
documents now hold it, so read them first and this only for what is left.

Shipped: stable row identity (`For` over the projection's keys), the one-shot reveal intent, the Card
reveal's rising edge and its refusal to take the caret out of a text box, the gesture-gated follow
decision, and — on 2026-09-15 — the anchored reading place. That last one is this document's phase 4
and the reading-position part of phase 2: a place is a turn and an offset into it rather than a pixel,
the timeline is controlled through `place` and `onChange`, and the agents plugin owns the store. See
[ui-design.md](../ui-design.md) § Behaviour a pane keeps redoing and
[state-ownership.md](../state-ownership.md) § Where a list's place lives.

Not built: the rest of phase 2 and phase 3, which put the chats-only filter and each tool card's
open-or-shut state into the same store, and the reveal-token work. None of those is a reported
problem. Phase 5's contract audit was done only as far as this change reached: `Timeline` on the
terminal host is now `reduced`, with the loss written down.

Investigation baseline: commit `49f57369`
plus the working-tree changes present during the investigation. The requested filename is
`scoll_fix.md`. Paths and line numbers are navigation hints; verify the implementation before editing.
Where this proposal disagrees with an owning reference document, investigate and update the design
explicitly. Do not silently change a shipped contract.

## Outcome and scope

A reader can browse an agent's history, type a draft, and leave and return to a conversation while
other agents run. Background data updates do not take focus, change which item is being read, or
switch the reader back into following live output. Intentional navigation and scrolling still work.

Treat this as a coordinated repair of UI state ownership and identity. The investigation found
several interacting mechanisms, not one proven explanation for every reported occurrence. Do not
close the work after adding a focus guard or another saved `scrollTop` assignment.

The owning runtime is the client renderer. The agents plugin owns conversation identity and
feature-specific view state; the shared UI kit owns DOM scrolling and focus operations. The terminal
host must continue to implement the shared component contract. No database migration, harness
rewrite, broker redesign, or new Node API is justified by the evidence in this investigation.

Stay on the starting branch. Preserve unrelated working-tree changes. Do not use subagents unless
the user asks for them. This document authorizes no change to persisted agent history or drafts.

Start with [architecture](../architecture-overview.md), [frontend](../frontend.md),
[state ownership](../state-ownership.md), [managed agents](../managed-agents.md),
[panes](../panes.md), [UI design](../ui-design.md), and
[focus and shortcuts](../command-palette-and-shortcuts.md). Follow [conventions](../conventions.md)
for file placement and naming.

## Data flow and relevant owners

1. A harness emits normalized events. In
   `plugins/agents/src/server/sessions/runtimeEngine.ts`, `record()` persists the event, publishes
   `agent:event`, publishes any turn/request projection, and publishes the session row.
2. The shared WebSocket and custody broker deliver frames to the renderer. The agent channel in
   `plugins/agents/src/client/sessions/wsChannel.ts` subscribes to all agent frames, not just the
   visible session. Keep application-lifetime delivery for attention and background work.
3. `plugins/agents/src/client/sessions/managedStore.ts` holds a session-array signal and a
   snapshot-record signal. Updating one record changes its containing signal. Session snapshots
   merge HTTP reads with streamed events through
   `plugins/agents/src/client/sessions/managedSnapshot.ts`.
4. `plugins/agents/src/client/sessions/agentPaneModel.ts` selects the task's session.
   `plugins/agents/src/client/sessions/AgentConversation.tsx` memoizes the selected session ID,
   snapshot, and session row, then renders transcript, queued turns, and composer.
5. `plugins/agents/src/client/sessions/AgentTranscript.tsx` projects events with
   `plugins/agents/src/client/sessions/conversationItems.ts`, filters visible items, and draws them
   through positional `Index` rows.
6. `packages/client-core/src/kit/components/content/Timeline.tsx` owns the scroll element,
   following mode, resize handling, and a window-lifetime map of numeric offsets. `Card` in
   `packages/client-core/src/kit/components/primitives.tsx` performs request-card focus and reveal.

Task navigation deliberately disposes UI. `apps/desktop/src/client/App.tsx` keys task views by
task ID; `packages/client-core/src/features/tasks/TaskPaneHost.tsx` renders the visible panes.
`packages/client-core/src/host/registries/panes/paneModels.ts` retains one task's model per pane,
not every previously visited task. Do not use that model cache as a multi-task view-state store.

The same conversation also appears in workflows through
`plugins/agents/src/contract/conversation.ts` and
`plugins/workflows/src/client/runs/NodeDetail.tsx`. Its surface identity matters: two views of the
same session may have different scroll positions. Draft ownership is different and already shared
by session through `plugins/agents/src/client/composer/composerState.ts` and
`plugins/agents/src/client/sessions/managedDrafts.ts`. Preserve that distinction.

## Evidence and limits

### Repeated focus commands

`openManagedSession()` in `plugins/agents/src/client/sessions/managedSelection.ts` stores a
request ID in `focusedRequestBySession`. That ID remains until another navigation clears or
replaces it; it is not consumed after reveal. `AgentTranscript` derives `focusRequest` from that ID
and the row. `plugins/agents/src/client/sessions/AgentRequestCard.tsx` passes it to `Card.focus`.

The shared Card implementation contains this effect:

```ts
createEffect(() => {
  if (!props.focus || !element) return
  element.scrollIntoView({ block: 'nearest' })
  element.focus({ preventScroll: true })
})
```

Solid props are getters. An upstream record replacement can notify this effect even when the
derived boolean stays true. The effect repeats a command intended for navigation.

A diagnostic test against the real Card reproduced this sequence: render with
`focus={record().focused}`, move focus to a textarea, replace the record with another object whose
`focused` field is still true, and observe focus return to the Card. `scrollIntoView` was stubbed
because jsdom has no layout. The focus theft was observed; a real viewport jump was not measured.
This mechanism requires an active request-focus intent. It does not explain typing interruptions
in sessions where no such intent was issued.

### Scroll events overwrite reader intent

Timeline's `noteScroll()` cleared the pending restoration target, updated following mode, and saved
the new offset for any scroll event other than an exact echo of its last assigned offset. It did
not restrict saved reading-position changes to reader navigation, and its helper resumed following
whenever `nearBottom` was true, including after a browser clamp caused by a shrinking list. Both are
fixed: the rule is `placeAfterScroll` in
`packages/client-core/src/kit/lib/readingPlace.ts`, and a scroll with no gesture behind it changes
nothing.

Two diagnostics confirmed the state transitions with simulated geometry:

- After reading at offset 400, a non-user scroll event at zero becomes the saved offset. Switching
  view keys away and back restores zero.
- After reading at offset 400, shrinking the content to fit the viewport and reporting a clamped
  zero scroll resumes following. Growing the content moves the view to the bottom and the former
  history position is no longer restored.

These tests prove how the handler responds, not which live layout operation caused a particular
user-reported jump. Real browser geometry and event ordering still need testing.

### Restoration outlives the state that defines the layout

Timeline stores only a number per `viewKey`. In
`plugins/agents/src/client/sessions/toolRendererRegistry.tsx`, `AgentToolFold` seeds local `open`
state from `defaultOpen`. Per-card expansion is not retained across an unmount. The global fold
preference decides defaults; it is not a record of this reader's individual card choices.

`AgentConversation` also keeps its chats-only filter in a local signal. Consequently, leaving and
returning can produce a different list and different heights before restoring the old offset.
Even perfect pixel assignment cannot restore the same content in that case. This lifetime mismatch
is confirmed by code inspection; its contribution to the exact reported top jump remains to be
measured in Tauri.

### Positional rows retain the wrong identity

`AgentTranscript` uses `Index` because `buildConversationItems()` returns fresh objects. It avoids
the remount-on-every-update behavior that `For` over those fresh objects would have. However,
conversation identity is not array position:

- `visibleConversationItems()` removes resolved permission requests.
- Chats-only filtering removes intervening rows.
- Session and subagent navigation substitute different lists.
- Replay can insert earlier items.

When an index takes on another item, component-local state can transfer to that item, or a branch
change can remount its contents. The projection already provides an item `key`; use that semantic
identity instead. Add tests for these transitions rather than assuming appends cover them.

### Cross-session activity: an unresolved reproduction, not a proven remount

The broad store signals are a source of invalidations, but the conversation's memos already stop
some propagation. An isolated diagnostic rendered the real AgentConversation with a textarea stub
for its composer and a stubbed event card. Updating another task's session, then the visible
session's metadata, preserved the textarea node, its focus, and the Timeline scroll element.

This rules out unconditional remounting at that tested boundary. It does not cover the full shell,
real composer, request cards, overlays, or every update type. Do not claim that all other-session
updates steal focus, and do not replace the store merely on that assumption.

### Historical verification

The investigation ran 14 existing focused tests plus four in-memory diagnostic cases, for 18 passing
cases across Timeline and agent UI tests. The diagnostics were injected into the test transform;
they are not committed regression tests. Implement permanent tests as phase 1 below describes.
The full reported scenario was not reproduced in a Tauri window.

`pnpm lint` failed on the investigation's dirty working tree: `AgentEventCard.tsx` passed
`spread` to Inline, but the terminal host's Inline type did not support it. That unrelated baseline
failure must be rechecked, not hidden or assumed to be caused by this work.

## Proposed contracts

### Separate server data, view state, and navigation commands

Use three owners with different lifetimes:

| State | Owner and lifetime | Identity |
| --- | --- | --- |
| Events, sessions, turns, requests | Agents data store; synchronized with Node | Node and entity ID |
| Reading position, following mode, filter, disclosure choices | Agents view-state store; survives UI unmount within the window | Node, surface, session, and optional subagent |
| Reveal or focus request | Issuing navigation action; consumed or cancelled | Target view plus unique request token |

Keep the feature store outside component roots that navigation disposes. A proposed new file is
`plugins/agents/src/client/sessions/conversationViewStore.ts` (new file). Use small pure types and
reducers for transition rules. Do not put browser elements or observers in that store.

Use a structured key or collision-safe encoding, not ambiguous concatenation of arbitrary IDs.
Capture Node identity when creating a view or asynchronous request. A later active-Node change must
not redirect an old callback into the new Node's view state. Use `viewKeyPrefix` as the surface
identity, auditing callers for uniqueness if two instances of the same surface can coexist.

Suggested data shape, not a shipped API:

```ts
type ConversationViewId = {
  nodeId: string
  surfaceId: string
  sessionId: string
  subagentId?: string
}

type ReadingPosition = {
  itemKey: string
  offsetWithinItem: number
  fallbackSeq: number
}

type ConversationViewState = {
  mode: 'following' | 'reading'
  position?: ReadingPosition
  chatsOnly: boolean
  expandedByItem: Record<string, boolean>
}

type RevealRequest = {
  token: number
  view: ConversationViewId
  itemKey: string
  focus: boolean
}
```

Define `offsetWithinItem` as the vertical distance from the row's top to the viewport's top.
It is positive when the viewport starts inside that row. Keep ordering metadata sufficient to
choose a successor if that row disappears. Item keys must include enough stream/session identity
to prevent collisions when a component switches lists.

Keep this state in memory for the window lifetime; reload persistence is out of scope. Use a bounded
least-recently-used collection, initially 50 inactive views, excluding mounted views from eviction.
Prune disclosure entries for items known to be permanently removed, but do not treat filtered or
partially loaded items as deleted. Clear matching views on session deletion and task eviction using
the existing scope hooks. Keep inactive Node views isolated so returning to a Node can restore them.
Eviction of view state must never clear a draft or attachment. Release DOM references, listeners,
frames, and observers when a mount disposes.

### Stable row identity and scoped updates

Expose a stable ordered list of item keys plus reactive lookup by key. Render `For` over primitive
keys, not over freshly projected item objects. Within each row, use an accessor for its data. An
unchanged key retains its DOM while text, status, and request answers update. Removal disposes that
key's row. Namespace keys across conversations or deliberately key a conversation scope by its
stable view identity; never key it by the snapshot object.

Reconcile projection output in one feature-owned factory. Preserve unchanged item values where
practical, or use a keyed Solid store with tested reconciliation. Preserve recursive subagent
structure, usage folding, event order, and duplicate/replay behavior. Do not replace the event
projection algorithm merely to obtain stable keys.

Keep session/snapshot selectors memoized. Add tests before deciding whether the broad managed-store
signals need replacement. If unrelated updates still reach visible-row effects, introduce per-session
selectors or keyed records at that data boundary. Preserve batch loading and HTTP/WebSocket merge
semantics. In particular, `appendEvent()` mutates the event array and publishes a new snapshot;
an optimization comparing only array identity would silently miss streamed content.

### Focus is a navigation command

Separate selected/highlighted request state from pending focus/reveal. Clicking a request creates a
fresh token even when the same request was selected before. Route the command to the intended
visible surface, wait for its target to mount, perform it once, and acknowledge that exact token.
One view must not consume another view's command. A stale acknowledgment must not clear a newer one.

Cancel pending commands when the user navigates away, the target is deleted, or newer user focus
supersedes the request before loading finishes. A permanently unavailable target produces a bounded
failure/no-op rather than waiting forever. Do not automatically focus requests simply because they
arrive from a background agent. Existing new-session composer autofocus remains explicit and one-shot.

At the shared Card boundary, make the legacy boolean focus behavior respond to a false-to-true edge,
not arbitrary upstream notification. That guard is necessary but not sufficient: a remount must not
replay an already-consumed navigation action, and another click on the same target must still work.
Prefer a serializable request token for any shared declarative API added to the kit. Keep selection
and `tabindex` semantics independent of whether a command is pending.

Explicit reveal should cooperate with Timeline: stop following and establish a reading anchor when
navigating to history, then focus with `preventScroll` after the controlled reveal. Do not let a
Card and Timeline issue competing scroll writes. Ordinary snapshot updates perform neither action.
Audit other Card focus callers before changing the shared behavior.

### Scroll is a state machine over reader intent

The feature supplies retained state; the kit measures and moves its own DOM. Add a typed controlled
view-state seam to Timeline, keeping the plain, non-following Timeline compatible. Register row keys
through Timeline's compound Turn component or an equivalent kit-owned mechanism. Plugins must not
query kit classes, access its scroll element, or add their own ResizeObserver.

Keep durable mode separate from transient restoration and programmatic-write bookkeeping:

| Input | Required transition |
| --- | --- |
| First visit without saved state | Follow the bottom after layout is measurable. |
| User scrolls away from bottom | Enter reading mode and capture an item anchor. |
| User deliberately reaches bottom, or presses Go to bottom | Enter following mode. |
| User presses Go to top | Enter reading mode anchored at the first item. |
| Content or viewport resizes while following | Pin to the new bottom. |
| Content or viewport resizes while reading | Preserve the item anchor and relative offset. |
| Browser clamp or programmatic scroll event | Do not reinterpret it as a reader choosing following mode. |
| Restore or reveal is in progress | Preserve its target until applied, superseded, or explicitly abandoned. |
| User scrolls during restoration | Cancel restoration and adopt the user's resulting position. |
| View identity changes or unmounts | Save the outgoing view before its geometry disappears; cancel its pending callbacks. |

Restore filters and disclosure choices before attempting the anchor. Delay measurements while the
scroller is disconnected, hidden, or zero-sized. Retry against actual layout/resize signals, including
late Markdown highlighting, rather than a guessed sleep. Tag scheduled work with the view generation
and discard stale work. Programmatic event suppression must tolerate browser rounding, clamping,
and delayed/coalesced scroll events; equality with one numeric assignment is not sufficient.

If the anchor is removed or hidden by an explicit filter, choose the nearest surviving successor in
conversation order, otherwise the predecessor. If no item is available, retain reading intent while
waiting for data. For an authoritative empty list, use an explicit empty state; do not spin a frame
loop. When an offset inside an item exceeds its final height, clamp within the surviving item and
remain in reading mode. A genuinely unavailable historical anchor should settle at the nearest
available item once the snapshot is ready, rather than retrying indefinitely.

Capture reading state on user scroll, explicit view operations, and before destructive list/view
transitions. Avoid reading post-removal geometry during cleanup. Browser scroll anchoring may already
preserve the correct position; apply only the correction needed to reach the saved anchor. Decide
and test whether the kit disables native anchoring on this scroller to avoid double compensation.
Do not change global scroll CSS as a substitute for that decision.

Track wheel, touch, scrollbar dragging, and scroll keys as user gestures with bounded lifetimes.
Clicking a transcript button must not leave a permanent flag that makes a later browser clamp look
user-driven. Account for momentum scrolling. Do not use `Event.isTrusted` alone to distinguish browser
layout changes from user scrolling. Keep the reading position stable through resize, tool completion,
queue changes, composer expansion, and asynchronous highlighting.

### Disclosure and filter state follow items and views

Read/write individual tool expansion through the view store keyed by item ID. Apply global
`agent_tool_fold` defaults only for unseen items. Preserve the existing sticky-default preference
when a user deliberately toggles a card; restoring a saved choice must not write that preference.
Collapse-all records closed state for the targeted tools, including those temporarily filtered out,
and defines defaults for later arrivals as closed until the view's collapse override is reset by an
explicit preference change or view eviction. Test that behavior rather than relying on mount order.

Retain the chats-only choice per view. Parent and subagent transcripts have separate reading state.
Keep the existing rule that a subagent view hides the parent composer and preserves its draft.
Persist only serializable view facts; component closures and DOM nodes remain disposable.

Tool renderers can come from the `agents:tool-card` extension point. Inspect
`packages/protocol/src/extensionPoints.ts` and the Slot implementation before selecting the controlled
disclosure API. The shipped `AgentToolCardProps` includes a default, not a full retained-state
protocol. Extend that seam with validated serializable state and an allowed action/reporting path
if contributed cards own disclosure. Update both compiled and loaded render paths. Do not pass a
JavaScript callback through a worker message or bypass the extension point. Record compatibility
behavior for contributors using only the old default; do not claim their state is retained without
testing an actual contribution.

## Implementation sequence

### Phase 1: Characterize and reproduce

Add permanent regressions beside the owning components before changing behavior. Reproduce the Card
effect with an unchanged true boolean, and the Timeline state transitions above. Upgrade scroll
test helpers to emulate clamped `scrollTop`, viewport height, delayed scroll events, and observer
callbacks. Existing jsdom tests let `scrollTop` equal `scrollHeight`, which a real overflowing browser
clamps to `scrollHeight - clientHeight`; those tests alone cannot validate restoration.

Add a full agent-view fixture with a real composer, request card, tools, and controllable frames.
Use the existing mocked API/WebSocket seams in
`plugins/agents/src/client/sessions/AgentConversation.test.tsx` and
`plugins/agents/src/client/sessions/managedStore.test.tsx`, but do not stub the components responsible
for the behavior being asserted. Include a pending request opened through the selection action.

Run a real-window reproduction early. Distinguish task tabs, agent sidebar sessions, pane switches,
and leaving the application; they have different lifecycles. If the background-session failure
persists independently of these mechanisms, use temporary local instrumentation to record mount and
dispose counts, focus targets, view IDs, scroll-write reasons, and frame channel/session IDs. Do not
record draft text, transcript content, or secrets. Remove probes or put them behind the established
opt-in diagnostic mechanism. Follow evidence to shell gates, overlays, or native focus if needed.

Exit: failing regressions demonstrate the targeted bugs, with a written account of which live
symptoms have and have not reproduced. Keep the unrelated-session preservation case as a control.

### Phase 2: Establish view ownership and keyed rows

Implement the bounded feature view store and its pure transitions. Add unit tests for identity,
eviction, two surfaces, two Nodes with colliding session IDs, and stale callbacks. Wire filters and
disclosure state to it. Introduce ordered keys and keyed row accessors in the transcript projection,
including nested subagent rendering. Preserve draft ownership and current API merge behavior.

Do not key the whole pane by a changing session object or retain hidden DOM for every task. The
existing direct-child layout contract is load-bearing: the Timeline scroller must remain a direct
child of the detail region, with composer and header as siblings. Keep the existing conversation
layout test and add identity/disclosure assertions.

Exit: removal/insertion/filtering keeps surviving row identities and their state; leaving and
returning restores view choices without retaining the previous DOM tree.

### Phase 3: Consume navigation intent once

Implement request tokens, targeting, acknowledgment, and cancellation. Replace the request ID as a
permanent focus trigger. Harden Card's legacy boolean effect and coordinate explicit reveal with
the Timeline controller. Test delayed loading, repeated clicks on one request, target removal,
two surfaces, focus moved by the user, and session/Node changes while work is pending.

Exit: after navigation completes, typing survives record replacements and streamed updates. A second
intentional click still reveals and focuses the same target once.

### Phase 4: Restore anchors and separate following intent

Implement the Timeline controller and row registration using the contracts above. Persist outgoing
state before children switch. Restore view choices before measuring. Add generation-scoped resize
and write handling, missing-anchor policy, zero-size handling, and user cancellation. Remove the
old offset map for controlled agent views so there is only one authority; retain compatible behavior
for other Timeline consumers until migrated or explicitly covered by the shared contract.

Exit: the scroll matrix passes with browser-like geometry and delayed events. Go to top/bottom,
manual scrolling, and live following remain functional. No restoration loop or repeated focus write
continues after the view settles or disposes.

### Phase 5: Verify all render paths and document the result

Audit Timeline and Card exports, `packages/client-core/src/kit/tokens/support.ts`,
`packages/client-core/src/host/tree/components.ts`, and the tree prop validation/schema path.
Any public prop must survive the loaded-plugin renderer and have an explicit terminal behavior.
Update `packages/plugin-api/src/ui/index.ts` and tree exports only where the contract requires it.

The terminal implementations are in `apps/tui/src/kit/grouping.tsx` and
`apps/tui/src/kit/scrolling.tsx`. They must typecheck against the new contract and preserve logical
item/focus behavior without assuming DOM pixels. Test a loaded tool-card contribution and the workflow
conversation surface, not only the built-in agent pane.

Move shipped behavior into [managed agents](../managed-agents.md), [UI design](../ui-design.md),
[state ownership](../state-ownership.md), and [focus and shortcuts](../command-palette-and-shortcuts.md).
Update [panes](../panes.md) or [plugins](../plugins.md) if their contracts change. Keep one owner per
contract and link from the others. Replace this proposal's status with an implementation record or
retire it to a pointer according to the future-work convention.

## Required regression matrix

| Scenario | Assertions |
| --- | --- |
| Visible session receives text, metadata, usage, turn, or request updates | Composer DOM, focus, and selection range remain; unchanged row DOM remains; reading anchor stays within 2 px after layout settles. |
| Another session in the same task streams | Same assertions; sidebar status updates correctly. |
| A session in another task streams or asks for attention | Same assertions; attention still arrives; no automatic navigation. |
| Open request, then type while updates arrive | One reveal/focus per command; textarea keeps focus afterward. |
| Repeat navigation to the same request | Another reveal occurs once, even though selection is unchanged. |
| Permission row before the viewport disappears | Neighboring rows retain identity and disclosure state; anchor follows its item. |
| Toggle chats-only, enter/exit subagent, or switch session | Correct independent filter/anchor/disclosures; no state transferred by index. |
| Leave a task/pane and return after expanding tools | Restores the same item and choices; unsent draft and attachments survive. |
| Open one session in agent and workflow surfaces | Independent reader state; correct shared session draft policy; one targeted focus consumer. |
| Resize pane, expand composer, finish highlighting, shrink content | Reading stays reading; following stays following; no saved zero from an incidental clamp. |
| User scrolls while restoration waits on layout | User wins; no late correction pulls the viewport back. |
| Navigate during a delayed snapshot or animation frame | Old callbacks cannot move/focus the new view or overwrite its state. |
| Hidden/zero-size mount, empty/short list, missing anchor | Bounded settling; deterministic fallback; no frame loop. |
| Node switch with colliding IDs; session deletion; view-cache eviction | No state crosses scope; memory is bounded; drafts are unaffected by view eviction. |
| Loaded tool-card renderer and terminal host | Contract is supported or explicitly compatible; no dropped props, callback serialization, or DOM-only assumptions. |

In DOM tests assert both node identity and `document.activeElement`; checking draft text alone misses
focus loss because drafts outlive the component. Assert selection start/end while editing mid-text.
For visual tests compare the anchored row's position relative to the viewport, not just a numeric
`scrollTop`. Use synthetic fixtures with multiple long tools/messages and delayed updates, not
private user transcripts. Keep settled geometry tolerance separate from assertions about intentional
navigation or a genuinely removed item.

## Verification commands and completion gate

Run from the repository root, with RTK as required by the workspace instructions. Extend filters
when adding tests. The listed files exist at the investigation baseline.

```bash
rtk proxy pnpm --filter @acorn/client-core test --project hosts src/kit/components/content/Timeline.test.tsx
rtk proxy pnpm --filter @acorn/plugin-agents test --project hosts src/client/sessions/AgentConversation.test.tsx src/client/sessions/AgentEventCard.test.tsx src/client/sessions/AgentRequestCard.test.tsx src/client/sessions/toolFoldPrefs.test.tsx
rtk proxy pnpm --filter @acorn/plugin-agents test --project logic src/client/sessions/conversationItems.test.ts src/client/sessions/managedSnapshot.test.ts src/client/sessions/managedSelection.test.ts
rtk proxy pnpm --filter @acorn/arch-tests test docPaths.test.ts
rtk proxy pnpm lint
rtk proxy pnpm test
```

Run the terminal-host and tree/extension-point regressions added for the changed contract as part of
the full suite. Use `pnpm test`, not unbounded `turbo run test`. Record baseline failures separately
and resolve failures introduced by this work before handoff.

Use the real Tauri window on a graphical host, following [local development](../local-development.md):

```bash
rtk proxy pnpm dev:agent -- --session scroll-fix
```

In another terminal:

```bash
rtk proxy pnpm dev:agent:ui -- --session scroll-fix snapshot
```

Use `click`, `fill`, and `screenshot` with references from each fresh snapshot. Take a snapshot after
each transition. Use isolated test data to exercise concurrent sessions and collect before/after
screenshots plus anchor/focus observations. Do not start paid or externally mutating agent work just
to generate traffic; use the project's fake harness or a controlled fixture where feasible. Native
window focus needs native computer-use control if the renderer driver cannot exercise it.

Finish the automation session:

```bash
rtk proxy pnpm dev:agent:ui -- --session scroll-fix stop
```

Completion requires all of the following:

- Permanent regression tests cover the reproduced mechanisms and the cross-session controls.
- The live matrix covers task/pane navigation, concurrent sessions, request focus, and late layout.
- View state survives unmount, is bounded and scope-safe, and does not retain hidden transcript DOM.
- Shared kit, workflow, terminal, and loaded-plugin contracts pass their relevant checks.
- No new scroll/focus authority competes with the old one; obsolete agent-path machinery is removed.
- The owning documentation describes implemented behavior, and the handoff records commands,
  outcomes, remaining baseline failures, and any unverified host scenario honestly.

If graphical verification is unavailable, complete code and automated work but explicitly leave live
acceptance outstanding. Do not report that every user symptom is fixed based on jsdom alone.

## Refused shortcuts and implementation risks

Do not add unconditional autofocus, focus the textarea after every update, debounce the symptom,
restore arbitrary pixel offsets after a sleep, freeze live data while typing, or keep every task's
DOM mounted. Do not replace Index with For over fresh objects without stable identity. Do not move
DOM access into the agents plugin or add a database-backed scroll preference.

The largest compatibility risk is changing shared Card/Timeline behavior for other consumers. Audit
call sites and test both hosts. The largest data risk is an optimization that misses mutated event
arrays or alters replay merging. The largest UX risk is a restoration loop that fights deliberate
user scrolling. Address these with the phase exits rather than broad unrelated refactoring.

## Verify before building

- Re-read the listed owning docs and repository instructions, and record the actual starting commit
  and dirty files. Preserve other work; the investigation did not modify production code.
- Re-open the cited source and tests. Confirm Card's effect, request-intent lifetime, Timeline's
  offset handler, positional rows, and component-local disclosure state still exist.
- Confirm all conversation consumers and their surface identities, including workflows and loaded
  tool-card contributors. Validate the proposed shared prop/action seam against their real schemas.
- Confirm event-array mutation and snapshot merge behavior before adding equality checks or stores.
- Confirm session deletion, task eviction, and Node-switch hooks before wiring retained state.
- Reproduce the isolated failures and rerun baseline checks. The historical lint error may already
  be fixed; the in-memory diagnostics must become real tests.
- Confirm the graphical test harness can drive concurrent fixture sessions and inspect focus and
  anchor geometry. Record any missing facility and build a scoped test seam rather than declaring
  an untested scenario complete.
