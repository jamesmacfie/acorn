# editor → loaded plugin, with find-in-files folded in

**Blockers: two manifest gaps and a measurement.** Keybindings are no longer one — plugins declare
them in the manifest and frames forward unclaimed chords
(`docs/command-palette-and-shortcuts.md`).

## What has changed since this was written

This brief predates the rollbar migration. Both of its vague blockers are now concrete.

- **The component slot is a named gap, not an open question.**
  `plugins/editor/src/client/index.ts` registers
  `{ id: 'palette.files', slot: 'overlay', order: 20, requires: 'desktop', component: FilePalette }`
  — and the manifest's `slotDescriptor` accepts `slot: 'footer'` and nothing else. So this is not
  "check what it is before planning the move"; it is a decision to make about `overlay` before the
  move can start. The ⌘P file palette is a full-screen overlay picker, which is a rectangle the host
  places, so a frame could in principle host it — but no manifest form for that slot exists today.
- **`persistedState` is the second gap.** The same `init` calls
  `ctx.persistedState.register(editorOpenFilesSlice)`, which likewise has no manifest form. The table
  below already lists the state slices as "bridge `state.get`/`state.set`, or frame-local"; that is
  the answer, and it means the open-files list stops being a shell-persisted slice. Decide that
  deliberately rather than discovering it at cutover.
- **The Monaco bundle has a hard ceiling.** Client bundles are capped at 8 MiB
  (`MAX_CLIENT_BUNDLE_BYTES` in `packages/node-core/src/main/pluginLoader.ts`, enforced again in
  `apps/desktop/src/app/main/pluginCache.ts`), and `build-plugin.mjs` builds client bundles with
  `minify: false`. Monaco's ESM tree is 30 MB on disk. Whether an unminified Monaco frame fits under
  8 MiB is unanswered, and it is the cheapest question here to answer first — before the workers
  question, before the slot question, before any UI moves. It gates
  [database.md](./database.md) too: that plugin depends on `monaco-editor` as well.
- **`rollbar.md` no longer exists.** It was cleared along with these four when `docs/third-party/`
  became the review record. The reference is now [README.md](./README.md) plus `plugins/rollbar/`.
- **A plugin package holds no `acorn-plugin.json`.** The manifest is *generated* by
  `apps/node/scripts/build-plugin.mjs` from its `PLUGINS` table.
- **The route carrier has a reference implementation**: `plugins/rollbar/src/server/routes/rollbar.ts`.
  Keep the Hono router, hand `router.fetch` over, and carry the `PluginRequestContext` in through
  `c.env` behind a module-level symbol.

Read [README.md](./README.md) for the common mechanics.

Two changes bundled in one file because they are better done together: the editor becomes a loaded
plugin, and find-in-files stops being its own rail surface and becomes part of the editor pane.

## Correcting the record first

`docs/first-party-plugins.md` lists editor under "first-party for one specific reason", citing
`EDITOR` and `SEARCH` as "consumed elsewhere". **Checked: nothing outside `plugins/editor`
consumes either.** They are internal route capabilities, the same shape as database's `DATABASE`.

The only real cross-plugin edge is `plugins/agents/src/client/AgentMentionTextarea.tsx` importing
`editorFilesRoute` from `plugins/editor/src/contract/api.ts` to complete a path in an @-mention —
which is `contract/`, the sanctioned mechanism, and survives the move untouched.

So editor's actual blockers are the component slot, the `persistedState` slice, and the
Monaco-in-a-frame question. That makes it a better candidate than the table implies, and a harder one
than rollbar.

## Find-in-files: what it is, and what it is not

The current find-in-files is **199 lines** and is already the architecture VS Code uses:

| File | Lines | What |
| --- | --- | --- |
| `server/routes/search.ts` | 42 | `POST /v2/p/editor/tasks/:id/search` |
| `main/search.ts` | 128 | resolves the task worktree, runs **ripgrep**, parses byte offsets |
| `shared/search.ts` | 29 | converts ripgrep's UTF-8 byte offsets to Monaco positions |

**Monaco does not include find-in-all-files, and never will.** Monaco is the editor component: one
text model, `Ctrl+F` within it. VS Code's global search is workbench code — a separate UI backed by
a ripgrep subprocess — because Monaco has no filesystem and no process access. There is no fuller
Monaco that brings search along.

So this move deletes nothing. The 199 lines stay exactly where they are, including the two fixed
gotchas worth not rediscovering: ripgrep via `execFile` hangs without an explicit path argument
(`.`), and its `./` result prefix has to be stripped.

What changes is **where the results are shown**: the search pane stops being its own rail entry and
becomes a panel inside the editor pane, the way VS Code's sidebar works. That is a frontend
relocation of a results list plus a query box, against an unchanged route.

### Why fold it in anyway

