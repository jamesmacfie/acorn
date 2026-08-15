# editor → loaded plugin, with find-in-files folded in

**Blocked on ONE thing, and it is now a build rather than a question.** A Monaco frame cannot be served
(measured below), and the answer on the record is the host-owned document surface
(`docs/third-party/monaco.md`): the host owns one editor and lends it through a vendor-neutral contract, and
this plugin contributes the file tree, tabs and search panel around a document region the host draws.

**That contract is finished and has a real consumer.** `database` moved over it
([README.md § database has moved](./README.md)), which built the composed template `document-over-frame`, the host
splitter, the `bridge.document` read/write/flush API, the flush-before-action guarantee, surface-action
delivery and the completions capability. Its frame bundle is 156 KB where a bundled Monaco measured
7.93 MiB, and its ⌘Enter still runs the query. So the parts of the contract that are *shared* are proven
by a shipping plugin; what this plugin still waits on is only the part that is *its own*:

- **its template** — `frame-beside-document`, or host-drawn tabs fed by a document-list route. Adding an
  enum entry and a second composed component is now a known quantity, because `DocumentOverFrame.tsx`
  exists to copy. What is NOT known is whether tabs belong to the host or the plugin, and that is the
  actual decision this move has to make.
- **the open-document verb** ⌘P needs. `bridge.document` is deliberately single-document: nothing in
  read/write/flush can point the host's editor at a different file. Database never needed it, so it was
  not built — the fourth method (`document.open(uri)`) or the host-drawn-tabs alternative is step 7's.

Keybindings were never a blocker — plugins declare them in the manifest and frames forward unclaimed
chords (`docs/command-palette-and-shortcuts.md`) — and surface-scoped chords inside the host's editor
now work too, which is the mechanism ⌘S and Monaco's own chords would ride.

The other three items on this brief are **done**, and none of them waited on the tier move:

- **Find-in-files is folded in.** It is a panel in the editor pane's sidebar rather than a pane of its
  own; the ripgrep route, runner and offset conversion are untouched. `⌘⇧F` and a "Find in files…"
  palette row open the editor pane with the panel focused, through a retained `editor:search` pane
  intent, so the entry point survived. Tree and panel stay mounted together, so flipping between them
  keeps the query, the results and the tree's open folders. Written up in `docs/panes.md`.
- **The `overlay` slot has a manifest form.** It is a frame TARGET, not a slot descriptor:
  `{ "target": "overlay", "id": "files", "label": "Go to file" }`, opened by the new `openOverlay`
  verb and by nothing else, with the host drawing the backdrop, the box and the dismiss affordance. A
  declared overlay that no action opens is a parse error. `acorn.ui.close()` — previously importer-only
  — is how a picker gets out of the way once it has picked. This unblocks any plugin that wants a
  full-screen picker, which was always the reason to do it separately from this move
  (`docs/plugins.md` § Frame contribution kind).
- **`persistedState` is decided: no manifest form, ever.** A slice is a codec plus a binding to shell
  signals that the host hydrates before first paint and clears on scope eviction — none of which crosses
  a port. The tier's answer is the frame's `state.get`/`state.set` into its own `plugin:<id>:*`
  namespace, which is the same store the Node half's `prefs` facet reads. The cost is named in
  `docs/plugins.md`: the frame reads its own state on mount instead of being hydrated, and clears its own
  keys instead of the host doing it. That is why the open-file tabs cannot move as they are.

## Monaco in a frame: measured

Built with exactly the settings `build-plugin.mjs` uses for a client bundle (browser target, es2022,
`minify: false`, single entry), from `import * as monaco from 'monaco-editor'` at 0.55.1 plus Solid,
the frame SDK and four UI-kit primitives — a stub, with no file tree, no tabs, no search panel and no
result grid:

| | |
| --- | --- |
| `client.js`, codicon font inlined | **7.58 MiB** |
| Monaco's stylesheet, emitted as a separate asset | 0.35 MiB |
| **single-file total a frame would have to serve** | **7.93 MiB** against an 8.00 MiB cap — 70 KiB spare |
| language-service workers (`ts`, `css`, `html`, `json`) | 14.58 MiB, in four more files |

Two independent findings, and the second is the one that settles it.

**It does not fit.** 70 KiB of headroom, before any editor UI exists, is not a budget — the file tree,
tabs, the folded-in search panel and the diff rows all still have to go in there, and the 0.35 MiB
stylesheet needs an inliner the builder does not have. Inlining the codicon font also needs a host CSP
change (`font-src 'self'` does not allow `data:`).

