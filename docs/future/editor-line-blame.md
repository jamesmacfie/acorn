# Inline line blame in the Editor

Date: October 12, 2026. Status: implemented October 12, 2026. The real-host check and the open
questions below remain. [Line annotations](../editor/line-annotations.md) owns the shipped behavior.

This page is the requirements and design for showing Git blame on the cursor line in the desktop
Editor. It's for the developer who builds it. [Rows and annotations](../plugins/rows-and-annotations.md)
owns the annotation contract this plan extends, and [file annotations](../editor/file-annotations.md)
is the closest shipped example.

## Summary

When the cursor sits on a line in the desktop Editor, show who last changed that line and how long
ago, as muted text after the end of the line. Hovering that text opens a tooltip with the full commit
details. Zed's inline blame is the reference.

The work goes in three layers, each owned by the plugin that should own it:

1. **Host.** Annotation marks gain an optional rich `detail` field, and compiled plugins gain a way to
   contribute marks.
2. **Editor.** Editor declares an `editor:line` annotation point and draws its marks on the cursor line.
3. **Git.** Git contributes blame marks to `editor:line`, read from its own Node route.

Editor never learns about Git. Other plugins, compiled or loaded, can use the same point later, for
example for test coverage or errors reported on a line.

## Goals

- Show the author and relative age of the cursor line's last change without breaking the flow of
  reading code.
- Show full commit details on hover: author and email, the full commit message as formatted text,
  the date, a PR number if the subject has one, and the short commit ID.
- Build on the UI extension seams, not on a Git-to-Editor shortcut.

## Non-goals

- Blame for every line, or a blame gutter.
- Author avatars. The sanitizer turns images into placeholders on purpose.
- Clickable actions in the tooltip, such as a copy button or opening the commit in the Git pane.
  Marks have no actions by design.
- The terminal client. It edits files in `$EDITOR` and has no inline text.
- Blame of unsaved text.

## User experience

### Inline label

- It appears after the end of the cursor line, in muted text, with a small gap before it. Example:
  `George Czabania, 4 years ago`.
- For a line that isn't committed, it reads `You, not committed yet`.
- You can't select it, the cursor can't land in it, and copying text never includes it.
- It shows about 300 ms after the cursor stops moving. Moving the cursor hides it at once.
- It shows only when the document matches the file on disk. Typing hides it, and it comes back after
  autosave.
- With word wrap on, it may wrap like any other text at the end of a line.

### Tooltip

- It opens when the pointer rests on the label and closes when the pointer leaves both the label and
  the tooltip.
- An Editor command, **Show line blame details**, opens the same tooltip at the cursor for keyboard
  users.
- From top to bottom, it shows the author name and email, the full commit message drawn as sanitized
  Markdown, and a footer. The footer has the date, the PR number if the subject ends in `(#1234)`, and
  the short commit ID. The host's credit line, "From Git", comes last.
- You can select and copy text inside the tooltip.

### Setting

**Settings > Editor > Show line blame**, on by default. See the open questions.

## Gaps in the shipped contracts

Two things stop Git filling an annotation point today, and layer 1 closes both.

- **Marks are plain.** A mark is `{ key, severity, text, icon? }` (`PluginAnnotationMark` in
  `packages/protocol/src/chrome/extensionPoints.ts`). `sanitizeAnnotationMark` in
  `packages/client-core/src/host/chrome/chromeData.ts` cuts `text` to 200 characters and drops every
  other field. There's nowhere to put a commit message.
- **Only loaded plugins can contribute marks.** An annotation point accepts only the `items` carrier
  (`carrierFits` in `packages/client-core/src/host/registries/extensionPoints/extensionPoints.ts`).
  That carrier is built from a loaded plugin's manifest in
  `packages/client-core/src/host/chrome/chromeExtensionPoints.ts`. A compiled plugin's
  `ctx.extensions.register` always produces a `component` carrier
  (`packages/client-core/src/host/registries/extensionPoints/plugin.ts`). Git, GitHub, and Docker
  open annotation points, but no compiled plugin fills one.

## Design

