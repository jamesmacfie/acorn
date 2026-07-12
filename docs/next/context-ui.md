# Agent context UX — Manifest + Notes rework

**Status:** implemented; lint + `pnpm test` green. **Phase 5 (promote-to-memory) was subsequently
removed** — the `◆ promote` button, the `memory:prefill` pane intent, and the `MemorySection` `draft`
prop are gone; the manual "+ memory" form remains. Manual Electron QA per the per-phase _Verify_
steps still pending.
**Owner:** _unassigned_
**Scope:** `apps/desktop/src/plugins/context/client/`, `apps/desktop/src/plugins/notes/`,
`apps/desktop/src/plugins/memory/` (client + small server/main additions), plus small additive
changes to `core/shared/api.ts`, `core/shared/notes.ts`, `core/client/registries/clientEvents.ts`,
`core/client/persistence/`, and `app/main/contextSectionsWiring.ts`.

## Goal

Two panes with a clean division of labour, linked both ways:

- **Manifest** (the reworked Context pane, id `context`, ⌘⇧X) — *what the agent gets*: per-section
  selection that **persists per task**, live size + budget bars, first-class memory (index +
  proposals inline, no more tray buried at the pane bottom), an always-visible **preview of the
  exact assembled block**, an explicit **session target picker**, and a **staleness signal** with a
  Sync button.
- **Notes** (the reworked Notes pane, id `notes`, ⌘⇧D) — *where you write and organise it*:
  opens straight into a per-task **scratchpad** (auto-created lazily on first keystroke), with a
  library column grouped by scope (Task / Workspace / Global), agent/seeded notes badged in place,
  per-group create, a filter box, an include-in-context toggle, and **promote to memory**.

The contract between the panes is the note `included` bit (which the context assembler already
reads) plus two new pane intents (`context:reveal`, `memory:prefill`) alongside the existing
`notes:open`.

Pain points this fixes: no single "what does my agent know" view; no preview before send;
selection resets on task switch; sends blindly target `agentSessionsFor(taskId)[0]`; memory is
undiscoverable (no pane, tray-only); context silently drifts after a send with nothing saying
"your agent is stale".

**Out of scope:** anything requiring plugin contributions to the terminal chrome / task bar (the
"tray docked to the agent session" direction — no contribution point exists for it), and the
@-mention prompt composer. Neither is blocked by this work.

## Current state (what we're replacing)

### `plugins/context/client/ContextPane.tsx` (~133 lines)

- Fetches the full inventory once per task: `createResource` on `taskContextRoute(id, 'all')`
  (`include=*`).
- Selection is an **ephemeral** `TraySelection = Record<sectionId, boolean>` signal, re-seeded
  from `selectionFromContext(ctx)` whenever the task changes — a curated selection is lost on
  every task switch.
- `assembleAndSend()` does a **second curated fetch** (`taskContextRoute(id, include)`), formats
  with `formatContextBlock`, and sends to `agentSessionsFor(props.task.id)[0]` — the most-recent
  running agent session, with no picker and no preview of the text.
- `<MemoryTray task onChanged={refetch} />` is bolted onto the bottom of the pane — the only
  memory management surface in the app.
- `followJump(item)` produces `notes:open` / `integration:show-ref` intents (kept as-is).

### `plugins/notes/client/NotesPane.tsx` (~280 lines)

- Four collapsible groups: **Task notes**, user workspace notes, **Global notes**, **Agent notes**
  (workspace notes with `author !== 'user'`).
- Creation is a form at the bottom: title input + scope `<select>`; humans always create kind
  `scratch`.
- Editor is a textarea with `debounce(save, 1500)` autosave, flush on blur/switch/cleanup, and a
  Preview toggle rendering via the hand-rolled sanitized `renderMarkdown`
  (`core/client/integrations/markdown.ts`).
- Include is a per-row checkbox → `api.setIncluded(location, slug, included)`; global rows lack it.
- Consumes `notes:open` pane intents (subscription + `consumePaneIntent` drain — the mount-order
  race pattern).

### `plugins/memory/client/MemoryTray.tsx` (~131 lines)

