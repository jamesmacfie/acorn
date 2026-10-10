# Phase 10: add Markdown fence viewers

Status: done, October 10, 2026. Branch `phase-10-markdown-fences`, from `b0cb6eaea`.

## Completion note

A plugin can draw a closed code fence in an agent's reply, or in a loaded pane's own `Markdown`, by
its language hint. The owner keeps the source, Copy, and a Source/Preview toggle outside the viewer,
and opens at most four viewers per message or `Markdown` node. With no contributor, both hosts draw
fences as they did.

### What landed

- **Protocol.** `CORE_MARKDOWN_FENCE_POINT`, `MarkdownFenceProps`, `MAX_MARKDOWN_FENCE_BYTES`
  (256 KiB), and `markdownFenceKey` sit in `extensionPoints.ts`. The key is the lowercased hint. A
  fence with no hint, or with text over the cap in UTF-8, has no key.
- **Parser.** `renderBlocks` sets `fence: { language, text }` on a closed fence's block, taken from
  the source lines. An open fence gets none.
- **Kit.** `Markdown` takes `fences`, a `MarkdownFenceAdapter` (`kit/lib/rendering/markdown.ts`). It
  asks once per closed fence block, inserts the view in `.ui-code-wrap` after a marker, sets
  `data-preview` to hide the source, and disposes the view with its block. The terminal's `Markdown`
  draws block by block with the same reuse, so a viewer outlives streamed chunks.