### Layer 1: host

**Rich detail on marks.**

1. Add `detail?: { kind: 'markdown' | 'plaintext'; value: string }` to `PluginAnnotationMark`. This
   is the content shape language hover uses (`CheckedHover` in
   `packages/client-core/src/host/registries/panes/documentServices.ts`).
2. In `sanitizeAnnotationMark`, keep `detail` when `kind` is one of the two values and `value` is a
   non-empty string of at most 16 KiB of UTF-8. Otherwise drop `detail` and keep the rest of the mark.
3. Add `acceptsDetail?: boolean` next to `acceptedMarks` on the point registration. The shared
   annotation host (`packages/client-core/src/host/annotations/annotations.ts`) removes `detail` from
   marks for any point that doesn't set it. `editor:file`, `git:diff-line`, and `core:task` keep their
   behavior and payload size. That matters because `git:diff-line` can ask about 2,000 lines in one
   batch.
4. Move the Markdown rendering out of `hoverDom` in
   `packages/client-core/src/features/editor/languageServices.ts` into a shared helper that hover and
   annotation tooltips both call. It escapes the value, runs
   `sanitizedHtmlFragment(renderMarkdown(value, { images: 'placeholder' }))`, and adds the "From
   <plugin>" credit. Keep one sanitizing path, not two.
5. Export what Editor needs through `@acorn/plugin-api/ui/host` or `@acorn/plugin-api/ui/editor`, the
   way `annotationsFor` and `languageServices` are exported.

Detail is untrusted plugin content. It goes only through the shared sanitizer, which keeps `https:`
links and turns images into placeholders, so nothing loads from the network. The host writes the
credit line, so a plugin can't pass off its detail as another plugin's.

**Compiled mark contributors.**

1. Widen `CompiledExtension` so an entry brings either a `component` or a
   `marks(keys, signal)` function, never both.
2. In `ownExtension` in `plugin.ts`, register a `marks` entry with `carrier: 'items'` and
   `requestScope` set to the active Node, matching what the loaded path sets.
3. Run every contributor's answer through `sanitizeAnnotationMark`, whichever tier it came from. Move
   the call into the annotation host if that's the simplest way to share it.
4. Update the **Extensions** row in `docs/contribution-kinds.md`, which says a compiled carrier is a
   `component`.

### Layer 2: the `editor:line` point

**Contract.** Add `plugins/editor/src/contract/lineAnnotations.ts` (new file) next to
`fileAnnotations.ts`:

- `EDITOR_LINE_POINT = 'editor:line'`.
- `EDITOR_LINE_KEY = ['taskId', 'path', 'line', 'revision'] as const`.
- `line` is one-based.
- `revision` is the SHA-256 of the clean document's UTF-8 bytes, the body hash Editor already sends
  with line-marker requests ([line markers](../editor/line-markers.md#matching-the-displayed-text)).

Putting `revision` in the key drops stale answers without a transport change. An answer for an older
version of the file has a different key, so it attaches to nothing.

**Registration.** In `plugins/editor/src/client/index.ts`, next to the `file` point, register
`{ id: 'line', label: 'Editor line', kind: 'annotation', key: [...EDITOR_LINE_KEY], max: 2, acceptedMarks: 1, acceptsDetail: true }`.
That allows one mark per contributor and two contributors drawn inline.

**Requests.** Add a small module beside `plugins/editor/src/client/fileAnnotations.tsx` that calls
`requestAnnotations(EDITOR_LINE_POINT, [key])` for the cursor line only, 300 ms after the cursor
settles. It sends nothing when:

- the document is dirty or saving,
- the setting is off,
- the selection spans more than one line, or
- there's no body hash yet.

**Drawing.** Add a CodeMirror extension next to `plugins/editor/src/client/lineMarkerExtension.ts`:

- It reads `annotationsFor(EDITOR_LINE_POINT, key)` and places a `Decoration.widget` with `side: 1`
  at the end of the cursor line.
- The widget joins each mark's `text` with ` · `. It sets `user-select: none` and uses muted color
  tokens from the editor theme. CodeMirror widgets aren't part of the document, so copy and cursor
  movement skip them.
- Any document change clears the widget, the way `markerField` clears line markers.
- The tooltip uses CodeMirror's tooltip API, opened by pointer enter and leave on the widget's DOM,
  not by `hoverTooltip` on text positions. That keeps it from competing with language hover on code.
  It draws each mark's `detail`, or its `text` when there's no detail, with the shared renderer from
  layer 1.
- The extension goes in `perFile` in `plugins/editor/src/client/EditorPane.tsx`, next to
  `lineMarkerExtension()`.

**Command and setting.** Register **Show line blame details** with Editor's commands in
`plugins/editor/src/client/commands.ts`. Add the toggle to
`plugins/editor/src/client/EditorSettings.tsx`, with the value stored through
`plugins/editor/src/client/editorPrefs.ts`.

**Terminal.** Editor's client index runs on both hosts, so the terminal registers the point too. The
terminal never requests keys, so nothing changes there.

### Layer 3: Git contributes blame

**Client registration.** In `plugins/git/src/client/index.ts`, register
`{ id: 'line-blame', point: 'editor:line', label: 'Git blame', marks }` through `ctx.extensions`. The
`marks` function posts the keys to Git's route with `writeJson` from `@acorn/plugin-api/client`, as
`plugins/git/src/client/refsClient.ts` does.

**Node route.** Add a route beside the others in `plugins/git/src/server/routes`, built on `gitRouter()`,
with the logic in `plugins/git/src/server/lineBlame.ts` (new file).

- **Input.** `{ keys: [{ taskId, path, line, revision }] }`. Handle at most eight keys and ignore the
  rest. In practice there's one.
- **Authority.** Use the checks in `uncommittedEditorLineMarkers`
  (`plugins/git/src/server/changes/editorLineMarkers.ts`): `isEditorRelativePath(path)`,
  `core.tasks.root(taskId)`, and the read gate in `plugins/git/src/server/readGate.ts`. `line` must
  be a positive integer.
- **Freshness.** Hash the file on disk before and after running blame. If either hash differs from
  `revision`, return no mark for that key.
- **Blame.** Run `git blame --porcelain -L <line>,<line> -- <path>` in the task root, with a 10-second
  timeout and an output cap. If the file is untracked, the repository has no `HEAD`, or the commit ID
  is all zeros, answer `You, not committed yet` with no detail.
- **Commit details.** Run `git log -1` with a format string on the commit ID to get the full message,
  author, email, and author date. Cache results by commit ID in a bounded map of about 500 entries.
  Commits never change, so the cache never needs invalidating.

**The mark.** Return one mark per key:

- `severity: 'info'` and no icon.
- `text` is `<author>, <relative age>`, for example `George Czabania, 4 years ago`. The Node computes
  the age when it answers.
- `detail` is Markdown. The first line is the author and email, then the commit message, then a footer
  line with the date (`19 Jul 2022`), the `#1234` from the subject if there is one, and the 7-character
  commit ID in code font. Escape the author name and email so they can't inject Markdown.
- The commit message is untrusted. The host sanitizes it, and Git does nothing more to it.

Git's own blame configuration still applies. For example, `blame.ignoreRevsFile` in the repository's
config takes effect.

### Data flow

1. The cursor stops on line 42 of a clean document.
2. Editor builds `{ taskId, path, line: 42, revision }` and calls `requestAnnotations`.
3. The shared annotation host calls Git's `marks` function, which posts to Git's route on the Node in
   view.
4. Git checks authority and the file hash, runs blame, and returns one mark.
5. The host sanitizes the mark, keeps `detail` because the point opted in, and stamps the plugin ID.
6. Editor's extension reads the mark and draws the widget. Hovering the widget draws the tooltip.

If the cursor moves or the text changes, the host drops the late answer and Editor clears the widget.

## Acceptance criteria

1. On a committed line in a clean file, the label shows the correct author and relative age within
   about a second.
2. On a line you changed but haven't committed, or in an untracked file, the label reads
   `You, not committed yet`.
3. Typing hides the label at once. It comes back after autosave without moving the cursor.
4. The label can't be selected, the cursor can't land in it, and copying a range never includes it.
5. Hovering the label shows the tooltip with the author and email, the formatted message, the date,
   the PR number when the subject has one, the short commit ID, and "From Git".
6. **Show line blame details** opens the same tooltip from the keyboard.
7. Turning the setting off removes the label and stops all requests.
8. Turning the Git plugin off removes the label, and Editor otherwise works as before.
9. Marks on `editor:file`, `git:diff-line`, and task rows look and behave as before, and their
   payloads carry no `detail`.
10. A commit message with HTML, script tags, images, or non-`https` links is drawn safely: no script
    runs, no image loads, and only `https` links survive.
11. A route answer for an older file revision or another line never shows.
12. Language hover tooltips still work on the same line.

## Tests

- **Client-core.** `sanitizeAnnotationMark` keeps valid detail, drops oversize or malformed detail,
  and keeps the rest of the mark. The annotation host strips detail for points without
  `acceptsDetail`. A compiled `marks` contributor fills an annotation point, and its answer is
  sanitized like a loaded one. The shared renderer sanitizes output, and the hover tests still pass.
- **Editor**, in the jsdom tier as `.test.tsx`. No request goes out while the document is dirty,
  saving, or has a multi-line selection. The widget appears for a matching key and clears on edit. The
  tooltip renders detail. The setting turns everything off.
- **Git.** `plugins/git/src/server/lineBlame.test.ts` (new file) runs against a temporary repository:
  committed line, uncommitted line, untracked file, unborn repository, revision mismatch, file changed
  during blame, path outside the worktree, non-integer line, and the commit cache.
- **Real-host check.** Run `pnpm dev:agent -- --session blame`, open a file in a task, move the
  cursor, hover the label, and take screenshots. [Local development](../local-development.md) covers
  the driver.
- **Before handoff.** Run `pnpm lint`, `pnpm test --filter` for client-core, plugin-api, editor, and
  git, and `pnpm --filter @acorn/arch-tests test`, because the change touches contribution types and
  docs.

## Docs to write when it ships

- `docs/editor/line-annotations.md` (new file) covers the point, its key, the revision rule, drawing,
  and limits. List it in `docs/README.md` and link it from `docs/editor.md`.
- In `docs/plugins/rows-and-annotations.md`, document `detail`, its cap, the `acceptsDetail` opt-in,
  and compiled contributors.
- In `docs/editor/file-annotations.md`, add one line saying `editor:file` doesn't accept detail.
- Update the **Extensions** row and the places-to-fill table in `docs/contribution-kinds.md`.

## Delivery order

Each step can merge on its own:

1. Layer 1 with its tests and docs. Nothing uses it yet, and existing points are unchanged.
2. Layer 2, tested with a fixture contributor.
3. Layer 3, the setting, the command, and the real-host check.

Estimate: a day for layer 1, because compiled contributors add work, and about a day for layers 2
and 3 together.

## Risks

- **Slow blame.** Blaming one line in a file with a long history can take a couple of seconds. The
  timeout and the commit cache limit the damage, and the label shows late or not at all.
- **Ageing text.** The Node computes the relative age when it answers. A label left on screen for
  hours drifts by that much, and the next request refreshes it.
- **Cost of the freshness check.** Each request reads and hashes the file twice on the Node. That's
  fine at one request per cursor stop. Revisit it before widening the point to many lines.
- **A new compiled carrier.** Compiled mark contributors are a contract change in the plugin host.
  Check them against [the cooperative extension point rules](../plugins/cooperative-extension-points.md)
  before building.

## Open questions

1. Should the setting default to on, as in Zed, or off?
2. Should `#1234` be a link? Git could build an `https` URL from a GitHub `origin` remote, and the
   sanitizer would keep it. That's more code in Git and makes the tooltip less neutral about hosts.
3. Should blame ignore whitespace-only changes with `-w`? This plan keeps Git's default.
4. Should the date use the device's locale and time zone? Git formats it on the Node, which may be a
   remote machine.