- Pending-proposal list (accept / inline description edit / reject via
  `resolveProposal(id, approved, edited?)`; verification `flags` render as ⚠ badges) plus a manual
  add form (name/type/scope/description/body → `memoryApi().add`).
- Not a pane; reachable only through the Context pane.

### Assembly (unchanged foundation)

`core/server/agentTools/contextSections.ts` holds the section registry (pr / issues / notes /
memory), **byte-based** budgets (`ContextBudget { maxItems, maxBytesPerItem, overflow }`,
`truncateBytes` via `Buffer.byteLength`), `parseInclude` (`'*'` → all; empty → default-included;
csv → those ids), and `assembleContext`. `core/shared/contextBlock.ts` `formatContextBlock(ctx)`
emits `# Task: {title} ({repo} · {branch})` followed by each section's server-computed `compact`.

**Key verified invariant this design leans on:** a section's `compact` is computed independently
of which *other* sections are included. Therefore the client can assemble the send block locally
from the `include=*` inventory by filtering `ctx.sections` and calling `formatContextBlock` — which
collapses today's second curated fetch and makes the preview **byte-exact** for what gets sent.
(Add a comment stating this invariant in `contextSections.ts` so a future section author doesn't
break it silently.)

## Target design

### Manifest pane

```
┌ context ── 4 sections · 14 items ── msg ────────────────────┐
│ ☑ Pull request                            1.9 KB · ~480 tok │
│   ▂▂▂▂▂▂▂▂▂▂▂▂░░░░░░  (budget bar)                          │
│     ▸ PR #41 …                                              │
│ ☑ Notes                                   3.2 KB · ~800 tok │
│     ▸ Scratchpad          ◆ task                        ✎   │
│     ▸ api findings        🤖 · ws                       ✎   │
│     ▸ pr-description      seed · task                   ✎   │
│ ☐ Linked issues   ⚠ 1 missing cached detail                 │
│ ☑ Repo memory · 2 pending                          0.4 KB   │
│     index entries …                                          │
│     ⚠ proposal: rollbar-payload-shape  [accept][desc][rej]  │
│     + memory (manual add form)                               │
├─ preview ▸  # Task: … · total 5.5 KB · ~1.4k tok ───────────┤
│ [agent session ▾ ●]   stale · 2 changes      [Sync context] │
└──────────────────────────────────────────────────────────────┘
```

- Section rows keep the checkbox, `+N omitted`, and `⚠ absent` affordances, and gain a **size**
  (`bytesOf(section.compact)`, rendered `2.1 KB · ~530 tok`) and a 2px **budget bar**.
- Notes items gain **provenance badges** (🤖 agent / `seed` workflow) and a scope pill; the
  existing ✎ deep-link to the Notes pane stays.
- The **memory section** hosts the (renamed) `MemorySection` component inline: index entries,
  pending proposals with accept / description-edit / reject, and the manual add form. Pending
  count surfaces on the section row.
- The **preview strip** is always visible collapsed (`preview ▸ · 5.5 KB · ~1.4k tok`) and expands
  to a `<pre>` of the exact `formatContextBlock` output for the current selection.
- The **footer** holds the session target `Picker`, the per-session staleness pill, and
  **Sync context** (the existing send flow, now targeted and recorded).

### Notes pane

```
┌ Notes — acme ────────────────────────────────────────────────┐
│ ⟨filter…⟩      ◀ │ Scratchpad             ◆ task   [incl ✓]  │
│ ── Task (2) ── + │ ◆ promote    Preview     saved ·          │
│ ● Scratchpad     │───────────────────────────────────────────│
│ ● repro steps    │                                            │
│ ── Workspace ─ + │  (textarea / markdown preview)             │
│ ○ api notes   🤖 │                                            │
│ ● pr-42     seed │                                            │
│ ── Global ──── + │───────────────────────────────────────────│
│ ● conventions 🌐 │ 1.2 KB · ~300 tok       view in Context → │
└──────────────────┴────────────────────────────────────────────┘
```

- **Scratchpad-first**: with no pending intent and no remembered selection, the pane lands in this
  task's scratchpad — a *virtual* note (editor open, no file) until the first keystroke creates it.