**The workers cannot be delivered at all**, which is architectural rather than budgetary. An
`app-plugin://<hash>` origin serves exactly two things: `/client.js` and the host's own `/ui.css`
(`apps/desktop/src/app/main/pluginScheme.ts` — "one bundle per plugin, one file per bundle"). There is
no `/assets/*`, so the four worker chunks have nowhere to be served from; and the frame CSP has no
`worker-src` at all, so `default-src 'none'` denies workers including `blob:`. The shell's own CSP has
`worker-src 'self' blob:` precisely because Monaco needs it. So a Monaco frame would run with no
language services — no TypeScript, JSON, CSS or HTML diagnostics or completions — which for an editor
is not a degraded mode, it is a different product.

**This is the finding, and it is worth more than the migration.** It is the first evidence of a
surface class the sandbox does not serve: not "a pane that would feel slow", but one whose *runtime
requirements* the single-file, no-workers frame contract cannot express. Raising the cap does not fix
it. Two ways out, and they are not equivalent. Multi-file plugin origins plus `worker-src` in the frame
CSP is a standing grant to every installed plugin. A **host-owned document surface** — the app owning one
editor and lending it through a vendor-neutral contract — widens nothing and costs no plugin a duplicated
7.9 MiB. That is the direction on the record, and it is now a full design with a build sequence:
`docs/third-party/monaco.md`, including the composed-pane decision (region-addressed templates), the bridge
document API, and the completions capability. This plugin is the template's whole-pane consumer and the
first one the contract should be built against.

Until then editor stays first-party, and the honest reason is written down rather than rediscovered.
Database no longer does: it moved over that surface and built most of it
([README.md § database has moved](./README.md)). Everything below this section is the original brief, kept for the parts
of it the move still has to do; the three items resolved above are marked where they appear.

## What has changed since this was written

This brief predates the rollbar migration. Both of its vague blockers were made concrete, and both have
since been answered.

- **The component slot** ANSWERED — a frame `target: "overlay"`, opened by the `openOverlay` verb; see
  the top of this file. What it was: `plugins/editor/src/client/index.ts` registers
  `{ id: 'palette.files', slot: 'overlay', order: 20, requires: 'desktop', component: FilePalette }`
  and the manifest's `slotDescriptor` accepted `slot: 'footer'` and nothing else. The answer was not to
  widen that descriptor — a badge descriptor is DATA the host draws, and a picker is a rectangle with a
  plugin's own UI in it — so `overlay` became a frame target beside `refPanel`, for the same reason
  `refPanel` is one.
- **`persistedState`** ANSWERED — no manifest form, ever, and the frame's `state.get`/`state.set` is the
  tier's store; see the top of this file and `docs/plugins.md`. It means the open-files list stops being
  a shell-persisted slice: the frame reads it on mount rather than being hydrated before first paint.
- **The Monaco bundle has a hard ceiling.** ANSWERED — see the section above; it does not fit, and the
  workers cannot be served regardless. The question was: client bundles are capped at 8 MiB
  (`MAX_CLIENT_BUNDLE_BYTES` in `packages/node-core/src/main/pluginLoader.ts`, enforced again in
  `apps/desktop/src/app/main/pluginCache.ts`), and `build-plugin.mjs` builds client bundles with
  `minify: false`.
- **`rollbar.md` no longer exists.** It was cleared along with these four when `docs/third-party/`
  became the review record. The reference is now [README.md](./README.md) plus `plugins/rollbar/`.
- **A plugin package holds no `acorn-plugin.json`.** The manifest is *generated* by
  `apps/node/scripts/build-plugin.mjs` from the plugin's own `acorn-plugin.config.mjs`.
- **The route carrier has a reference implementation**: `plugins/rollbar/src/server/routes/rollbar.ts`.
  Keep the Hono router and wrap it in `portableCarrier('<id>')` from `@acorn/plugin-api/node`, which
  owns both halves of carrying the `PluginRequestContext` in through `c.env`.

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

So editor's actual blockers were the component slot, the `persistedState` slice, and the
Monaco-in-a-frame question. Two are now answered; only Monaco remains.

## Find-in-files: what it is, and what it is not — DONE

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

### What it cost, now that it is done

- **Search without the editor open** was the real risk, and it is handled: `⌘⇧F` and the "Find in
  files…" palette row are a plugin command that opens the editor pane carrying an `editor:search` pane
  intent, so one gesture still gets you from anywhere to a focused query box. The intent is retained,
  which is what makes it work when the pane is opening for the first time.
