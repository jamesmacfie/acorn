# Notes and memory

acorn keeps two distinct stores of free-form knowledge, separated by a deliberate hard boundary:
**notes** are ephemeral working context (what someone is thinking *right now* on a task); **memory**
is durable, distilled knowledge (how a repo works, learned once and reused forever). Notes are
gitignored; memory is committed. Notes consolidate *into* memory — never the reverse. Both stores can
be read by agents; agent **note** writes land directly but are stamped with provenance, while every
agent **memory** write is a proposal that a human gates — nothing lands in memory silently.

A third store, **`review_notes`** (anchored inline annotations on a diff), is *not* markdown notes and
is documented with the Changes pane — see [panes.md](./panes.md). The boundary is below.

## The boundary

| | Notes | Memory | `review_notes` |
| --- | --- | --- | --- |
| Purpose | ephemeral working context | durable distilled knowledge | inline annotations on uncommitted changes |
| Lifetime | task/workspace-scoped, disposable | cross-task, reused forever | until sent to the agent, then re-anchored |
| Truth | `.md` files, **gitignored** | `.md` files, **committed** (repo scope) | rows in the `review_notes` SQLite table |
| Content | prose, no anchors | frontmatter + prose, `[[wikilinks]]` | body anchored to `path` + line range |
| Agent write | direct (stamped as agent) | **propose only** (human gate) | n/a (human authors, sent as a prompt) |
| Doc | this file | this file | [panes.md](./panes.md) (Changes pane) |

The rule of thumb (docs/next/12): a note is *"what I'm thinking on this task"*; a memory
is *"how this repo works."* Notes are meant to be thrown away; the valuable distillate is promoted into
memory, where it is reviewed exactly like code (via the PR that carries the file).

The unbuilt parts of the memory design live in `docs/next/12-memory.md` (the notes design shipped
in full and was distilled into this doc); the paragraphs below describe **what exists in code
today**.

## Notes

### Where they live

Notes are markdown files on disk under `apps/desktop/.acorn/notes/<workspaceId>/<slug>.md`
(gitignored). They come at two **scopes** (`apps/desktop/src/client/features/notes/notesClient.ts:11`):

| Scope | Store key | Shared by |
| --- | --- | --- |
| `workspace` | the workspace's uuid | every task/worktree in that workspace group |
| `global` | the reserved key `'global'` (`notesClient.ts:12`) | every workspace |

Workspace notes are keyed by the *workspace*, not the task — so all tasks in the "Runn" group see the
same note set. The reserved `'global'` key can never collide with a real workspace uuid, so global
notes need no schema change — just a well-known key.

### Kinds and authors

Each note carries an `author` (`user | agent | workflow`) and a `kind`
(`scratch | plan | finding | handoff`) — `notesClient.ts:5-6`. Humans in the UI only ever create
`scratch` notes; `plan`/`finding`/`handoff` are written by agents and workflows and surface separately.

### The Notes pane

`apps/desktop/src/client/features/notes/NotesPane.tsx` — a layout pane (`PaneId` `notes`) reached
through the preload bridge `window.acorn.notes` (`notesApi()`), so it needs the desktop app and an
active workspace; it renders an empty-state fallback otherwise (`NotesPane.tsx:114`). Layout:

- A left list grouping **user notes** first, then a collapsible **Global notes** group (🌐), then a
  collapsible **Agent notes** group showing each note's `kind` and author glyph (🤖 agent / ⚙ workflow)
  — `NotesPane.tsx:117-164`. Agent/workflow notes are read-only distinct from human scratch.
- A create form with a scope selector (This workspace / Global) and a title — humans create `scratch`
  only (`NotesPane.tsx:87`, `create()`).
- A right editor: a plain `<textarea>` with an **Edit/Preview** toggle that renders sanitized markdown
  (`ponytail:` textarea over a rich editor — `NotesPane.tsx:11`). No Save button: **autosave** debounces
  1.5s while typing and flushes on blur and before switching notes (`NotesPane.tsx:57`, `scheduleSave`).

The Context pane's per-note "Edit" jump lands here: `requestNoteOpen(slug)` sets a cross-pane signal
that `NotesPane` consumes on mount to open that slug editable (`notesClient.ts:26-31`, `NotesPane.tsx:61`).