- **Library column** (fixed 230px, collapsible via ◀): three groups — Task (scratchpad pinned
  first) / Workspace (all workspace notes, user and agent together, badged in place) / Global.
  Each group header has a **+** that creates a note *in that scope*. A filter box above the groups
  matches title + slug across all three.
- **Include** is a dot-button per row (filled `--add-marker` when included) and a toggle in the
  editor header — both flip the same `included` bit the assembler reads.
- **Editor header**: title input (rename; slug stays stable), scope pill, include toggle,
  **◆ promote** (→ Manifest with a prefilled memory form), Preview toggle, `saving… / saved ·`.
- **Footer**: size of this note + **view in Context →** (jumps to this note's row in the Manifest).

### State model

1. **Manifest section selection — persisted per task** as a real `PersistedStateSlice`
   (`scope: 'task'`), *not* a `jsonObject` app pref keyed by taskId — unbounded
   `Record<taskId, …>` prefs are exactly what the scoped-slice machinery replaced (see the comment
   in `core/client/persistence/prefKeys.ts`). Scoped slices get per-task storage keys, byte caps,
   tombstones, and archive eviction for free.

   New module `plugins/context/client/selectionState.ts`, mirroring
   `plugins/editor/client/editorState.ts`:

   ```ts
   const [contextSelections, setContextSelections] = createSignal<Record<string, TraySelection>>({})
   export const selectionFor = (taskId: string): TraySelection | undefined => contextSelections()[taskId]
   export function setSectionSelection(taskId: string, selection: TraySelection): void
   export function hydrateContextSelection(taskId: string, value: TraySelection): void // no-clobber
   export function evictContextSelection(taskId: string): void
   ```

   Slice (added to `persistedFeatureSlices` in `core/client/persistence/stateSlices.ts`):

   ```ts
   const contextSelectionSlice: PersistedStateSlice<TraySelection> = {
     id: 'context.section-selection',
     key: PersistedSliceKeys.contextSelection, // new PrefKeys entry: 'context:section-selection'
     scope: 'task',
     restore: 'panes',
     version: 1,
     codec: { parse: /* JSON.parse, keep boolean-valued entries, else {} */, serialize: (v) => v },
     empty: () => ({}),
     unknownIds: 'retain-inert',
     maxBytes: 4 * 1024,
     binding: { values: contextSelections, hydrate: hydrateContextSelection },
   }
   ```

   Semantics: the store holds only tasks the user has actually touched. Effective selection in the
   pane = `selectionFor(taskId) ?? selectionFromContext(ctx)`. A toggle writes the **full effective
   map** for that task, so later changes to a section's `defaultIncluded` don't silently flip a
   curated set. Eviction on `runtime:task-archived` via
   `core/client/persistence/scopedEviction.ts`.

2. **Staleness — session-only**, new module `plugins/context/client/syncState.ts`:

   ```ts
   type SyncRecord = { taskId: string; at: number; sections: Record<string /*sectionId*/, string /*compact as sent*/> }
   const lastSync = new Map<string /*sessionId*/, SyncRecord>()
   export function recordSync(sessionId: string, taskId: string, sections: Record<string, string>): void
   export function syncStatus(sessionId: string, current: Record<string, string>):
     | { kind: 'never' } | { kind: 'synced'; at: number } | { kind: 'stale'; at: number; changes: number }
   export function evictSyncState(taskId: string): void // wire into scopedEviction.ts
   ```

   No hashing — store the raw per-section compact strings (a few KB, session-only, one entry per
   live agent session). `changes` = sections whose compact differs, plus sections added to /
   removed from the current selected set relative to what was sent. Dead sessions become
   unreachable through the picker, so no exit hook is needed.

3. **Session target — session-only** `Map<taskId, sessionId>` (the `activeByTask` pattern from
   `plugins/terminal/client/sessions.ts`), validated against the live list:

   ```ts
   export function targetSessionFor(taskId: string): TerminalSession | undefined {
     const sessions = agentSessionsFor(taskId)
     return sessions.find((s) => s.id === targetByTask.get(taskId)) ?? sessions[0]
   }
   ```

4. **Notes pane view state — session-only**, new module
   `plugins/notes/client/notesPaneState.ts`: `selectedByTask: Map<taskId, { scope, slug }>` (return
   to the note you were on; fall back to scratchpad) and `libraryCollapsedByTask: Map<taskId,
   boolean>`. Evicted on task archive. Not persisted — matches the session-first house guidance;
   only the section selection has a stated durability requirement.

### Data hierarchy

The client shape stays `TaskContext → ContextSectionResult[] → ContextItem[]`, fetched once with
`include=*`. Additions:

- **`ContextItem.origin`** (`core/shared/api.ts`):

  ```ts
  origin?: { author: 'user' | 'agent' | 'workflow' } // notes section only, for provenance badges
  ```

  Badge mapping: `user` → none, `agent` → 🤖, `workflow` → `seed` (workflow-authored notes are the
  seeded PR/comment/ticket snapshots). Scope is *not* added — it's already recoverable from the
  notes item id (`${scope}:${slug}`) and `jump.noteScope`.

- **Scratchpad reserved slug**: `export const SCRATCHPAD_SLUG = 'scratchpad'` in
  `core/shared/notes.ts` (a cross-surface contract, so shared). Client-lazy creation only — the
  pane shows a virtual scratchpad; the first keystroke fires a **single-flight**
  `api.create({ scope: 'task', taskId }, 'Scratchpad', 'scratch')` (guarded by an in-flight
  promise), then routes the pending body through normal autosave. Before creating, adopt an
  existing `scratchpad` slug from the already-loaded task list. If `NotesStore.create` dedupes the
  slug (a user note happened to slugify to `scratchpad`), adopt the returned slug for the session —
  cosmetic edge, no correctness issue. An untouched scratchpad never creates a file.

- **Empty-note filter** (server): the notes source in `app/main/contextSectionsWiring.ts` skips
  `!note.body.trim()` rows. This covers *all* empty notes, not just scratchpads — an empty note
  contributes only a `### title` header of noise today.

### Sizes and budgets: bytes, not tokens

Budgets are bytes end-to-end and no tokenizer exists; none is added. All math is client-side in
`plugins/context/client/model.ts` (unit-tested in the existing `model.test.ts`):

```ts
export const bytesOf = (s: string) => new TextEncoder().encode(s).byteLength
export const approxTokens = (bytes: number) => Math.round(bytes / 4) // marked "~" in the UI
export const formatSize = (bytes: number) => string // "412 B" | "2.1 KB · ~530 tok"
export function sectionCap(budget: ContextBudget): number | null
// maxItems × maxBytesPerItem; null when maxBytesPerItem is absent (memory's index-only
// budget) — those sections show size text but no bar.
export function assembleBlockFrom(ctx: TaskContext, selection: TraySelection):
  { block: string; sections: Record<string, string> }
// filters ctx.sections by selection, block = formatContextBlock({ ...ctx, sections: picked }),
// sections = { [id]: compact } for staleness recording.
```

- **Per-section size** = `bytesOf(section.compact)` — the *actual* text that would be sent. Do not
  sum item bodies: section `format()` re-truncates internally (e.g. the PR body is hard-capped),
  so item-body sums overstate.
- **Budget bar** = `bytesOf(compact) / sectionCap(budget)`, clamped. The cap is a worst-case
  allowance, not a hard limit — the server truncates per-item, so a full bar means "near the
  truncation ceiling", nothing more. 2px flat bar: `--bg-selected` track, `--accent` fill,
  `--warn` fill ≥ 80%. Local CSS recipe — there is no shared progress primitive and this doesn't
  add one.
- **Preview total** = `bytesOf(block)` — byte-exact for what Sync sends.

## Concrete changes

### 1. `core/client/registries/clientEvents.ts`

Extend the `PaneIntent` union (no other plumbing changes — `openPane`/`consumePaneIntent` handle
arbitrary variants, and intents are retained until consumed):

```ts
export type PaneIntent =
  | { kind: 'notes:open'; slug: string; scope: NoteScope }
  | { kind: 'editor:reveal'; path: string; line: number }
  | { kind: 'integration:show-ref'; ref: ExternalRef }
  | { kind: 'context:reveal'; sectionId: string; itemId?: string }                        // new
  | { kind: 'memory:prefill'; draft: { name: string; description: string; body: string } } // new
```

Both new variants target pane `'context'`. Note the retained-intent map holds **one** intent per
`(taskId, paneId)` — `memory:prefill` therefore *implies* revealing the memory section (the
consumer does both); never send two intents.

### 2. `plugins/context/client/ContextPane.tsx` — the Manifest

1. **Selection**: delete the `selection`/`selectionTask` signals and the seeding effect. Replace
   with `effective = () => selectionFor(props.task.id) ?? (ctx() ? selectionFromContext(ctx()!) : {})`;
   `toggleSection` writes `setSectionSelection(taskId, { ...effective(), [id]: !effective()[id] })`.
2. **Section rows** gain `formatSize(bytesOf(section.compact))` and the budget bar
   (`sectionCap(section.budget)`); keep `+N omitted` and `⚠ absent`. Give each section and item
   row a `data-context-row` attribute (`section.id` / item row id) for intent scrolling.
3. **Notes items**: provenance badge from `item.origin?.author`, scope pill from
   `item.jump?.noteScope`. The ✎ deep-link (`requestNoteOpen`) is unchanged.
4. **Memory section**: render `<MemorySection task={props.task} draft={memoryDraft()}
   onChanged={() => void refetch()} />` inside the memory section body; delete the pane-bottom
   `<MemoryTray>`. Surface the pending count on the section row (`· 2 pending`).
5. **Preview strip**: `const assembled = createMemo(() => ctx() ? assembleBlockFrom(ctx()!, effective()) : null)`.
   Collapsed: one line with total size. Expanded: `<pre class="context-preview-block">{assembled().block}</pre>`.
6. **Footer**:
   - Session `Picker` (`core/client/ui/Picker.tsx` — portal-based, required because panes clip
     overflow) over `agentSessionsFor(props.task.id)`; row = session `title` + idle `●`
     (`--add-marker`); select → `rememberTarget(taskId, sessionId)`.
   - Stale pill from `syncStatus(target.id, assembled().sections)` — `not synced` / `synced · 2m` /
     `stale · N changes` (tooltip: "since last sync from this pane").
   - **Sync context**:

     ```ts
     async function syncContext() {
       const target = targetSessionFor(props.task.id)
       if (!target || !api) return setMsg('No running agent session.')
       await refetch() // fresh inventory, one fetch
       const { block, sections } = assembleBlockFrom(ctx()!, effective())
       const res = await api.sendToAgent(target.id, block, 'after-ready')
       if (res.ok) recordSync(target.id, props.task.id, sections)
       setMsg(res.ok ? (res.queued ? 'Queued — delivers when the agent is idle.' : 'Sent.') : res.reason ?? 'Send failed.')
     }
     ```

7. **Intent consumption** (mirror NotesPane's dual path: `clientEvents.on('presentation:pane-intent', …)`
   filtered to this task + `paneId === 'context'`, plus a `createEffect` draining
   `consumePaneIntent(taskId, 'context')`): `context:reveal` → ensure the section is expanded,
   expand the item row, `scrollIntoView` the `data-context-row` match; `memory:prefill` → set the
   `memoryDraft` signal (and reveal the memory section).

### 3. `plugins/memory/client/MemoryTray.tsx` → `MemorySection.tsx`

**Kept as a child component in the memory plugin, not dissolved** — it owns every `memoryApi()`
call, and dissolving it would drag the memory client API into the context plugin. Changes:

- Rename file + export to `MemorySection`.
- New optional prop `draft?: { name: string; description: string; body: string } | null` — when
  set, open the manual add form pre-filled (name/description/body; type default `convention`,
  scope default `repo`).
- Drop the standalone tray framing; it now renders under the memory section header.
- Proposals unchanged: accept / inline description edit / reject via
  `resolveProposal(id, approved, edited?)`. Body-edit-before-accept stays deferred — the API
  already supports `edited.body` when wanted.

### 4. `plugins/context/client/` — new modules + CSS

- `selectionState.ts`, `syncState.ts` as specified under **State model** (the target-session map
  can live in `syncState.ts`).
- `model.ts`: add `bytesOf` / `approxTokens` / `formatSize` / `sectionCap` / `assembleBlockFrom`
  (+ tests). Keep `selectionFromContext` / `traySummary`; **delete `selectionToInclude`** and its
  test — with local assembly, no send path builds an `include=` csv any more.
- `context-tray.css`: `.context-size` (muted, `tabular-nums`), `.context-bar` / `.context-bar-fill`,
  `.context-preview` strip + `.context-preview-block` (`<pre>`, mono, top rule), `.context-sync-row`
  footer, `.context-stale-pill` (999px pill, `--warn`), `.context-origin-badge`. All from tokens;
  status-dot recipe copied locally per convention (see `.checks-dot` in `pull-detail.css`).

### 5. `plugins/notes/client/NotesPane.tsx` — the Notes pane

1. **Landing effect** on `(props.task.id, taskList.state)`: if no pending/retained intent and no
   `selectedByTask` entry → select the scratchpad. Real note if `taskNotes()` contains
   `SCRATCHPAD_SLUG`; else virtual (`selected = { scope: 'task', slug: SCRATCHPAD_SLUG, virtual: true }`,
   empty body). First keystroke in virtual mode triggers the guarded lazy create (§ Data
   hierarchy), then normal autosave. The existing autosave discipline — `debounce(save, 1500)`,
   flush on blur/switch/cleanup, cancel on delete — is preserved verbatim.
2. **Library**: replace the four groups with **Task / Workspace / Global**. Task: scratchpad
   pinned first (rendered even when virtual), then task notes. Workspace: *all* of `wsList()`,
   user and agent together, badged in place (🤖 agent / `seed` workflow) — delete the
   `userNotes` / `agentNotes` split and the separate Agent group. Global: unchanged rows **plus
   the include dot** (global notes are context-eligible in the assembler; the affordance was
   simply missing).
3. **Per-group create**: a `+` on each group header → `api.create(locationFor(groupScope), 'Untitled')`,
   select it, focus the title input. Delete the bottom create form (title + scope select).
4. **Filter box** above the groups: case-insensitive substring over `title` + `slug`, applied
   client-side to all three lists.
5. **Include affordance**: replace the row checkbox with a dot-button (filled `--add-marker` when
   included, hollow muted otherwise) — same `toggleIncluded` handler.
6. **Editor header**: title `<input>` (debounced → new `api.setTitle`; the slug never changes, so
   deep links and seeded slugs stay stable), scope pill (◆ task / ws / 🌐), include toggle (same
   `setIncluded` bit; the row dot updates on refetch), **◆ promote** →
   `openPane(props.task.id, 'context', { kind: 'memory:prefill', draft: { name: slugified(title), description: title, body: body() } })`,
   Preview toggle (existing `renderMarkdown`), autosave state (`saving… / saved ·` from a small
   `dirty`/`saving` signal pair around `save()`).
7. **Footer**: `formatSize(bytesOf(body()))` (import the helpers from
   `plugins/context/client/model.ts` — client plugins already cross-import, e.g. ContextPane →
   `notesClient`) + **view in Context →** =
   `openPane(props.task.id, 'context', { kind: 'context:reveal', sectionId: 'notes', itemId: `${scope}:${slug}` })`
   (matches the notes section's item-id format exactly).
8. **Library collapse**: a ◀ toggle writing `libraryCollapsedByTask`;
   `.notes-body.library-collapsed .notes-list { display: none }`. List width goes from
   `clamp(180px, 16vw, 260px)` to a fixed `230px`.

`NotesTaskPane.tsx` (workspace resolution + pane contribution) is unchanged. Consider
`keepAlive: 'dom'` on the contribution so closing the pane never tears down mid-debounce — cheap
safety, but flush-on-cleanup alone is already correct; decide at implementation.

### 6. `plugins/notes/client/notesClient.ts` + `notes.css`

- Add `setTitle(location, slug, title)` to `NotesApi` → `POST noteTitleRoute(location, slug)`.
- CSS: filter row, group `+` buttons, include dots, header pills/toggle, autosave state, footer
  bar, `.library-collapsed`, badge styles.

### 7. Server / main changes (minimal, additive)

a) **Provenance + empty filter** — `core/shared/api.ts`: `ContextItem.origin` as above.
   `core/server/agentTools/contextSections.ts`: add `author: NoteAuthor` to the
   `ContextNotesSource` row type; the notes `assemble()` sets `origin`; add the local-assembly
   invariant comment. `app/main/contextSectionsWiring.ts`: pass `summary.author` through; skip
   empty bodies. Tests: `contextSectionsWiring.test.ts` (empty filtered, author present),
   `taskContext.test.ts` source stubs updated.

b) **Note title rename** — `core/shared/api.ts`: `noteTitleRoute(location, slug)` (sibling of
   `noteIncludedRoute`). `plugins/memory/server/routes/knowledge.ts`: `{ title: z.string().trim().min(1) }`
   body, POST `/workspaces/:wsId/notes/:slug/title` + `/tasks/:id/notes/:slug/title` (clones of
   the `/included` routes and their `includedBody` validation) → new
   `KnowledgeBridge.notesSetTitle`. `plugins/memory/main/knowledgeIpc.ts`: delegate (beside
   `notesSetIncluded`).
   `plugins/notes/main/notes.ts`: `NotesStore.setTitle(location, slug, title)` — a clone of
   `setIncluded` (read → `meta.title = title` → atomic write). Tests: `notes.test.ts`,
   `knowledge.test.ts`.

