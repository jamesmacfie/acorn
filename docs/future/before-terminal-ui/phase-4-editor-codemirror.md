# Phase 4: the editor moves to CodeMirror

Status: SHIPPED 2026-08-31. `docs/editor.md` owns the result.

## Goal

Both Monaco instances — the editor plugin's pane and the host's document surface — run on
CodeMirror 6, and `monaco-editor` leaves the tree. The editor pane roots itself in kit nodes, and
the `Rectangle kind="editor"` contract is unchanged: the host still hands the caller an element, the
caller mounts a different library into it.

## Why this phase, and why now

Monaco is 2 to 5 MB of VS Code brought along for a feature set the two call sites barely touch:
multi-document editing, view-state restore, a save keybinding, and one completion provider. It is
webview-only, reads `window` at module scope (which is why the `ui/editor` entrypoint exists and is
node-unloadable), and its worker wiring is bespoke boot code. CodeMirror 6 is modular and MIT, a
few hundred kilobytes tree-shaken against Monaco's megabytes, covers everything both call sites use
— `@codemirror/autocomplete` for the completions, keymap precedence for the interception — and
needs no worker. The owner's decision is both instances at once, because replacing one keeps the
dependency, the boot wiring, and a second editor stack in the bundle for no benefit.

This phase does not make editing work on the terminal — the TUI's editor story is a read-only view
plus a suspend-and-hand-off to `$EDITOR`, owned by the terminal programme. What it does is remove
the heaviest DOM-only dependency from the path, put the pane's own chrome (tabs, alerts, actions)
on kit nodes so the parts the terminal *does* draw are drawable, and set up phase 5.

## Scope

In:

- **`plugins/editor/src/client/EditorPane.tsx`** rebuilt on CodeMirror: one `EditorView`, one
  `EditorState` per open file cached the way models are cached today, dirty tracking against the
  document (Monaco's version-id trick has a direct equivalent), view-state save and restore across
  tab swaps (`plugins/editor/src/client/editorViewState.ts` reshapes around selection plus scroll),
  cursor reveal for file-navigation jumps, selection read for the "to agent" reference button, a
  mod-S binding, autosave on blur and tab switch, and read-only until the first write succeeds —
  the same behaviours, one library over.
- **`packages/client-core/src/features/editor/DocumentSurface.tsx`** likewise, plus its two extras:
  the completion provider moves to `@codemirror/autocomplete` with the same item-kind mapping, and
  the host-keybinding interception moves from Monaco's keyboard event hook to a highest-precedence
  CodeMirror keymap that defers to the window dispatcher, keeping the composed-pane chord contract
  (`docs/command-palette-and-shortcuts.md`) intact.
- **The shared surface reshapes.** `packages/client-core/src/features/editor/monacoSetup.ts` is deleted —
  CodeMirror has no worker environment to wire. `theme.ts` and `language.ts` keep their
  jobs with CodeMirror types behind them; the ~25-language map now resolves to Lezer language
  packages. The `@acorn/plugin-api` `ui/editor` entrypoint keeps existing for the same reason it
  exists now — the editor stays out of every other pane's boot graph — with its exports renamed for
  what they are, not for Monaco.
- **In-editor highlighting** comes from `@codemirror/language` and Lezer grammars. Shiki
  (`packages/client-core/src/infra/highlight/`) stays exactly where it is: it is the read path
  (diffs, code blocks) and the kit's sanctioned highlighter, and this phase does not touch it.
- **The pane root.** The raw `<section class="pane editor-pane">` becomes kit layout. The `ref` on
  it exists to scope the close-pane chord to "focus is inside this pane"; the phase resolves that
  scoping without a raw element — either the layout host exposes the pane's own region (the same
  question its `onClosePane` handling already answers for other panes) or the chord scoping seam
  grows one accessor. Decide when building; do not keep the section.
- **The reload-on-focus listener.** The behaviour stays — the agent and the human share a worktree,
  so the pane re-reads a clean file when the window regains focus — but the raw `window` listener is
  named for what it is: a desktop-host concern, moved behind whatever focus signal the platform seam
  or the host already carries, or documented in-place as rectangle-adjacent if nothing carries one.
- Both `package.json`s drop `monaco-editor`; `plugins/editor/package.json` and
  `packages/client-core/package.json` gain the pinned `@codemirror/*` set.

