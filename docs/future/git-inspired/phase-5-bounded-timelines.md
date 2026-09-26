# Phase 5: bounded Agent and pull-request timelines

Status: not started, 2026-09-26. Waits on phase 0. PR snippet work also waits on phase 2.

## Goal

Long Agent transcripts and pull-request conversations open and stream without constructing,
laying out, or painting every expensive card. Stable turn identity preserves selection, focus, and
reading place. Pull-request bodies and diff snippets are built near the displayed window. If browser
containment and lazy bodies do not meet the phase 0 budget, callers use a fixed logical window with
**Show earlier** rather than reviving the failed variable-height virtualizer.

## Why this is a separate phase

Timelines do not share the diff's fixed-row contract. Almost every card has variable height, and the
Agent transcript's earlier virtualizer damaged measurement caches and replaced selected DOM during
scrolling. The current incremental projection is good at streamed updates: one event changes one
card. Its remaining cost is initial construction and retained DOM for every card.

GitHub's article supports deferring content and using stable identity, but its two-domain code/comment
geometry is specific to a diff. Acorn should use the simpler fixed-window strategy already recorded
in `Timeline.tsx` unless evidence requires continuous virtual scrolling.

## Scope

In for every implementation:

- Stable keys on every pull-request `Timeline.Turn`.
- Timeline construction, mounted-card, body-mount, and teardown health signals.
- Verified `content-visibility`/intrinsic-size containment for offscreen turns where WebKit behavior
  and accessibility permit it.
- Lazy pull-request body and snippet construction, reusing phase 2 segment anchors for snippets.
- Identity-aware reveal/focus so a target can ask its caller to make a hidden turn present.
- Preservation tests for streamed selection, focused controls, scroll place, and disclosure state.

In when the phase 0 budget still fails after those changes:

- A shared pure fixed-window controller used by Agent transcript and PR conversation callers.
- A tail-first window, **Show earlier**, optional **Show all**, and page-size constants chosen from
  measurement.
- Automatic expansion for requested focus/reveal and temporary pinning for selection or focus.
- Correct list accessibility metadata for the logical position and total size.

Out:

- A generic variable-height Timeline virtualizer.
- Calling `measure()` for the whole list on each event.
- Replacing mounted turn DOM because a virtual item object changed.
- Dropping old events or comments from the underlying data model. Windowing is presentation only.
- Persisting rendered cards or HTML.

## Stage A: stable identity and bounded card work

### Pull-request turn identity

`ConversationEntry` already has `kind` and `id`. Define its turn key as `${kind}:${id}` and pass it to
`Timeline.Turn`. The kind prefix prevents a commit SHA, review node ID, and comment ID from sharing a
namespace by accident. Ensure duplicate provider identities fail or receive a deterministic
occurrence suffix in the model rather than letting Solid fall back to array position.

Agent transcript keys remain `AgentConversationItem.key`; do not replace them with event indices.

Extend `Timeline.Turn` only as needed for logical list metadata:

```ts
<Timeline.Turn key={key} position={logicalIndex + 1} setSize={total}>
```

The DOM remains an ordered list. When a window is active, expose `aria-posinset` and `aria-setsize`
so a screen reader hears the turn's position in the logical conversation rather than only the slice.

### Browser containment

Test `content-visibility: auto` and an `auto` intrinsic block-size estimate on `.ui-timeline-turn` in
the real supported WebKit. The estimate comes from phase 0 card-height observations and is a CSS
custom property or small kind vocabulary, not a per-turn synchronous DOM measurement.

Containment is accepted only if:

- Timeline identity anchoring still restores the same turn after navigation and streamed growth,
- browser find, text selection, focus traversal, screen-reader order, and disclosure state behave as
  documented for content kept in the DOM,
- images and async card content still schedule the existing correction,
- the real-engine report shows reduced layout/paint work.

Containment does not reduce Solid component creation or Markdown parsing. Treat it as one measured
layer, not the complete solution.

### Pull-request body and snippet loading

Phase 1 obtains complete conversation topology. Expose that topology separately from expensive body
content: entry kind/ID, author, timestamp, state, thread anchor, comment IDs, body-present flag, and a
body fingerprint are enough to order and identify turns. Reuse the bounded body batch route added for
phase 2 inline threads or add one GitHub-owned conversation body route; do not put HTML in the compact
topology solely because another tab may use it.