c) **`SCRATCHPAD_SLUG`** constant in `core/shared/notes.ts`. No store changes — creation is
   client-lazy and the empty-body filter handles context hygiene.

d) **Nothing else.** Staleness is client-only. Promote-to-memory reuses `memoryApi().add` —
   deliberately **no** client proposal-create API: proposals remain main-side `memoryGen`
   artifacts with their verification pass, and fabricating them client-side would bypass it.

## Affordances inventory

| State | Treatment | Source recipe / token |
| --- | --- | --- |
| Note included in context | filled dot `--add-marker`; hollow muted when excluded | `.checks-dot` recipe, copied locally |
| Stale vs session | pill `stale · N changes`, `--warn` text + border, 999px | house pill convention |
| Synced / never synced | muted text `synced · 2m` / `not synced` | `.muted` |
| Agent session idle | `●` after session title (Picker rows + sync button), `--add-marker` | existing ContextPane convention |
| Section absent / missing cache | `⚠ detail` muted line | existing `.context-tray-detail.muted` |
| Proposal verification flags | `⚠ flag` badges | existing `.context-tray-proposal-flag` |
| Note provenance | 🤖 (agent) / `seed` (workflow) badge; scope pill ◆ task / ws / 🌐 | existing NotesPane glyphs + new `.context-origin-badge` |
| Budget pressure | 2px bar, `--accent` fill → `--warn` ≥ 80% | new local recipe |
| Autosave | `saving… / saved ·` muted, right-aligned in editor header | `.muted` |
| Omitted items | `+N omitted` muted | existing, unchanged |