- One surface instead of two for the same mental model ("find something in this project, open it").
- A result click already opens a file in the editor; today that is a cross-pane hop, and after the
  move it is a selection inside one pane.
- The editor pane owns the file tree, so search results and the tree share one navigation model.

### What to be careful about

- **Search without the editor open.** Today the search pane stands alone. After the fold, finding
  something means opening the editor first. Keep a palette row ("Find in files…") that opens the
  editor pane with the search panel focused, so the entry point survives.
- **Result → file navigation.** Inside one pane this becomes internal state rather than a
  `plugin:select` intent. Simpler, but check the deep-link path (a search result URL, if any) still
  works.
- **Do the fold while still first-party.** It is a UI refactor with a testable before/after, and
  mixing it into the tier move means a regression has two possible causes.

## The plugin move

| Piece | Where | Becomes |
| --- | --- | --- |
| Worktree read/write/list routes | `server/routes/` | `ctx.routes.fetch` |
| Find-in-files route | `server/routes/search.ts` | Unchanged, same fetch handler |
| ripgrep runner | `main/search.ts` | Stays node-side; it is not Electron code despite the directory name |
| Editor pane (Monaco, tree, tabs) | `client/` | `frame` pane |
| Search pane | `client/` | Panel inside the editor frame |
| Component slot | `client/index.ts` | See "The slot" below |
| `editorFilesRoute` for @-mentions | `contract/api.ts` | Unchanged — a route string, not an import of behaviour |
| Open-files / view-state / tree-open slices | `client/*State.ts` | Bridge `state.get`/`state.set`, or frame-local |
| `ctx.persistedState.register(editorOpenFilesSlice)` | `client/index.ts` | No manifest form — see above |

### The slot

Editor registers `{ id: 'palette.files', slot: 'overlay', order: 20, requires: 'desktop', component:
FilePalette }` into `ctx.slots`. The manifest's slot descriptor accepts `footer` and nothing else, so
there is no carrier for this today. It is not reason B — a full-screen overlay picker is a rectangle
the host places, the same argument that makes `refPanel` a frame target — but it needs either an
`overlay` slot form in the manifest or a redesign of ⌘P into something a pane owns. Resolve it before
anything else moves.

### Monaco in a frame

The frame bundles its own Monaco. That is fine — it is self-contained by design, which suits an
iframe better than most libraries — but know the costs before committing:

- **Bundle size.** Monaco is large, and there is a hard cap: 8 MiB per client bundle
  (`MAX_CLIENT_BUNDLE_BYTES`), enforced by the node and again by Electron main, with
  `build-plugin.mjs` producing unminified client bundles. Monaco's ESM tree is 30 MB on disk. The
  bundle is content-addressed and cached per hash, so *if* it fits the cost is one-time per version —
  but whether it fits at all is the first thing to measure.
- **`monacoSetup`.** The app currently assigns `self.MonacoEnvironment` once at boot
  (`client-core/src/editor/monacoSetup.ts`) because two panes racing to set it was a real bug.
  Inside a frame the plugin owns its own global, which actually removes that race.
- **Workers.** Monaco spawns web workers for language services. Check they load under the frame
  CSP (`script-src 'self'` on `app-plugin://<hash>`); worker sources must be same-origin, which
  they will be if bundled, but this is the most likely thing to break and worth proving first with
  a spike before porting any UI.

### Keybindings

An editor is the plugin that most wants keys, and until recently loaded plugins could not bind any
— nor could a frame receive shell chords or deliver its own, because keydown inside an iframe does
not bubble to the parent window.

Both halves now work: the manifest declares `commands` and `keybindings`, and the frame SDK
forwards any chord it has not claimed to the shell dispatcher, so `⌘P` still opens the file finder
while the editor has focus. What the editor has to get right is its `claimsKeys` list — Monaco's
`⌘F` belongs to the frame, and the reserved set (`escape`, `⌘K`, `⌘,`, `⌘1`–`9`) can never be
claimed. `docs/keybindings/` was folded into
[command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md); read that for the current
forwarder contract.

## Sequence

1. Measure an unminified Monaco frame bundle against the 8 MiB cap. Cheapest question, and if the
   answer is no, everything after it is moot for both editor and database.
2. Fold search into the editor pane, still first-party. Ship it, live with it.
3. Resolve the `overlay` slot question and the `persistedState` slice.
4. Spike Monaco in a frame: does it render, do workers load, how does it feel to type in.
5. Settle `claimsKeys` against the frame forwarder
   ([command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md)).
6. Then the move, per rollbar's sequence.

## Done when

Editor installed as a loaded plugin, editing and saving files, find-in-files working inside the
pane against the unchanged ripgrep route, @-mentions in agents still completing paths, and its
keybindings working — including a shell chord pressed while the editor has focus.