### Agent access — the harness endpoints and MCP tools

Agents reach notes over the **loopback harness routes** (`apps/desktop/src/server/routes/harness.ts`),
which are keyed by **task id** (the store resolves task → workspace internally). The routes delegate to
the main-process `NotesStore` through the injected `HarnessBridge` (`harness.ts:10-36`):

| Route | Bridge method | MCP tool |
| --- | --- | --- |
| `GET /:id/notes` | `notesList` | `notes_list` |
| `GET /:id/notes/:slug` | `notesRead` | `notes_read` |
| `PUT /:id/notes/:slug` | `notesWrite` | `notes_write` |
| `POST /:id/notes/:slug/append` | `notesAppend` | `notes_append` |

The MCP tools (the notes block in `apps/desktop/src/mcp/server.ts`) call these routes with the inherited
`ACORN_SESSION_ID`, so agent writes are **stamped server-side** with `author: agent` + the session id
for provenance. `notes_write` replaces a body (creating the note if missing); `notes_append` adds to
it (findings, plans, handoffs). Files remain the source of truth — the MCP tools and the UI edit the
same `.md` files.

## Memory

### Files are the truth; SQLite is a derived index

Memory is markdown files, at two scopes (docs/next/12, schema comment `schema.ts:392-397`):

```
<worktree>/.acorn/memory/*.md   + MEMORY.md   ← repo scope: COMMITTED, reviewed in PRs, portable
~/.acorn/memory/*.md            + MEMORY.md   ← private scope: operator machine gotchas / prefs
```

The files are the source of truth — grep-able, diffable, reviewable, and readable by any agent with
plain file tools even if the MCP is off. The **`memories` SQLite table** (`schema.ts:398-414`) is a
*derived index* reconciled on file change from every active worktree plus the primary checkout:

- **`id` is a content hash** (`sha256(content)` prefix) — the same file seen in N checkouts collapses
  to one row (idempotent).
- **Conflicts on `(scope, repo, name)` resolve by newest `updatedAt`**; genuine contradictions are what
  the `supersededBy` chain is for (supersede, never overwrite in place).
- The index is the **cross-task retrieval plane**: a memory accepted on task A's branch is retrievable
  by task B immediately (via search/injection) even though B's *files* only gain it after merge — the
  index papers over merge lag.

A companion **FTS5 virtual table `memories_fts`** (Porter tokenizer over `name`/`description`/`body`,
created by hand in migration `0011` since Drizzle doesn't model virtual tables — `schema.ts:394-396`)
powers ranked keyword search. No embeddings; FTS5 ships with better-sqlite3, so keyword retrieval needs
zero new deps (`ponytail:` docs/next/12).

### Fields

| Column | Meaning |
| --- | --- |
| `scope` | `repo` (committed) or `private` (`~/.acorn`) |
| `repo` | `owner/name` for repo scope; `null` for private |
| `name` | kebab-case identifier |
| `type` | `convention` \| `architecture` \| `decision` \| `fix` \| `reference` \| `feedback` \| `task` \| `user` |
| `description` | one-line summary (what the index shows) |
| `body` | full markdown, includes a **"Why:"** rationale line |
| `path` | the winning file on disk |
| `originSessionId` | provenance — the session that produced it |
| `commitSha` / `updatedAt` | so staleness is measurable |
| `supersededBy` | version-chain pointer (never delete) |
| `lastAccessedAt` / `accessCount` | recall bookkeeping |

The `type` enum (docs/next/12) splits by decay policy: `convention`/`architecture`/`decision`/`user`
are stable; `fix`/`reference` are episodic and `reference` "rots on refactor" (verify); `task` is
in-flight and dropped on completion.

## The memory UI — the MemoryTray, inside the Context pane

Memory has no pane of its own; its UI is the **MemoryTray** component
(`apps/desktop/src/client/features/memory/MemoryTray.tsx`), hosted by the **Context pane**
(`ContextPane.tsx` keeps context assembly/send as its one job and renders the tray below it),
reached through the preload bridge `window.acorn.memory` (`memoryApi()`,
`apps/desktop/src/client/features/memory/memoryClient.ts`). Two surfaces:

1. **Memory proposals — the human gate.** Pending proposals are listed with an editable
   description and **Accept / Reject** buttons; a proposal's structural verification `flags` (e.g.
   a contradiction) render as **warning badges under the row**, separate from the description.
   Accept writes the memory file into the task worktree's `.acorn/memory/` and reconciles the
   index (repo scope lands via the PR — `acceptProposal`,
   `apps/desktop/src/main/memoryGen.ts:137-161`); reject leaves no trace. This is the
   countermeasure to "LLM rewriting corrupts ground truth" — a human always sees the memory
   before it lands.

   Proposals arrive from two sources and land in one store: an agent's `memory_write` (the MCP
   propose path) and the **auto-generation pass** (below). The store is JSON files under
   `apps/desktop/.acorn/memory-proposals/` — visible, greppable, crash-safe, no schema
   (`MemoryProposalStore`, `apps/desktop/src/main/memoryProposals.ts`).
