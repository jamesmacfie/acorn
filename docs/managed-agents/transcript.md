# The transcript

The transcript draws a session's events as cards. This page covers the fixed window that keeps a long
session cheap, tool and request cards, usage lines, and subagent views. Most of it is in
`plugins/agents/src/client/sessions/`.

## The timeline

The transcript is a kit `Timeline` with `follow` set, so the kit owns the scroll. It stays on the
newest turn until you scroll away, picks the bottom up again when you return, and restores your place
when you come back to a session. The bar above it and the composer below are its siblings. The
conversation reaches its region as a fragment, because the shell CSS names the scroller as the
region's direct child (`packages/client-core/src/infra/styles/shell.css`), and
`AgentConversation.test.tsx` checks that. The surface drawing it keys the remembered place.

The timeline isn't virtualized, which is the kit's rule
([no virtualizer](../ui-design/closed-kit.md)). The last virtualizer cleared its size cache on every
event and replaced the DOM under text selections.

## The window

A long session draws through a fixed window. The projection covers every event, and the transcript
draws the newest 200 cards, with **Show earlier (N)** above the first (`createTimelineWindow` in
`packages/client-core/src/kit/lib/timeline/timelineWindow.ts`). The window counts cards and doesn't
measure them. On September 26, 2026, in jsdom, the canonical 7,012-event session projected to 3,387
cards. Drawing all of them built about 30,000 elements in about 840 ms. The window builds about 1,800
in about 60 ms.

Its rules:

- The window is anchored on its oldest drawn card, so a streamed card joins it. **Show earlier** adds
  200 older cards and keeps the card you were reading in place.
- **Go to top** draws every card and jumps to the oldest. Until you ask, the page's find can't match a
  hidden card, and the count on **Show earlier** says so.
- A remembered place or a named request in a hidden card reveals that page first. Only a card that's
  gone for good hands you a neighbor, and the Timeline's health counts that.
- While you follow the live end, the Timeline trims back to 200 once it draws 400. It doesn't trim a
  card holding the selection or focus, or while you're away from the live end. The trim runs in the
  frame after the list grows.
- Switching session or subagent starts on the newest page.
- **Chats only** is remembered per session until the app quits.
- Each card carries `aria-posinset` and `aria-setsize` for its place in the whole session.

The terminal client draws the same window and control, and doesn't trim.

Known limits:

- Turning **Chats only** off keeps the oldest drawn card, so the window can grow to about 600 cards
  until the next trim.
- After **Go to top** on a stopped session, returning to the live end doesn't trim, because a stopped
  session doesn't grow.
- A reading place stores its index among drawn turns, so its fallback neighbor can differ from the
  logical one after the window changes.

The transcript refuses two other designs. Don't drop old events or cards to meet a budget: the
projection stays whole. Don't add `content-visibility` to turns. It was tried in the real window on
September 30, 2026, and WebKit exposed 410 of 445 text elements in the window to accessibility as
empty, so a screen reader read blank cards. Reopen that only if WebKit exposes skipped text.

A card seeds its fold state at mount and then leaves it alone, so a call finishing doesn't shut the
card. Sidebar rows are keyed by session ID. A streamed message re-renders only its growing block, so a
selection across earlier paragraphs survives (`Markdown.test.tsx` checks this with a real
`Selection`).

## Tool cards

A tool call is one card, however many updates the provider sends. The ledger keeps rows per update,
and the transcript folds them by turn and tool ID. Parameters and output sit behind a disclosure, and a
call with neither renders as a flat row. An update with only output leaves the last status.

Whether a card starts open is **Tool call display** ([defaults](./defaults.md#tool-call-display)), not
the call's status. Codex reports `running` and ACP reports `pending` then `completed`, so status would
make the two harnesses differ. `AgentToolCallCard` resolves the setting once and passes `defaultOpen`
and `onOpenChange` to whichever renderer draws the call. On the desktop, a closed disclosure builds
its contents on first open and keeps them mounted after
([surface health](../telemetry/surface-health.md)). A loaded plugin's remote tree builds its whole
tree, because the host can't defer inside it.

**The card body is a slot.** A compiled plugin's renderer that matches the call wins, then a loaded
plugin's remote tree that declared the tool name, then the built-in card. All three get `tool`,
`defaultOpen`, and `onOpenChange`. A card that fails to draw shows a labeled placeholder.

Some presentation rules:

- Claude's `Skill` call is labeled from its input, such as **Launching skill: readable**, and a
  repeated sentence in the output is dropped.
- Claude's `ToolSearch` renders as **Load tools: WebFetch**. The ACP normalizer drops its input and
  output unless it failed.
- `ExitPlanMode`'s plan posts as an assistant message, read from the opening `tool_call` only.
- A plan update is a full snapshot, and one turn's snapshots fold into one card.

### File tool cards

A file tool opens onto its recorded diffs. The transcript matches per-file changes to a tool by turn
and change ID and passes them through `agents:tool-card` as `fileChanges`. The Changes plugin's card
and the generic fallback draw them with `StackedDiff`, with an **Open in Changes** button. Excerpts
leave line numbers blank, and oversized or missing patches say so. The standalone file-change row
hides only once its tool can show it. The patch describes the edit when it ran; the changes pane reads
the working tree ([file changes](./activity.md#file-changes)).

## Usage lines

Usage folds to one line per turn, on the Node and in the client, by the rule in
`plugins/agents/src/shared/usageFold.ts`. A harness reports usage as a running snapshot, about 58
rows a turn. The surviving row keeps the first update's ID and sequence.

A folded usage line has no card. It feeds the `Turn complete` line instead: the stop reason on the
left and the share of the context window used on the right. `conversationItems.ts` copies the figure
by position, because Codex clears the current turn before it sends the completion. For Codex,
`last.totalTokens` is compared with `modelContextWindow`, not the cumulative total.

With `fold=1`, the snapshot route and event pages also fold each tool call's updates within a page
onto the opener (`plugins/agents/src/shared/toolFold.ts`), with `foldedThroughSeq` marking the last
row absorbed. Paging resumes from that, and the transcript skips updates at or below it. A reader
without the flag gets every row.

## Request cards

A request the agent is blocked on draws in the transcript where it asked. While blocking, the card is
the control: a dropdown, checkboxes, a text box, or permission buttons. Once answered, it holds the
record of what was asked and answered, with the passed-over options folded below. A question stays.
An answered permission goes, because its tool call has a card. Both read the request row, not their
event. An answer to a question marked secret reads "Answer hidden". **Chats only** keeps questions and
anything still blocking.

## Subagent views

A subagent shows as one card in its parent's transcript and one indented row in the sidebar. The card
starts expanded while it's working. Its run renders through the same `AgentEventCard` as the parent's,
and a tool call stays in the stream that opened it. A subagent's mark is the same icon and color pair
as a session (`RuntimeStateIcon.tsx`). Its line names the status, role, and model. The token count
isn't shown, because it's mostly stale.

Selecting a sub-row, or the card's **Open**, moves the transcript onto that subagent's run, with a
header and a way back. The composer hides there, because neither harness lets you reply to a
subagent. Changing a provider option writes a row into the transcript where it happened.
