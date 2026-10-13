# Phase 02: open-fence highlighting

Completion note, October 13, 2026: `Markdown` now waits 300 ms after the last change before
highlighting an open fence. It cancels the timer when the block changes or disappears, while closed
fences keep their immediate highlight. This stays in the shared Markdown component so transcript,
plugin, and other callers get the same rule. Tests cover 50 growing updates, closure, an unfinished
final fence, and selection preservation. The kit reference documents the rule.

The phase 01 replay was unavailable during this phase. Run its `code` fixture in a visible window,
alternating base, candidate, candidate, base. Record whether the highlighter runs at most twice per
fence during streaming, the change in `highlight.html.render` time, and the `highlight.html.cache` hit
rate. This phase adds no measuring tool. The quiet period is a visible trade-off: an open fence stays
plain until it settles, then gains color once.

Status: implemented, October 13, 2026.

Read the [programme page](./README.md) first. This phase doesn't need phase 01 to start, but its
acceptance numbers come from 01's `code` fixture once that exists.

## Deliverable

A fenced code block that's still streaming draws as plain text. It gets its colors once, when the
fence closes or its text stops changing.

## The problem

`Markdown` in `packages/client-core/src/kit/components/content/Markdown.tsx` keys each block by its own
source. While an agent streams a code block, the unclosed fence is the last block, and its key
changes on every frame. So each frame builds a new element for it and queues that element for Shiki.
The fence loop adds every fence with a grammar, open or closed.

`highlightToHtml` in `packages/client-core/src/infra/highlight/shiki.ts` then colors the whole fence
from its first line on the main thread. Frames arrive about every 40 ms, so a 300-line block is
re-colored from the top about 25 times a second, and the total work grows with the square of the
block's length. Each partial version also goes into the 200-entry color cache, which pushes out
finished fences that are still on screen.

Zeron draws code as plain text first and treats color as paint added later. Acorn can get most of
that benefit without changing how color is applied.

## Change

Color an open fence only after its text has stopped changing for a short quiet period. Start with
300 ms. In the fence loop:

1. Send a closed fence to the highlighter as today.
2. For an open fence, which carries `data-open`, start a timer instead. When it fires and the block is
   still `live`, color it.
3. A replaced block is no longer `live`, so its timer does nothing.

Don't drop the open-fence case entirely. A reply can end with a fence the agent never closed, and that
block would stay plain forever.

Callers outside the transcript get the same rule, because they all render through `Markdown`. That's
correct for them too: a finished document has no changing fence, so the timer fires once.

## Implementation steps

1. Add the quiet-period timer for open fences in `Markdown.tsx`.
2. Add tests in `Markdown.test.tsx`, using `resetHighlightHtmlCache` and a spy on `highlightToHtml`:
   - 50 updates that grow an open fence call the highlighter zero times before the quiet period ends.
   - A fence that closes is colored once.
   - An open fence in a message that stops changing is colored after the quiet period.
   - The selection test across earlier paragraphs still passes.
3. Add the rule for open fences to
   [Markdown renders block by block](../../ui-design/kit-internals.md#markdown-renders-block-by-block),
   which says a closed fence is highlighted once and is silent on an open one.

## Acceptance

- With phase 01's `code` fixture, the highlighter runs at most twice per fence during the stream.
  `highlight.html.render` time during `streaming` drops, and the report shows by how much.
- The color-cache hit rate, from `highlight.html.cache`, doesn't fall during streaming.
- A finished message with an unclosed fence is colored.

## Risk

A long code block appears plain while it streams and gains color when it finishes. That's a visible
change. If it reads as a flash, color the open fence on a slower cadence, such as once a second,
rather than going back to every frame.