Load body content for displayed and near-displayed turns. Until it arrives, render a real labeled
skeleton/summary, never a blank card. Body arrival preserves the turn key and lets the Timeline's
identity correction handle height.

Remove `buildThreadSnippetIndex(files)` from the conversation open path. It currently parses every
available patch to serve a five-line excerpt in each thread card. Resolve a thread's file/side/line
anchor through the phase 2 document topology, load the one containing segment when its turn
approaches the display window, and derive the bounded excerpt. Cache it under the segment content key.
An unavailable or upstream-capped file gets an explicit “Snippet unavailable” state; it does not
cause all patches to load.

Other PR tabs may keep the small summary fields they need. Do not make Overview fetch every
conversation body after this split.

### Agent card construction

Keep `createConversationProjection`, the turn/request maps, and per-key item signals. They already
make streaming work proportional to changed items. Separate the logical `items()` count from the
keys the DOM renders so Stage B can change only the slice.

Defer card bodies already hidden behind closed tool disclosures, as today. Audit contributed remote
tool bodies so a closed card does not boot a worker tree. Record body mounts separately from turn
mounts.

Run the phase 0 timeline flow after Stage A. If initial card factory time, mounted cards, DOM size, or
frame gaps still grow beyond the accepted scaling band, implement Stage B. Record the result either
way; “no window needed” requires evidence from the canonical profile.

## Stage B: fixed logical windows

### Controller

Add a pure `createTimelineWindow`-style controller beside Timeline reading-place helpers. Timeline
continues to own scroll/follow behavior; callers own which logical turns exist in the DOM.

Inputs:

- ordered stable keys,
- initial tail size and earlier-page size,
- current reading-place/follow state,
- required reveal key,
- selected/focused key pins.

Outputs:

- start/end logical indices,
- rendered keys,
- hidden-earlier and hidden-later counts,
- `showEarlier`, `showAll`, `ensureKey`, and safe tail-prune operations.

Use constants supported by phase 0 measurements. Do not derive a window from pixel estimates; that
recreates variable-height virtualization.

### Window rules

- Initial open renders the newest fixed number of turns and a **Show earlier (N)** control when
  content is hidden.
- **Show earlier** prepends one page. Capture the first currently visible stable turn and its offset,
  prepend, then restore that identity so the viewport does not jump.
- **Show all** is an explicit escape hatch for page search, copy, or accessibility workflows. It may
  be omitted if product review chooses repeated **Show earlier**, but the hidden count must remain
  visible and honest.
- An external focus/reveal request calls `ensureKey` before trying to focus or scroll. This covers
  Agent request/subagent targets and PR links.
- While the Agent Timeline follows live, new turns may slide the tail only when doing so would not
  remove the turn containing selection, focus, an open composer, or the current reading anchor.
- While the reader is away from live, keep the current window and reading anchor. New tail turns may
  remain hidden behind the existing bottom control/count until the reader returns.
- A selected text range or focused descendant pins its containing turn. The window may temporarily
  exceed its normal size. Never remove DOM under an active selection or focused control to satisfy a
  memory target.
- When pins clear, prune only in a settled turn and preserve the visible identity. Do not prune once
  per streamed event.
- PR conversation updates retain existing turn elements by key. A new older/tie-sorted item does not
  remount later turns.

The controller works in logical indices and identities. It does not own DOM measurement or scroll
pixels.

### Search and hidden content

A native page find cannot match unmounted turns. If Stage B ships, the UI must state that earlier
turns are hidden and provide a route to reveal them. Prefer an application search over logical Agent
events/PR bodies if one already exists by implementation time; otherwise **Show all** or repeated
**Show earlier** is the honest behavior. Do not silently claim that browser find covers the full
conversation.

## Reading place and remount behavior

The followed Agent Timeline already stores `{ key, index, offset }` and distinguishes its own writes
from reader input. Extend its key resolver to ask the window controller for a hidden key before
substituting another turn. Restoring a session may therefore expand a page containing the stored key,
then run the existing correction.

PR conversation may scroll in a parent region rather than a `follow` Timeline. Give the caller the
same capture/prepend/restore helper around **Show earlier**; do not assign `follow` solely to obtain a
scroller and thereby change page layout.

If a retained reading key no longer exists, use the existing nearest-index fallback and record a
substitution. A window hiding a key is not removal and must never trigger that fallback.

## Health and telemetry

Record numeric/fixed-label measures:

