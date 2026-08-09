# editor → loaded plugin, with find-in-files folded in

**Blockers: keybindings have no manifest form** ([docs/keybindings/](../keybindings/)), and the
frame-performance question [database.md](./database.md) raises applies here too. Read
[rollbar.md](./rollbar.md) for the common mechanics.

Two changes bundled in one file because they are better done together: the editor becomes a loaded
plugin, and find-in-files stops being its own rail surface and becomes part of the editor pane.

## Correcting the record first

`docs/first-party-plugins.md` lists editor under "first-party for one specific reason", citing
`EDITOR` and `SEARCH` as "consumed elsewhere". **Checked: nothing outside `plugins/editor`
consumes either.** They are internal route capabilities, the same shape as database's `DATABASE`.

The only real cross-plugin edge is `plugins/agents/src/client/AgentMentionTextarea.tsx` importing
`editorFilesRoute` from `plugins/editor/src/contract/api.ts` to complete a path in an @-mention —
which is `contract/`, the sanctioned mechanism, and survives the move untouched.

So editor's actual blockers are keybindings and the Monaco-in-a-frame question. That makes it a
better candidate than the table implies, and a harder one than rollbar.

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

### The slot

Editor registers a component into `ctx.slots`. Check what it is before planning the move: if it is
chrome that could be a descriptor badge, it converts; if it is a real component in the shell's
tree, that is reason B and the move stops there until it is redesigned. This is the one item that
could block the whole thing, so resolve it first.

### Monaco in a frame

The frame bundles its own Monaco. That is fine — it is self-contained by design, which suits an
iframe better than most libraries — but know the costs before committing:

- **Bundle size.** Monaco is large. The bundle is content-addressed and cached per hash, so it is
  a one-time cost per version, not per open.
- **`monacoSetup`.** The app currently assigns `self.MonacoEnvironment` once at boot
  (`client-core/src/editor/monacoSetup.ts`) because two panes racing to set it was a real bug.
  Inside a frame the plugin owns its own global, which actually removes that race.
- **Workers.** Monaco spawns web workers for language services. Check they load under the frame
  CSP (`script-src 'self'` on `app-plugin://<hash>`); worker sources must be same-origin, which
  they will be if bundled, but this is the most likely thing to break and worth proving first with
  a spike before porting any UI.

### Keybindings, the actual blocker

An editor is the plugin that most wants keys, and loaded plugins cannot bind any. Worse, a frame
does not receive shell chords and its own keydowns do not reach the shell dispatcher, because
keydown inside an iframe does not bubble to the parent window.

Both halves are [docs/keybindings/](../keybindings/) — phases 0–2 for declaring bindings, phase 3
for the frame boundary specifically. **Do not start the editor move before that project lands**;
an editor whose `⌘P` does nothing while focused is not a port, it is a regression.

## Sequence

1. Fold search into the editor pane, still first-party. Ship it, live with it.
2. Resolve the slot question.
3. Spike Monaco in a frame: does it render, do workers load, how does it feel to type in.
4. Wait for [docs/keybindings/](../keybindings/) phases 0–3.
5. Then the move, per rollbar's sequence.

## Done when

Editor installed as a loaded plugin, editing and saving files, find-in-files working inside the
pane against the unchanged ripgrep route, @-mentions in agents still completing paths, and its
keybindings working — including a shell chord pressed while the editor has focus.