2. **Manual "+ memory"**: a form with name (kebab-cased), type, scope (`repo (worktree,
   committed)` vs `private (~/.acorn)`), one-line description, and body. Writes directly on the
   human's behalf (no gate — the human *is* the gate).

Agents reach memory over the same harness routes, keyed by task id (`harness.ts:72-98`):

| Route | Bridge method | MCP tool |
| --- | --- | --- |
| `GET /:id/memory?q=…` | `memorySearch` (FTS5 ranked) | `memory_search` |
| `GET /:id/memory` | `memoryList` (index: name + description) | `memory_list` |
| `GET /:id/memory/:name` | `memoryGet` (full body + path) | `memory_get` |
| `POST /:id/memory/propose` | `memoryPropose` | `memory_write` |

Note the asymmetry: agent reads are direct, but the **only write path an agent has is `propose`**
(the `/memory/propose` route in `harness.ts` and the `memory_write` tool in `mcp/server.ts`). `memory_write` is documented to the agent as "a human
reviews before it lands — nothing is written directly." A silent agent write does not exist.

### Auto-generation — the task-boundary memory-review pass

Implemented in `apps/desktop/src/main/memoryGen.ts`, triggered from `memoryReviewTrigger`
(`apps/desktop/src/main/knowledgeIpc.ts`): when an agent session ends (and best-effort at archive),
while the worktree is still alive, acorn runs a **headless memory-review step** — the same headless
runner workflows use (`claude -p --json-schema …`; it uses the first installed headless-capable
agent profile — claude-code, then codex (`memoryReviewProfile`) — else it silently skips) — over
the task diff (`git diff HEAD`, capped at 20k chars) plus the session transcript tail (10k), with the
existing memory index inlined so the model doesn't duplicate. The structured output
(`MEMORY_REVIEW_SCHEMA`) is then **verified cheaply before it ever reaches a human**
(`verifyCandidates`, `memoryGen.ts:54-67`):

- a candidate citing a **missing file** is blocked;
- a **duplicate** (content-hash match against the index) is blocked;
- a **same-name, different-content** candidate is *flagged* as a contradiction — accepting it
  supersedes the existing memory (supersede, never overwrite in place). Flags ride the proposal's
  structural `flags` field (`MemoryProposal`, `main/memoryProposals.ts`; mirrored on the client's
  `MemoryProposalRow` and rendered as badges in the MemoryTray) — never folded into the
  description, which would leak into the memory file on accept.