- logical turns, rendered turns, mounted bodies, hidden earlier/later,
- initial turn factories and body factories,
- Markdown parse/render and highlight work already captured by shared telemetry,
- window expansions, temporary pin growth, and prune count,
- identity substitutions and correction drift,
- active Timeline observers before and after teardown.

Do not record keys, session IDs, PR IDs, authors, bodies, source snippets, selected text, or search
terms.

## Code touched

- `packages/client-core/src/kit/components/content/Timeline.tsx`: logical accessibility props,
  hidden-key resolution hook if needed, and health counters; no virtualizer.
- Timeline CSS in `packages/client-core/src/infra/styles/primitives.css`: verified containment.
- A pure window controller beside `readingPlace.ts`, with focused tests.
- `plugins/agents/src/client/sessions/AgentTranscript.tsx`: rendered slice, selection/focus pins,
  reveal expansion, and counts.
- `plugins/github/src/client/pullDetail/Conversation.tsx`, `model.ts`, and `prModel.ts`: stable keys,
  topology/body split, bounded snippet loading, and optional window.
- GitHub shared/server routes and queries for conversation topology/body batches if phase 2 has not
  already supplied them.
- Phase 0 fixtures, health flow, and focused tests.

## Tests

### Always

- PR conversation turns use stable `kind:id` keys across insertion, update, sort ties, and body
  hydration.
- Opening a PR conversation does not parse patches for files whose thread turns are outside the near
  display range.
- Body and snippet arrival keeps the same turn element and reading place.
- Agent streaming still changes only the affected card and preserves a real cross-card text
  selection.
- Closed tool cards do not mount built-in or contributed expensive bodies.
- Containment tests run in real WebKit for scroll restore, find/selection, focus, images, and
  disclosure resize; jsdom CSS presence is not acceptance.

### If Stage B ships

- Initial keys are the tail window with correct hidden counts and logical ARIA positions.
- **Show earlier** prepends a page and keeps the former first visible key at the same offset.
- A reveal target outside the window expands before focus; a missing target alone substitutes.
- New events do not prune active selection, focus, composer, or a reader-away-from-live anchor.
- Clearing pins allows one settled prune without changing the visible key.
- Switching sessions, subagents, PRs, and panes cannot reuse another conversation's window.
- **Show all** exposes every logical turn and remains an explicit user action.

### Canonical flow

- Compare Stage A with the pre-phase baseline. If it meets the accepted factory, frame, DOM, and
  mounted-card budgets, record that Stage B was not needed.
- Otherwise run Stage B cold, warm, streaming, top/bottom, old-target reveal, selection, disclosure,
  and teardown. Rendered turns remain bounded as logical turns grow, except for explicit **Show all**
  and temporary pins.
- Teardown returns observers, mounted turns/bodies, and scheduled corrections to baseline.

## Docs owed

Per [docs-migration.md](./docs-migration.md): `docs/managed-agents/client-surfaces.md`,
`docs/github-integration.md`, `docs/telemetry.md`, `docs/testing.md`, and, if the Timeline public
contract changes, `docs/ui-design.md` or the plugin UI authoring reference that owns it.

## Done when

- PR turns have stable identity and do not build an all-file snippet index.
- Pull-request body/snippet work and Agent expensive-body work are bounded by the displayed/near
  window.
- The canonical long timeline meets the phase 0 open, stream, selection, focus, correction, and
  teardown budgets.
- If fixed windows are required, hidden history is explicit, reveal expands by identity, logical
  accessibility positions are correct, and active selection/focus is never pruned.
- No variable-height Timeline virtualizer or whole-list per-event measurement returns.
- `pnpm lint`, Timeline, Agent, GitHub conversation, accessibility, real-window canonical, and
  `pnpm test` suites pass.

## Verify before building

- Re-read the guardrail comment and current input/anchor implementation in
  `packages/client-core/src/kit/components/content/Timeline.tsx`.
- Confirm Agent transcript keys still come from `AgentConversationItem.key` and identify every
  external focus/reveal path before adding a window.
- Confirm PR `ConversationEntry` identity, sort ties, and every caller of `buildThreadSnippetIndex`.
- Inspect the current WebKit version and test `content-visibility`, intrinsic size, browser find,
  focus, selection, and accessibility behavior rather than relying on Chromium results.
- Check phase 2's actual segment lookup API before designing PR snippet loading.
- Measure Stage A on the canonical fixture before implementing Stage B; if it passes, record the
  evidence and leave the simpler full logical DOM in place.
