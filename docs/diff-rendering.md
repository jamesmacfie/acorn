# Diff rendering

The right ("Diff") pane renders **every** changed file's diff stacked in one scroller. It is the most involved part of the [frontend](./frontend.md): patch text from the [GitHub integration](./github-integration.md) is parsed, syntax-highlighted, virtualized, hydrated in priority order, optionally split into two columns, given word-level intra-line diffs, expandable hidden context, and interleaved inline review threads. `DiffView.tsx` owns route/query/scroll orchestration (it renders one keyed `DiffForPull` per routed PR, so all per-PR state resets on navigation); pure model work lives in `features/diff/model.ts`, the priority hydrator in `features/diff/hydration.ts`, virtualizer construction + batched measure scheduling in `features/diff/virtualization.ts`, row rendering in `features/diff/DiffRows.tsx`, and shared helpers in `diff.ts`, `shiki.ts`, and `fileNavigation.ts`. `ComparePreview` (create mode's read-only base..head preview) reuses the same hydrator + row model, minus threads/composers/virtualization.

## Data in

`DiffForPull` reads four queries for the routed PR (all `enabled: true` once a PR is open):

- `filesOptions` → `PullFile[]` — each file's `path`, `sha`, `status`, `additions`/`deletions`, and `patch` (a GitHub per-file unified-diff hunk string, or `null` for binary / too-large files).
- `pullDetailOptions` → for `threads` (inline review threads) and `pull.headSha` (required to anchor new line comments).
- `prefsOptions` → for the `diff_view` preference (`unified` | `split`).
- `mentionsOptions` → distinct participant logins for the repo, feeding @mention autocomplete in the comment composers (5-min `staleTime`).

Patch bodies normally **all** arrive with the files query (binary / too-large / pure-rename files legitimately have `patch: null` and render a "No diff" row). The hydrator's patch source is injected by DiffView: a `cachedFile` lookup (per-path `filePatchKey` entries, then the warmed files query) and a `fetchPatches` fallback (the batch patch endpoint — `fetchFilePatches`, a POST of `paths[]` — seeding `filePatchKey` entries). The fallback is a leftover of the earlier summaries-first design and today only covers a body that is genuinely absent from every cache (e.g. a partial/restored cache). Expanding hidden context additionally fetches the full head blob on demand (`fileBlobOptions`, `staleTime: Infinity` — the body is keyed by immutable SHA).

## Patch parsing

GitHub's per-file `patch` is **hunks-only** — it has no `diff --git` / `---` / `+++` file header, so a parser keyed on that header sees nothing. `diff.ts` synthesizes one:

```ts
export const synth = (path: string, patch: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`
```

`features/diff/model.ts` owns the pure diff model. `buildDiffRows(file, tokenize)` feeds `synth(...)` to `gitdiff-parser`, then flattens the parsed hunks into a flat `DiffRow[]`:

- `{ kind: 'hunk', text }` for each `@@` header (parser-provided, or reconstructed as `@@ -oldStart +newStart @@`).
- `{ kind: 'normal' | 'insert' | 'delete', path, oldNo, newNo, toks, raw }` for each line. `oldNo`/`newNo` carry the real line numbers from the parser; `path` rides along so a new line comment knows its file; `raw` is the untouched line text.
- `{ kind: 'gap', path, sha, side, oldStart, newStart, count }` for each run of **hidden context** — before the first hunk (`side: 'top'`), between hunks (`'mid'`), and after the last hunk to EOF (`'bottom'`, whose `count` is `null` because the file's total length isn't known until the blob is fetched). Gaps render as "Expand N lines" rows (see below).

It then runs `attachWordDiffs` over the rows (word-level pairing, see below) before returning. If `gitdiff-parser` throws, or yields zero rows, it falls back to `rawPatchRows` — a hand-roll that classifies lines by leading `+` / `-` / ` ` (no line numbers, `oldNo`/`newNo` stay `null`). Files with no `patch` return `[]` and render a single "No diff (binary or too large)." placeholder row.

## Syntax highlighting (Shiki)

`shiki.ts` builds a **fine-grained** highlighter via `createHighlighterCore` — only an explicit allow-list of grammars is bundled (the full `shiki` entry pulls a chunk per grammar). It loads:

- **Themes:** `github-light` and `github-dark` (dual-theme, so token colours follow the app theme through CSS vars, not a re-tokenize).
- **Langs:** typescript, tsx, javascript, jsx, json, css, html, markdown, python, go, rust, java, c, cpp, shellscript, yaml, sql.
- **Engine:** Oniguruma WASM.

`langFor(path)` maps the file extension to a grammar (e.g. `ts`/`mts`/`cts` → typescript, `rs` → rust, `sh`/`bash` → shellscript), defaulting to `text`. The `getHighlighter()` promise is memoized into a module-level singleton.

`highlighterTokenize` (in `features/diff/model.ts`) tokenizes per line: `codeToTokensWithThemes(content, { lang, themes: { light: 'github-light', dark: 'github-dark' } })`, mapping each token to `{ content, light, dark }`. At render time each token span sets `--l`/`--r` custom properties; CSS picks `--l` in light mode and `--r` in dark (see [ui-design](./ui-design.md)). `text` files (and a highlighter init failure) fall back to `plainTokenize`, a single uncoloured span. **Oversized patches skip Shiki entirely**: a file whose patch exceeds 120 000 chars or 2 000 lines (`HIGHLIGHT_MAX_PATCH_*`, `DiffView.tsx`) gets the plain tokenizer so one generated file can't stall the main thread.

`shiki.ts` also exports `tokenizeAnsiLines`, which runs the same dual-theme treatment over ANSI-coloured CI log output for the checks panel (via `tokenizeAnsiWithTheme`, since `ansi` isn't a TextMate grammar).

## Priority hydration

Parsing + highlighting every file up front would block the main thread on a large PR. Instead `createDiffHydrator` (`features/diff/hydration.ts`) parses/tokenizes files **in priority order, off the render path**:

- Every file starts `queued`; a file not yet parsed renders a single `{ kind: 'load' }` row (spinner, or an error + Retry button).
- The pump drains the queue in batches of **4** (`PATCH_BATCH_SIZE`), waiting for browser idle between batches (`requestIdleCallback` with a 250ms timeout, or an 80ms sleep as fallback) and yielding a macrotask after each file so parsed chunks paint as they land.
- For each file it resolves the patch body — from the reset() snapshot, then the injected `cachedFile` lookup, then the injected `fetchPatches` batch for whatever's still missing (files with no source at all go to `error`) — then awaits the tokenizer (Shiki, or plain for oversized patches) and calls `buildDiffRows`, publishing the result into a `parsedByPath` map. The hydrator itself is source-agnostic: DiffView wires the query cache + batch endpoint; `ComparePreview` wires only `cachedFile` over the compare payload (every body is inline there).
- **Priority:** the `?file=` target (else the first file) is queued to the front on reset, and a `createEffect` over the virtualizer's visible rows continuously re-prioritizes whatever files are on screen — so scrolling pulls hydration to the viewport.
- A `generation` counter plus an `AbortController` guard against a stale run writing results after the file set changes (`filesSignature`, a `path:sha:additions:deletions` join, resets everything on change — new pushes re-hydrate, thread edits don't).

Because parsing keys off the files query alone, **thread edits never re-tokenize** — they touch `detail.data.threads`, not files.

## Row model and interleaving

`buildRenderableRows(parsed, threads, expanded)` flattens `parsed()` into the final `Row[]` the views consume:

- A `{ kind: 'file' }` header opens each file's section (and is the scroll anchor).
- Then the file's `DiffRow`s, with review **threads interleaved** immediately after their anchor line: threads are first grouped by `path`, then each file only checks its own bucket. A thread is placed after the row whose line number equals `thread.line` on the thread's side (`RIGHT`/`null` → `newNo`, `LEFT` → `oldNo`).
- A `{ kind: 'gap' }` row renders as an "Expand" button — unless its `gapId` is in the `expanded` map, in which case the revealed context lines are spliced in instead (threads interleave into those too).
- A `{ kind: 'load' }` row stands in for a file the hydrator hasn't parsed yet (or that errored).
- A `{ kind: 'nodiff' }` placeholder closes a file that had no patch.

Recomputing `rows` is cheap and reactive: it re-runs when hydration advances, a gap expands, *or* threads change, so a resolve/reply rerenders without reparsing. The path grouping keeps this at "files plus threads for that file" rather than repeatedly scanning every thread for every file. `rowIdentityKeys` / `splitBandIdentityKeys` derive a stable identity string per row/band (path + kind + line numbers, de-duplicated with a counter) which the virtualizers use as `getItemKey`, so measured heights survive rows shifting position as chunks land.

### Expanding hidden context

Clicking a gap row calls `handleExpand` (`DiffView.tsx`): it fetches the file's full head blob via `queryClient.fetchQuery(fileBlobOptions(...))` (cached forever by immutable `sha` — one fetch serves every gap in the file), slices the hidden lines with `expandGap` (unchanged context, so `oldNo`/`newNo` step together from the gap's start), tokenizes them, and records them in the `expanded` map keyed by `gapId`. Expansion is whole-gap; the map resets when the file set changes.

## View modes

`viewMode()` reads the `diff_view` pref; the toolbar's Unified/Split segmented control calls `setViewMode`, which writes the pref and invalidates `['prefs']`.

### Unified (default)

The whole `rows()` list is virtualized with `@tanstack/solid-virtual`, built through the shared `createDiffVirtualizer` factory (`features/diff/virtualization.ts` — `overscan: 20`, stable `getItemKey` from `rowIdentityKeys`, dynamic `estimateSize` per row kind via `estimateRowSize`; the size constants — code 20px, file header 36px, thread 140px / 50px when resolved-collapsed, nodiff/gap 28px, load 36px — are exported from `features/diff/model.ts` as the single source, and DiffView's fallback estimate reuses `DIFF_LOAD_ROW_HEIGHT`). Variable-height rows (threads, code rows with open composers) are measured back via `measureElement`, batched through the `requestAnimationFrame` schedulers from `createDiffMeasureSchedulers` (`scheduleElementMeasure` for per-row measures, `scheduleVirtualMeasure` for whole-list ones) so a burst of newly-mounted rows triggers one measure pass. The scroll element is published through a signal inside `requestAnimationFrame` so the virtualizer's first size read happens **after** layout — otherwise a cached query can fill `rows()` in the same tick and freeze a 0-height viewport.

### Split (side-by-side)

`toBands(rows())` zips the same interleaved rows into `SplitBand`s:

- Hunk / file / nodiff / load / gap / thread rows become full-width `{ kind: 'full' }` bands.
- A `normal` (context) line pairs with itself on both sides.
- Each maximal **delete-run** is zipped with the immediately following **insert-run** into `{ kind: 'pair', left, right }` bands; a longer run leaves unpaired one-sided cells. A stray insert-run with no preceding deletes is right-side only.

Split mode is virtualized too, with its **own** virtualizer (`splitVirt`, from the same `createDiffVirtualizer` factory) over the bands (`splitBandIdentityKeys` as item keys, `estimateSplitBandSize` = max of the two cells' estimates). The `bands()` memo is kept cold in unified mode — it returns `[]` unless `viewMode() === 'split'`, since band construction and keying is pure overhead while the unified list is active.

## Word-level intra-line diffs

`attachWordDiffs` pairs each maximal delete-run with the following insert-run and zips them by order (i-th delete ↔ i-th insert). For each pair, `wordDiff` runs `diffWordsWithSpace` (from the `diff` package — whitespace preserved so rendered text stays byte-faithful) and attaches a `WordTok[]` (`eq` / `add` / `del` spans) to each paired line's `words`. When a line has `words`, `CodeContent` renders those spans (`.diff-word-add` / `.diff-word-del` get a stronger background) instead of the Shiki tokens. Unpaired lines keep plain Shiki rendering. Change kind is always signalled by a marker glyph + background, never colour alone.

## Inline review threads

Threads render as full-width `ThreadRow`s from `features/diff/DiffRows.tsx` (shared by both view modes via `NonCodeRow`): each comment, a Resolve/Unresolve toggle, a Show/Hide collapse, and a reply box (replies target the thread's first comment `databaseId`). A hover **`+`** on any code line opens a `LineComposer` to start a new line comment — enabled only when `headSha` is known and the line has a number. Composers get an @mention autocomplete fed by `mentionsOptions`. Both `addReviewComment` and `replyReview`/`resolveThread` invalidate `['pull', …]` on success (see [frontend](./frontend.md) for the mutation pattern).

Because rows unmount as they scroll out of the virtual window, transient UI state is **hoisted into `DiffForPull`** and handed down as controllers: the open line composer (one at a time, keyed by `[path, side, lineNo]`, draft body included) and per-thread collapse (`threadCollapsed` map — a resolved thread defaults collapsed; when the server reports a resolve-state change the collapse follows it, and stale entries are pruned as threads disappear). Both feed the rAF measure scheduler so height changes settle immediately.

## `?file=` scroll anchoring

`?file=` is **not** which file is shown (all files are always rendered) — it is the **scroll target**. It is set by the file list, the fuzzy finder, and the `[` / `]` shortcuts — all through the shared `useChangedFiles` hook (`client/changedFiles.ts`), which owns the changed-file order (the summaries query) and the `?file=` read/write in one place. Two mechanisms move the diff to it:

- **Search param effect** — a `createEffect` on `searchParams.file` calls `scrollToFile(path)`. Tracking `rows()` means the target scrolls as soon as its file header exists; `lastTarget` stops later hydration or thread edits from yanking the scroll back after the initial jump.
- **Custom event** — `fileNavigation.ts` defines the `acorn:file-scroll` event and `routeKey(owner, repo, number)`. `PullDetail.selectFile` both sets `?file=` and dispatches the event (`requestFileScroll`); `DiffView` listens and force-scrolls when the `routeKey` matches the current PR, so re-selecting the already-active file still scrolls.

`scrollToFile` first calls `hydrator.prioritize(path)` — navigation jumps to the file header immediately and its parse jumps the queue rather than waiting on tokenization. It then finds the file header's index and calls `scrollToIndex(idx, { align: 'start' })` on whichever virtualizer is live (`virt` in unified, `splitVirt` in split). File headers still carry an `id` from `fileAnchor(path)` (`diff-file:<path>`).