## Behaviour being removed / changed

- **Removed:** per-mount selection reset (selection now persists per task — a consequence:
  changing a section's `defaultIncluded` no longer affects tasks with a stored selection).
- **Removed:** the MemoryTray at the pane bottom (now inline in the memory section, renamed
  `MemorySection`).
- **Removed:** the Notes create form (title + scope select) and the separate "Agent notes" group
  (badged in place instead).
- **Removed:** the curated second fetch in send — the block is assembled client-side; `selectionToInclude` is deleted.
- **Changed:** global notes rows gain the include affordance they were missing.
- **Kept:** `include=*` inventory fetch; ✎ note deep-links; `notes:open` intent; autosave
  discipline; `renderMarkdown`; proposal accept / description-edit / reject semantics; MCP tools
  and launch injection (untouched).

## Deliberate simplifications (and when to revisit)

- **Staleness is a heuristic** — it tracks only what *this pane* sent via Sync. Agent-pulled
  context (MCP `task_context`) and workflow pushes don't update it. Tooltip says so. Revisit if
  users are misled; a fuller design needs main-side send accounting.
- **~tokens = bytes/4**, marked with `~`. Revisit only if a real tokenizer lands for other reasons.
- **No proposal body editing in the UI** — the API supports `edited.body`; add when someone asks.
- **Notes view state is session-only** (selected note, library collapse). Promote to a persisted
  slice only if users ask.
- **No virtualization** in either pane — lists are small (notes ≤ tens, memory index-only ≤ 30).
- **Scratchpad create is client-lazy** with a single-flight guard; slug collision degrades to
  adopting the deduped slug. No server upsert endpoint.
- **No new shared primitives** — the budget bar, dots, pills, and badges are local CSS recipes per
  house convention; `Picker` and `renderMarkdown` are the only shared UI reused; `Tabs` is not
  needed.

## Phased implementation

Each phase ships alone. After every phase: `pnpm lint` and `pnpm test` (remember the ABI dance —
`pnpm test` self-heals to the Node ABI; run `pnpm run rebuild` before `pnpm dev`).

**Phase 1 — Manifest core + persisted selection.** Server 7a; `selectionState.ts` + slice +
`PrefKeys` entry + `scopedEviction` wiring; ContextPane restructure (sections with provenance
badges, `MemorySection` inline, tray gone). Keep the current send targeting `agentSessionsFor()[0]`
for now. *Verify:* the slice conformance test (`persistedState.conformance.test.ts`) picks the new
slice up automatically; manual — toggle sections, switch task and back (selection survives),
restart the app (selection survives), accept a proposal inline, confirm an empty note is absent
from an assembled send.

**Phase 2 — Preview + sizes.** `model.ts` helpers + tests; preview strip; per-section sizes and
bars; send switches to local `assembleBlockFrom` (delete `selectionToInclude`). *Verify:* expanded
preview text equals what lands in the terminal (paste-compare); `model.test.ts` covers
`sectionCap`, `assembleBlockFrom` ordering/filtering, `formatSize`.

**Phase 3 — Session picker + staleness.** `syncState.ts`; footer `Picker` + stale pill;
`recordSync` on a successful send. *Verify:* with two agent sessions, sync to one → its pill goes
`synced`, the other stays `not synced`; edit an included note, Refresh → `stale · 1 change`.

**Phase 4 — Notes pane rework.** Server 7b; `notesPaneState.ts`; NotesPane rebuild (scratchpad
landing + lazy create, merged groups + badges, per-group `+`, filter, editor header, footer,
`context:reveal` intent + ContextPane consumption, library collapse); `notes.css`. *Verify:* fresh
task → pane lands in a virtual scratchpad; typing creates exactly one file at
`<dataDir>/notes/task/<id>/scratchpad.md`; a never-typed scratchpad leaves no file; rename
persists in frontmatter and survives reload; "view in Context" opens the Manifest scrolled to the
note's row; the Manifest's ✎ still deep-links back.

**Phase 5 — Promote to memory.** `memory:prefill` intent; `MemorySection` `draft` prop; NotesPane
◆ promote. *Verify:* promote from a note → Manifest opens with the memory form pre-filled → save →
the index row appears after refetch.

## Risks / open questions

- **`include=*` stays** by design — the pane is an inventory; curation moved client-side. Cost is
  one full assembly per pane mount/refetch, same as today.
- **Local-assembly drift**: if a future section's `compact` ever depends on which *other* sections
  are included, `assembleBlockFrom` diverges from a server-curated fetch. Today assembly is
  provably per-section independent — the invariant comment in `contextSections.ts` (Phase 1) is
  the guard.
- **Scratchpad churn**: the first-keystroke create must be single-flight and the pending body must
  flush through after the create resolves. Covered in § Data hierarchy; test it explicitly.
- **Open question**: should workspace-scoped *seeded* notes from other tasks show in the library?
  (The assembler already excludes them from other tasks' context via `originTaskId`.) Recommend:
  show them with the `seed` badge; revisit if noisy.