- **Result → file navigation** deliberately stayed on `requestEditorReveal` and the `editor:reveal`
  intent rather than becoming a callback prop. The reveal path is one code path whether the request came
  from this pane or another one, and the panel does not have to know how the pane swaps Monaco models.
  There is no search-result deep link to check — nothing addressed a hit by URL.
- **Both sidebar tabs stay mounted**, hidden rather than unmounted, so a query and its results survive
  flipping to Files and back. That is the one thing a naive `<Show>` swap would have got wrong.
- **The fold happened while still first-party**, as planned: a UI refactor with a testable before/after,
  so a regression here has one possible cause rather than two.

## The plugin move

| Piece | Where | Becomes |
| --- | --- | --- |
| Worktree read/write/list routes | `server/routes/` | `ctx.routes.fetch` |
| Find-in-files route | `server/routes/search.ts` | Unchanged, same fetch handler |
| ripgrep runner | `main/search.ts` | Stays node-side; it is not Electron code despite the directory name |
| Editor pane (Monaco, tree, tabs) | `client/` | `frame` pane |
| Search panel | `client/search/` | Already a panel in the pane; it travels with the frame |
| Component slot | `client/index.ts` | A `target: "overlay"` frame surface — see "The slot" below |
| `editorFilesRoute` for @-mentions | `contract/api.ts` | Unchanged — a route string, not an import of behaviour |
| Open-files / view-state / tree-open slices | `client/*State.ts` | Bridge `state.get`/`state.set`, or frame-local |
| `ctx.persistedState.register(editorOpenFilesSlice)` | `client/index.ts` | No manifest form — see above |

### The slot — DONE

Editor registers `{ id: 'palette.files', slot: 'overlay', order: 20, requires: 'desktop', component:
FilePalette }` into `ctx.slots`, and the manifest's slot descriptor accepted `footer` and nothing else.
The carrier now exists, and it is a frame TARGET rather than a widened slot descriptor: a `slots` entry
is DATA the host draws (a badge from a route), and a file picker is a rectangle with the plugin's own UI
in it. So ⌘P ports as

```json
{ "target": "overlay", "id": "files", "label": "Go to file" }
```

plus a command with `{ "verb": "openOverlay", "overlay": "files" }` and a `meta+p` keybinding. The host
draws the backdrop, the box, the title and the close button; the frame draws the input and the list, and
calls `acorn.ui.close()` when a file is picked. What it still needs from the move itself is the way back:
the picked path has to reach the editor pane, and the bridge's `openPane` verb carries no payload today
(the compiled palette writes `editorState` directly). Under the document surface that is the surface's
open-document call; before it, it is one more thing the pane and the palette would have to share.

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

1. ~~Measure an unminified Monaco frame bundle against the 8 MiB cap.~~ **Done, and the answer is no**
   (top of this file). Steps 4–6 are moot until the frame contract can serve more than one file.
2. ~~Fold search into the editor pane, still first-party.~~ **Done** — a sidebar panel beside the file
   tree, with `⌘⇧F` and a palette row opening the pane on it. Needs a person in front of the running
   app to confirm (see README's verification list); `pnpm test` cannot render a Solid component here.
3. ~~Resolve the `overlay` slot question and the `persistedState` slice.~~ **Done** — `overlay` is a
   frame target with the `openOverlay` verb, and `persistedState` gets no manifest form on purpose.
   Both are written up at the top of this file and in `docs/plugins.md`.
4. ~~Spike Monaco in a frame.~~ Answered by step 1: it renders without language services, or not at all.
5. ~~Settle `claimsKeys`.~~ Nothing to settle until there is a frame — and under the document surface,
   Monaco's own chords (`⌘F` within the document) become the host's problem, not this plugin's.
6. **Then the move, over the document surface.** The contract has shipped and database is running on it
   (steps 1–6 of monaco.md's sequence), so this is the only step left and it is a build. Two shape
   questions belong to this plugin and nothing else can settle them: its template
   (`frame-beside-document` vs host-drawn tabs fed by a document-list route — the file tree, tab bar and
   search panel are regions the plugin draws, and they cannot wrap *around* host content), and the
   open-document verb, which database never needed and so does not exist. Open-files and view state land
   where the table above and monaco.md already decided (bridge state and host-owned view state
   respectively). Read database's outcome record first: the three things that came out differently there
   — a command still needing an action verb, the chord being unresolvable by the window dispatcher, and
   modals being confined to their region — apply to this move unchanged.

## Done when

Editor installed as a loaded plugin, editing and saving files, find-in-files working inside the
pane against the unchanged ripgrep route, @-mentions in agents still completing paths, and its
keybindings working — including a shell chord pressed while the editor has focus.