Survivors are filed as proposals through the same gate as `memory_write`; a bell notice ("N memory
proposals await review") surfaces them. The whole pass is best-effort — a failure never disturbs the
task lifecycle (`knowledgeIpc.ts`).

## How this feeds agents

Notes and the memory index are folded into the task's **assembled context**
(`apps/desktop/src/shared/api.ts:198-207`, `TaskContext`), which has two consumers — plus a third
path for memory alone:

- **Push** — the Context pane's **"Assemble & send → agent"** button. The human ticks include
  checkboxes (`pr`/`issues`/`notes`/`memory`; memory is opt-in by default —
  `context/model.ts:9`), the client fetches the curated context, renders it with
  `formatContextBlock` (`apps/desktop/src/shared/contextBlock.ts`), and delivers it to the running
  agent session gated on the idle edge (`ContextPane.tsx:104-113`).
- **Pull** — the MCP `task_context` tool (`mcp/server.ts`) returns the same assembled bundle,
  including notes and the repo memory *index*.
- **Inject at launch** — when an agent terminal session starts, the repo's memory index slice is
  formatted and injected into the session (`memoryIndexSlice` + `formatMemoryInjection`, wired in
  `apps/desktop/src/main/knowledgeIpc.ts`), so an agent knows what memory exists before it asks.
  The per-directory `MEMORY.md` (one line per memory) serves the same index role for agents reading
  files directly (`memory.ts:106`).

`formatContextBlock` is compact by design: it emits note titles + bodies but the memory **index only**
(`- name — description`) with the hint "ask for bodies via memory_get" (`contextBlock.ts:32-35`). The
mantra (docs/next/11): the primary agent should never burn context on storage strategy — it pulls
memory bodies on demand.

### The committed `.acorn/` convention

Both memory (repo scope) and notes reference a **single `.acorn/` directory**, not a dotfile per
feature. In a repo/worktree it holds `config.toml` (run targets, editor — see
[workflows.md](./workflows.md), docs/next/13), `memory/`, and workflow assets; committed content is
team-shared, while acorn's own local state lives under `apps/desktop/.acorn/` (gitignored: the client
query cache, blob cache, and workspace notes).

## Maturity

- **Write paths need the main process.** The harness routes delegate through the per-domain
  `NotesBridge`/`MemoryBridge` sub-bridges injected by `main/harnessWiring.ts`. Without them — e.g.
  `dev:node` running just the Hono server with no Electron — every route degrades to a clean **503**
  (`bridge-unavailable`) rather than erroring. The notes/memory UIs likewise need the preload bridges
  (`window.acorn.notes` / `.memory`), so they are desktop-only.
- **The full proposal loop is implemented** — the human gate (Accept/Reject, manual add,
  `memory_write` = propose) *and* the automatic generation of proposals at task boundaries: the
  agent-session-end hook fires the headless memory-review pass over the diff + transcript
  (`memoryGen.ts`, wired in `knowledgeIpc.ts`; see "Auto-generation" above). It depends on an
  agent CLI being installed and is best-effort by design. What remains **design-stage**
  (docs/next/12) is the separate *periodic consolidation* pass (re-distilling/merging existing
  memories over time) and richer decay handling for episodic types.

## Source

- Schema: `apps/desktop/src/server/db/schema.ts` (`memories` + `memories_fts` in migration `0011`;
  `review_notes` for the separate anchored store)
- Shared note shapes: `apps/desktop/src/shared/notes.ts` (canonical `Note`/`NoteSummary` +
  author/kind unions, imported by main and client)
- Stores (main process): `apps/desktop/src/main/notes.ts` (`NotesStore` — the `.md` files),
  `apps/desktop/src/main/memory.ts` (memory files + derived index + `MEMORY.md`),
  `apps/desktop/src/main/memoryProposals.ts` (proposal JSON store),
  `apps/desktop/src/main/memoryGen.ts` (auto-generation + accept/reject verdicts; trigger + the
  notes/memory IPC wired in `main/knowledgeIpc.ts`)
- Harness routes: `apps/desktop/src/server/routes/harness.ts`
- Notes UI + bridge: `apps/desktop/src/client/features/notes/{NotesPane.tsx,notesClient.ts}`
- Memory UI: `apps/desktop/src/client/features/memory/{MemoryTray.tsx,memoryClient.ts}`, hosted by
  `apps/desktop/src/client/features/context/{ContextPane.tsx,model.ts}`
- Assembly: `apps/desktop/src/shared/{api.ts,contextBlock.ts}`
- MCP tools: `apps/desktop/src/mcp/server.ts`
- Design (remaining unshipped parts): `docs/next/11-context-assembly.md`, `docs/next/12-memory.md`

See also: [panes.md](./panes.md) (Context / Notes / Changes panes),
[mcp.md](./mcp.md), [workspaces-and-tasks.md](./workspaces-and-tasks.md),
[data-layer.md](./data-layer.md), [workflows.md](./workflows.md).

