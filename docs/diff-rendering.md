# Diff rendering

The right ("Diff") pane renders **every** changed file's diff stacked in one scroller. It is the most involved part of the [frontend](./frontend.md): patch text from the [GitHub integration](./github-integration.md) is parsed, syntax-highlighted, virtualized, progressively built, optionally split into two columns, given word-level intra-line diffs, and interleaved with inline review threads. All of this lives in `apps/web/src/client/DiffView.tsx`, with helpers in `diff.ts`, `shiki.ts`, and `fileNavigation.ts`.

## Data in

`DiffView` reads three queries for the routed PR (all `enabled: true` once a PR is open):

- `filesOptions` → `PullFile[]` — each file's `path`, `status`, `additions`/`deletions`, and `patch` (a GitHub per-file unified-diff hunk string, or `null` for binary / too-large files).
- `pullDetailOptions` → for `threads` (inline review threads) and `pull.headSha` (required to anchor new line comments).
- `prefsOptions` → for the `diff_view` preference (`unified` | `split`).

## Patch parsing

GitHub's per-file `patch` is **hunks-only** — it has no `diff --git` / `---` / `+++` file header, so a parser keyed on that header sees nothing. `diff.ts` synthesizes one:

```ts
export const synth = (path: string, patch: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`
```

`buildDiffRows(file, tokenize)` feeds `synth(...)` to `gitdiff-parser`, then flattens the parsed hunks into a flat `DiffRow[]`:

- `{ kind: 'hunk', text }` for each `@@` header (parser-provided, or reconstructed as `@@ -oldStart +newStart @@`).
- `{ kind: 'normal' | 'insert' | 'delete', path, oldNo, newNo, toks, raw }` for each line. `oldNo`/`newNo` carry the real line numbers from the parser; `path` rides along so a new line comment knows its file; `raw` is the untouched line text.

If `gitdiff-parser` throws, or yields zero rows, it falls back to `rawPatchRows` — a hand-roll that classifies lines by leading `+` / `-` / ` ` (no line numbers, `oldNo`/`newNo` stay `null`). Files with no `patch` return `[]` and render a single "No diff (binary or too large)." placeholder row.

## Syntax highlighting (Shiki)

`shiki.ts` builds a **fine-grained** highlighter via `createHighlighterCore` — only an explicit allow-list of grammars is bundled (the full `shiki` entry pulls a chunk per grammar). It loads:

- **Themes:** `github-light` and `github-dark` (dual-theme, so token colours follow the app theme through CSS vars, not a re-tokenize).
- **Langs:** typescript, tsx, javascript, jsx, json, css, html, markdown, python, go, rust, java, c, cpp, shellscript, yaml, sql.
- **Engine:** Oniguruma WASM.

`langFor(path)` maps the file extension to a grammar (e.g. `ts`/`mts`/`cts` → typescript, `rs` → rust, `sh`/`bash` → shellscript), defaulting to `text`. The `getHighlighter()` promise is memoized into a module-level singleton.

`highlighterTokenize` calls `codeToTokensWithThemes(content, { themes: { light: 'github-light', dark: 'github-dark' } })` and maps each token to `{ content, light, dark }`. At render time each token span sets `--l`/`--r` custom properties; CSS picks `--l` in light mode and `--r` in dark (see [ui-design](./ui-design.md)). `text` files (and a highlighter init failure) fall back to `plainTokenize`, a single uncoloured span.

## Progressive / chunked parsing

Parsing + highlighting every file up front would block the main thread on a large PR. Instead a `createEffect` reacts to `files.data` and builds in chunks **off the render path**:

1. Await the highlighter (or fall back to `plainTokenize`).
2. Iterate the file list in slices of **10**, calling `buildDiffRows` for each, accumulating into `acc`.
3. After each slice, `setParsed([...acc])` and `await setTimeout(0)` — yielding so the chunk paints before the next 10 parse.

A `parseRun` counter plus an `onCleanup` cancel flag guard against a stale run writing results after the file set changes (e.g. navigating PRs mid-parse). Because the effect tracks only `files.data`, **thread edits never re-tokenize** — they touch `detail.data.threads`, not files.

## Row model and interleaving

A `rows` memo flattens `parsed()` into the final `Row[]` the views consume:

- A `{ kind: 'file' }` header opens each file's section (and is the scroll anchor).
- Then the file's `DiffRow`s, with review **threads interleaved** immediately after their anchor line: a thread is matched to the file by `path`, and placed after the row whose line number equals `thread.line` on the thread's side (`RIGHT`/`null` → `newNo`, `LEFT` → `oldNo`).
- A `{ kind: 'nodiff' }` placeholder closes a file that had no patch.

Recomputing `rows` is cheap and reactive: it re-runs when parsing advances *or* threads change, so a resolve/reply rerenders without reparsing.

## View modes

`viewMode()` reads the `diff_view` pref; the toolbar's Unified/Split segmented control calls `setViewMode`, which writes the pref and invalidates `['prefs']`.

### Unified (default, virtualized)

The whole `rows()` list is virtualized with `@tanstack/solid-virtual` (`overscan: 20`, dynamic `estimateSize` per row kind — code 20px, file header 36px, thread 140px, nodiff 28px). Each visible row is measured back via `measureElement` so variable-height thread rows settle correctly. The scroll element is published through a signal inside `requestAnimationFrame` so the virtualizer's first size read happens **after** layout — otherwise a cached query can fill `rows()` in the same tick and freeze a 0-height viewport.

### Split (side-by-side)

`toBands(rows())` zips the same interleaved rows into `SplitBand`s:

- Hunk / file / nodiff / thread rows become full-width `{ kind: 'full' }` bands.
- A `normal` (context) line pairs with itself on both sides.
- Each maximal **delete-run** is zipped with the immediately following **insert-run** into `{ kind: 'pair', left, right }` bands; a longer run leaves unpaired one-sided cells. A stray insert-run with no preceding deletes is right-side only.

Split mode renders **non-virtualized** (every row mounts) — band pairing plus the full-width thread interleave made a `measureElement` virtualizer materially more complex; a very large PR in split mode is the known cost. Unified stays virtualized.

## Word-level intra-line diffs

`attachWordDiffs` pairs each maximal delete-run with the following insert-run and zips them by order (i-th delete ↔ i-th insert). For each pair, `wordDiff` runs `diffWordsWithSpace` (from the `diff` package — whitespace preserved so rendered text stays byte-faithful) and attaches a `WordTok[]` (`eq` / `add` / `del` spans) to each paired line's `words`. When a line has `words`, `CodeContent` renders those spans (`.diff-word-add` / `.diff-word-del` get a stronger background) instead of the Shiki tokens. Unpaired lines keep plain Shiki rendering. Change kind is always signalled by a marker glyph + background, never colour alone.

## Inline review threads

Threads render as full-width `ThreadRow`s (shared by both view modes via `NonCodeRow`): each comment, a Resolve/Unresolve toggle, a Show/Hide collapse when resolved, and a reply box (replies target the thread's first comment `databaseId`). A hover **`+`** on any code line opens a `LineComposer` to start a new line comment — enabled only when `headSha` is known and the line has a number. Both `addReviewComment` and `replyReview`/`resolveThread` invalidate `['pull', …]` on success (see [frontend](./frontend.md) for the mutation pattern).

## `?file=` scroll anchoring

`?file=` is **not** which file is shown (all files are always rendered) — it is the **scroll target**. It is set by the file list, the fuzzy finder, and the `[` / `]` shortcuts. Two mechanisms move the diff to it:

- **Search param effect** — a `createEffect` on `searchParams.file` calls `scrollToFile(path)`. Tracking `rows()` means a file still in a not-yet-parsed chunk scrolls as soon as its chunk lands; `lastTarget` stops later chunk appends or thread edits from yanking the scroll back after the initial jump.
- **Custom event** — `fileNavigation.ts` defines the `aacorn:file-scroll` event and `routeKey(owner, repo, number)`. `PullDetail.selectFile` both sets `?file=` and dispatches the event (`requestFileScroll`); `DiffView` listens and force-scrolls when the `routeKey` matches the current PR, so re-selecting the already-active file still scrolls.

`scrollToFile` finds the file header's row index. In unified mode it calls `virt.scrollToIndex(idx, { align: 'start' })`; in split mode (non-virtualized) it `scrollIntoView`s the element whose id is `diff-file:<path>`.
