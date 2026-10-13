# Phase 03: incremental Markdown

Completion note, October 13, 2026: The measurement passed the gate, so no code changed. Only the
dated [Markdown parse cost check](../../testing/incremental-markdown-parse-2026-10-13.md) landed.
`renderBlocks` and `Markdown` are unchanged.

An agent-launched window is always hidden, so this phase didn't run the phase 01 replay. Instead,
it streamed the generated `prose` reply into `renderBlocks` in plain Node, one chunk per frame.
Updates from 45 KB to 50 KB had a 95th percentile of 0.94 to 1.46 ms over five runs on a busy
M2 Pro, under the 2 ms gate. Node runs V8, while the window runs WebKit's JavaScriptCore, so this is
a proxy. jsdom would add nothing, because the parse touches no DOM.

A person still needs to run `pnpm dev:agent:ui -- replay prose` twice in a visible window with
telemetry on. From each report's `streaming` phase, record the `markdown.parse` `p95`, `p50`,
`max`, `count`, and `sum`, the `markdown.parse.characters` `max`, and the `markdown.render` `p95`.
That pooled `p95` reflects the cost near 67 KB, so a value under 2 ms confirms the gate. If it's
over 2 ms, build the change below as written. Nothing in it has gone stale. Phases 04 and 05 can
treat the per-frame parse as a small, linear cost, about 16 microseconds per KB in Node.

Status: not built; parse cost under the gate in a Node proxy, October 13, 2026.

Read the [programme page](./README.md) first. This phase starts by measuring with phase 01 and may end
there.

## Deliverable

A streamed message re-parses from the start of its last block, not from its first line. If phase 01
shows the parse cost is small, the deliverable is instead a dated note saying so, and nothing ships.

## The problem

`renderBlocks` in `packages/client-core/src/kit/lib/rendering/markdown.ts` splits the whole message
into lines, parses every block, renders its HTML, and hashes its source, on every update. `Markdown`
then reuses the elements whose keys didn't change, so the page work is small. The parse work isn't:
each frame costs time in proportion to the message's length, so a long reply's total parse cost grows
with the square of its length.

[The transcript store](../../managed-agents/transcript-store.md#the-transcript-store) measured a message
delta at 0.8 ms median in jsdom on September 26, 2026, with typical messages. That doesn't show the
cost at the end of a 50 KB reply. Zeron re-parses only from the last finished block.

## Measure first

Run phase 01's `prose` fixture and read `markdown.parse` against the message length. If its 95th
percentile stays under 2 ms at 50 KB in the real window, record that in a dated page under
`docs/testing/` and stop. The change below adds state to a pure function, and it isn't worth that
cost for a millisecond.

## Change

Add a stateful renderer beside `renderBlocks`, such as `createBlockRenderer()`, that returns a
function from source to blocks. It keeps the blocks from the last call, with the line each one
started on.

- When the new source starts with the previous source, it keeps every block before the last one and
  parses again from the last block's first line. The last block may grow, close, or split into
  several.
- Otherwise, as after an edit or a replacement, it parses from the top.

`Markdown.tsx` holds one renderer per instance. `renderBlocks` and `renderMarkdown` stay as they are
for callers that render once.

This parser is line-based. It has no reference-style link definitions and no setext headings, so a
later line can't change the meaning of an earlier block. A table or a list that continues is part of
the last block, which is parsed again. Recheck this if the parser gains a construct that reaches
backward.

## Implementation steps

1. Measure with phase 01 and decide.
2. Add the stateful renderer.
3. Add a property test: for a corpus of Markdown samples, and for every prefix of each, the stateful
   renderer's output equals `renderBlocks` on the same text. Include fences, tables, lists, block
   quotes, and the image options.
4. Switch `Markdown.tsx` to it.
5. Update the comment above `digest` in `markdown.ts`, which describes the per-frame work, and
   [Markdown renders block by block](../../ui-design/kit-internals.md#markdown-renders-block-by-block).

## Acceptance

- The property test passes.
- With the `prose` fixture, `markdown.parse` at the end of the reply is flat, not rising with length.
- The selection test in `Markdown.test.tsx` still passes.