- **Host.** `host/markdownFences/fenceViewers.ts` registers the point (`core`, `remote`, `replace`,
  `max: 1`) and holds one owner's block ids, the resolve rule, the cap, and the choices.
  `MarkdownFences.tsx` draws the desktop toggle and a bounded `Slot`. `apps/tui/src/kit/host.tsx`
  draws **Source**/**Preview**, **Copy**, and the hint and plugin on a line, and clips a viewer at 20
  rows. Both export `markdownFences(scope)` through `@acorn/plugin-api/ui/host`.
- **Owners.** `ManagedAgentMarkdown.tsx` opts every transcript Markdown in. `register.ts` mounts pane
  regions with `markdownFences: true`. `RemoteTree` passes its bound scope to `TreeHost`, and both
  tree hosts give each `Markdown` node its own adapter, or `undefined`, replacing any worker value.
- **Docs.** [Markdown fences](../../plugins/markdown-fences.md) owns the contract, with a row in
  [remote points](../../plugins/remote-points.md) and a paragraph in the `plugin_authoring` brief.

### Decisions and deviations

- **`blockId` is per block, not per position.** A block's key includes its text, so a changed fence is
  a new block. The old viewer is disposed before the new one mounts, and no viewer ever holds text it
  wasn't given. That makes "source until the matching revision" automatic. `revision` is the owner's
  render count when the block appeared.
- **No hint, no viewer.** Otherwise a contributor without `matches` would claim every plain fence. No
  aliases are mapped, because none has a defined equivalence.
- **The cap is first come, in document order.** The first four fences somebody can draw open on their
  own. **Preview** on a fifth sends the earliest open one back to source. A person's **Source** sticks
  for the block's life. A tie with no pick, a failed tree, or a contributor going away leaves source.
- **`Slot` is loaded lazily** by `MarkdownFences.tsx`, because `Slot` draws `RemoteTree`, which draws
  `TreeHost`, which draws the fence view. A static import would close that loop.
- **Copy on the terminal is the host's.** The terminal's `Markdown` never drew a fence copy control, so
  the fence line carries one only where a viewer can draw.
- **Opted in: transcripts and pane regions.** Reference panels, settings trees, and chrome replacements
  keep plain fences. Provider HTML is excluded, as the plan says. No overlay fixture: nothing needed
  pixels, and the docs point a pixel viewer at its companion overlay.
- **No committed loaded fixture,** as in phases 01 to 08. A tree fixture needs a built bundle, and
  automated tests use compiled contributors. The scratch plugin lived in `/tmp`.
- `markdownLines` in `apps/tui/src/kit/markdown.ts` is gone. Its one caller draws block by block.

### Verification

Run with Node 26.8.1.

- `MarkdownFences.test.tsx` (9): a streaming fence starts nothing until it closes, then gets exact
  props; no hint, no match, or over 256 KiB gets no viewer; the cap and making room; Source and Copy;
  a changed fence disposes before remounting; equal fences, insertion, and removal; a selection above
  survives; a disabled contributor or failed tree leaves the source; a tie draws nothing.
- `Markdown.test.tsx`, `MarkdownLifetime.test.tsx`, `markdown.test.ts`, and the protocol key test cover
  the kit and parser halves. `TreeHost.test.tsx` covers an opted-in tree and a contributor's tree whose
  worker sends `fences`. Without the override that test fails with "adapter is not a function".
- Terminal: `plugins.test.tsx` draws the viewer, the cap, pressing **Preview** on the fifth, and both
  tree host cases in cells. `markdown.test.tsx` checks block-by-block output equals the old render.
- Suites: `@acorn/protocol` (301), `@acorn/client-core` (2,713), `@acorn/node-core` (1,760), and
  `@acorn/plugin-api` (14, with the surface snapshot gaining `markdownFences`) pass. `@acorn/plugin-agents`
  fails only `managedBridge`, `@acorn/tui` only the two `chrome.test.tsx` marker tests, and
  `@acorn/arch-tests` only the 15 known dead links. Client-core's entrypoint ceiling moves from 180 to
  182 for `fenceViewers.ts` and `MarkdownFences.tsx`. Lint errors are only in the known agents,
  changes, git, and workflows files, and oxlint flags nothing new. The full suite wasn't run.
- Budgets: the Node service reads 1,757,365 of 1,759,000 B, unchanged because the brief is in a lazy
  chunk. The terminal startup closure reads 688,799 of 700,000 B.
- **Desktop, `pnpm dev:agent --fixture tui-navigation`,** with a scratch plugin matching `json`, `ts`,
  and `typescript`, plus a pane whose tree streamed five JSON fences four characters at a time. Each
  transcript message drew its `ts` fence as the viewer, `fence-1` with the task's id. **Source** showed
  the code and **Preview** restored the viewer, while a selection in the paragraph above held. In the
  pane, fences opened one by one as each closed, at revisions 35, 53, 70, and 87, with the paragraph
  above still selected and the same element. The fifth closed as source with **Preview** unpressed.
  Pressing it mounted `fence-5` and sent the first back to source. After disabling the plugin and a
  Node restart, every fence was source with no toggle. The hidden window ran timers slowly.
- **Terminal, `pnpm dev:tui:agent --fixture tui-navigation`.** The trust prompt named the fence
  contribution. The transcript drew `[Source] Copy ts · fence-scratch` above the viewer, with the source
  hidden. The driver can't press a button inside a pane or reach a loaded pane's tab, so pressing is
  covered by the cells test above.

### What later phases need to know

- To offer viewers in another host-owned surface, call `markdownFences({ taskId, projectId })` once in
  its component and pass the result as `Markdown`'s `fences`. Pass one value for the node's life.
- A tree host offers fences only when its `RemoteTree` sets `markdownFences`. Keep it off for anything
  drawn in another owner's slot.
- Solid's `insert` without a marker clears the whole parent when its value empties, and a props spread
  skips `undefined`. Both bit this phase.

## Original plan

Planned October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 09. Editor file viewers remain a separate prerequisite and owner.

Let plugins render completed Markdown code fences by language while the owner preserves source,
copy, streaming selection, and block lifetime. Start with kit UI and explicit overlay expansion.

## Starting point and owners

`packages/client-core/src/kit/lib/rendering/markdown.ts` parses and sanitizes rendered blocks.
`packages/client-core/src/kit/components/content/Markdown.tsx` reconciles block elements, highlights
raw fence HTML, and mounts copy controls. Fences are not `CodeBlock` component instances.
`packages/client-core/src/host/components/ProviderHtml.tsx` is a different provider-HTML path.
`plugins/agents/src/client/sessions/ManagedAgentMarkdown.tsx` is a host-owned transcript adapter.
`packages/client-core/src/host/tree/TreeHost.tsx` draws remote nodes with host-only mounting context.

Read [remote points](../../plugins/remote-points.md), [UI tiers](../../plugins/ui-tiers.md),
and [client lifetime](../../managed-agents/client-surfaces.md).

## Contract

Core owns `core:markdown-fence`, `remote`, `replace`, keyed by the lowercased language hint. Preserve
the original hint in props. Normalize published language aliases only when their equivalence is defined.
Pass `{ blockId, language, text, revision, taskId?, projectId? }`, capped at 256 KiB of fence text.
Incomplete streaming fences and oversize fences draw source only and start no contributor.

The owner draws Source/Preview and Copy outside replacement UI. A changed fence becomes source until
its replacement has the matching revision. Keep at most four visible/expanded fence contributors per
content owner; further fences remain source with an explicit Preview action to replace an earlier mount.
No per-fence persistent preference is required; use owner-local state until unmount.

Only host-owned Markdown content and top-level loaded owner surfaces with bound content scope opt in.
A Markdown node emitted inside a cooperative contributor does not open another cooperative point.
In particular, a remote Markdown Editor viewer keeps ordinary fences until nested composition has a
separate approved design. This phase does not weaken the one-level slot restriction.

Pixel renderers use a remote summary plus a declared companion overlay. Inline iframe fence replacement
is deferred. Provider HTML is excluded until it has reliable source-fence metadata.

## Steps

1. Add the typed core point and discovery. Extend the parser's private block metadata to identify
   completed fenced blocks and source text without parsing rendered HTML back into source.
2. Add a presentation-only fence mount adapter to Markdown internals. A host wrapper supplies
   contributor mounting, identity, and scope; the kit imports no registry and workers supply no callbacks.
   Keep the ordinary Markdown node behavior when that host adapter is absent or nesting is disallowed.
3. Reconcile by owner/block identity, preserving prior unchanged nodes and selection. Dispose the
   old contributor before reusing a replaced block and keep highlights/copy independent of preview UI.
4. Add a loaded JSON/table fence viewer fixture. Add a declared overlay fixture for pixel expansion
   only if needed to prove that carrier path; no arbitrary HTML, external page, or inline iframe is required.
5. Add terminal Source/Preview controls and bounded remote views. Companion overlay refusal leaves
   the source or summary usable and visible. Enforce the same mount cap in both hosts.

## Tests and acceptance

Extend `markdown.test.ts`, `Markdown.test.tsx`, `MarkdownLifetime.test.tsx`, TreeHost tests, and
terminal document tests. Cover incomplete streaming fences, repeated equal fences, insertion/removal,
changed language/text, selection in preceding blocks, stale render reads, cap enforcement, contributor
disable, source copy, and a Markdown node inside a contributed tree attempting to nest.

Run `pnpm lint`, full suites for `@acorn/client-core`, `@acorn/plugin-agents`, `@acorn/tui`, affected
protocol/SDK packages, and architecture. Expect exit zero. Stream Markdown in both real hosts and
toggle a completed fence. Record that unchanged blocks retain selection and hidden fences start no worker.

Complete when source/copy remain owned, completed fences mount bounded contributors, and no renderer
is incorrectly assumed to cover raw Markdown fences just because it covers `CodeBlock`.

## Verify before building

- Recheck parser block keys, completion metadata, sanitization, and disposal paths.
- Recheck whether an opt-in host mount is a top-level owner or a cooperative contributor.
- Stop if this requires generic nested remote slots or reconstructing source from untrusted rendered HTML.