Out: any editor feature that does not exist today. No minimap (disabled today anyway), no
multi-cursor beyond what CodeMirror gives free, no LSP. Find-in-file is whatever the library's
search package gives, matching today's "whatever Monaco gives free". `plugins/editor/src/client/FileTree.tsx`,
the file palette, and the server-side ripgrep search are untouched.

## Design detail

**The rectangle contract is the fixed point.** `packages/client-core/src/kit/components/content/Rectangle.tsx`
hands back a mount element and owns Enter-to-enter, Escape-to-leave. Nothing in this phase changes
it; the terminal host's plan to draw `editor` rectangles natively (read-only view, `$EDITOR`
handoff) is unaffected by which library the DOM host mounts.

**View state is plugin-owned data.** Monaco's opaque `saveViewState` blob becomes an explicit
`{ selection, scrollTop }` shape in `editorViewState.ts`, which is strictly better: the pane owns
what it persists instead of a library's serialization format.

**Completions stay a caller concern.** `DocumentSurface` registers its provider per language the way
it does today; the SQL schema completions the database pane feeds it are data in, suggestions out,
and the pane never learns which editor renders them.

**Migration is a cut, not a bridge.** No feature flag, no dual mount. The two call sites are the
whole surface, the tests below are the safety net, and half-migrated would mean shipping both
libraries, which defeats the point.

## Code touched

- `plugins/editor/src/client/EditorPane.tsx`, `plugins/editor/src/client/editorViewState.ts`,
  `plugins/editor/package.json`
- `packages/client-core/src/features/editor/DocumentSurface.tsx`,
  `packages/client-core/src/features/editor/theme.ts`,
  `packages/client-core/src/features/editor/language.ts`,
  `packages/client-core/src/features/editor/monacoSetup.ts` (deleted),
  `packages/client-core/package.json`
- `packages/plugin-api/src/ui/editor.ts` (exports renamed; the entrypoint and its
  keep-out-of-boot-graph reason survive)
- `apps/desktop/src/client/index.tsx` (the side-effect import of the worker setup goes)

## Tests

- The editor plugin's jsdom tests cover: open two files, edit one, swap tabs, swap back, view state
  restored, dirty marker correct, mod-S writes, blur flushes.
- A document-surface test drives a completion from a registered provider and asserts a host chord
  pressed inside the editor still reaches the dispatcher.
- The arch test that records `ui/editor` as node-unloadable is revisited: if CodeMirror loads under
  node, the entry comes off that list, which is a small honesty win recorded in the test's comment.
- `pnpm --filter @acorn/desktop test` boots the bundle without the Monaco workers.

## Docs owed

- `docs/editor.md` is rewritten for the new editor, renamed from `editor-monaco.md` (deleted); every
  doc that links it repoints. See [docs-migration.md](./docs-migration.md).
- `docs/first-party-plugins.md`'s editor row, if it names Monaco.

## Doors left open

1. LSP over CodeMirror, if the pane ever wants real language intelligence; the modularity is the
   point of the library.
2. The read-only text view the TUI needs (terminal programme, rendering doc) sharing
   `language.ts`'s vocabulary for its own highlighting.

## Done when

- `rg monaco -i` across `packages/`, `plugins/`, and `apps/` returns only history: the docs
  migration note and comments that explain what was replaced.
- Both editors open, edit, complete (document surface), save, and restore state, verified in the
  running app against a real worktree.
- The desktop bundle is measurably smaller, and the number lands in the commit message.
- `pnpm lint` and `pnpm test` are green.

## Verify before building

- `EditorPane.tsx` still imports `monaco-editor` directly and mounts into a
  `Rectangle kind="editor"`; `DocumentSurface.tsx` is still the only other Monaco call site (grep
  `from 'monaco-editor'`).
- `monacoSetup.ts` is still imported for side effect from the desktop client entry (it is deleted now).
- The `ui/editor` entrypoint still exports only the theme watcher, the theme, and the language
  mapper — if it grew exports, the migration surface grew.
- The features `EditorPane.tsx` uses are still the list in [01-survey.md](./01-survey.md); anything
  new added since 2026-08-31 needs a CodeMirror answer before the cut.
