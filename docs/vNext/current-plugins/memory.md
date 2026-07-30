# Memory plugin migration

Status: **Normative**<br>
Coordinate: `acorn/memory`<br>
Requirement prefix: `CUR-MEM`

## 1. Current behavior and authoritative state

V1 Memory is durable distilled knowledge. Repo truth is committed
`<worktree>/.acorn/memory/*.md` plus generated `MEMORY.md`; private truth is
`~/.acorn/memory/*.md`. SQLite `memories`/FTS5 is a derived cross-worktree index. Content-hash IDs
deduplicate copies; newest `(scope,repo,name)` wins; supersession preserves contradictions. Reads
track access. Agents search/list/get directly but can only propose writes; a human gates
accept/edit/reject. Human manual creation writes directly.

- **CUR-MEM-001:** Repo Memory MUST remain reviewable committed files, not become hidden plugin
  database authority. The plugin database is a reconstructable index plus durable proposal state.
- **CUR-MEM-002:** An agent or automated review MUST never directly write accepted Memory.

## 2. Current UI, routes, events, contributions and dependencies

V1 embeds `MemorySection` directly inside Context: pending proposals with flags/edit/accept/reject
and manual add with repo/private scope. Routes list/search/proposals/resolve and Task memory add;
`/api/v1/plugins/memory` additionally lists/searches/creates and resolves proposals. Agent tools are
`memory_search`, `memory_list`, `memory_get`, `memory_write` (proposal).

On session end/archive, a best-effort headless profile reviews up to 20k diff and 10k transcript
tail, compares the existing index, rejects missing-file/duplicate candidates, flags name
contradictions and files proposals. Launch injection includes up to 30 index entries plus up to five
feedback/convention bodies capped 1,500 chars. No durable Memory event exists; proposal notices use
a workflow notice.

## 3. Target classification

- **CUR-MEM-003:** Memory is bundled **Acorn Verified**, with a WASI policy/index/proposal component
  and declarative UI contribution. Core provides task-confined files, Git metadata, search index,
  model generation and agent lifecycle capabilities.
- **CUR-MEM-004:** Memory is independent of Context. It contributes a context section and proposal
  view that Context may host through declared contracts.

## 4. Node, Electron, native-host and renderer split

Node core provides safe file read/atomic write, repository/worktree enumeration, Git diff/head,
search indexing, headless model operation and agent lifecycle events. Memory owns file grammar,
reconciliation/winner/supersession rules, proposals, recall policy and launch/context projections.
Electron renders proposal/manual forms and Memory details using standard renderers.

- **CUR-MEM-005:** Repo writes target the Task's worktree only, never the primary checkout. Private
  Memory uses the owning Node's protected private Memory root, not the Electron device.
- **CUR-MEM-006:** Remote clients see Node paths only as safe provenance labels; absolute path values
  do not enter declarative UI or events.

## 5. Manifest, capabilities, permissions and dependencies

Required: plugin storage/search, Task/repository reads, confined `.acorn/memory` file read, atomic
write for approved/human actions, Git head/diff reads, agent tool exports and context-section export.
Optional `acorn/agents` dependency supplies lifecycle/transcript-tail/headless-generation capability.
It requests notification/attention contribution and standard list/form/Markdown/diff/status
renderers. Private-memory capability is Node-owner scoped.

## 6. Queries, commands, capabilities, events and streams

Queries: `entries.list`, `entries.search`, `entry.get`, `proposals.list`, `context.index`,
`launch.injection`; commands: `entry.create`, `proposal.create`, `proposal.resolve`,
`index.reconcile`, `review.request`. Types remain convention/architecture/decision/fix/reference/
feedback/task/user and scopes repo/private.

Memory exports:

- `dev.acorn.memory.entry.search|get|list.v1` to Agents;
- `dev.acorn.memory.proposal.create.v1` as the only agent write;
- `dev.acorn.memory.context-section.get.v1` returning index metadata only; and
- `dev.acorn.memory.launch-injection.get.v1`.

Events are `proposal.created|accepted|rejected|flagged`, `entry.created|superseded`,
`index.reconciled|degraded` and `review.completed|skipped|failed`. They contain URI/name/type/scope,
safe flags/counts and digests—not bodies, paths, diff or transcript.

- **CUR-MEM-007:** Entry filename/name grammar rejects traversal and `..`; frontmatter is a fixed,
  non-executable schema. Writes are temp+fsync+rename and regenerate deterministic `MEMORY.md`.
- **CUR-MEM-008:** Reconciliation scans approved roots, resolves newest winner, preserves recall
  stats by content hash, rebuilds plugin FTS and emits one summarized event.
- **CUR-MEM-009:** Search is repository rows plus private rows, excludes superseded entries, quotes
  user terms, limits 50 candidates/10 returned by default and updates access stats only on actual
  search/get.
- **CUR-MEM-010:** Review is a bounded asynchronous operation. Missing profile skips; failure never
  blocks agent/task lifecycle; accepted output is still only a proposal. No live stream exists.

## 7. UI contributions and renderer requirements

Memory contributes a semantic `context-section` containing index rows, “add memory” action and
proposal gate slot. Preserve editable proposal description/body/name/type, structural warning flags,
accept/reject, pending count, and manual name/type/scope/description/body. Accept confirmation
states that repo scope modifies the current branch; private scope stays on that Node.

Standalone settings/attention fallback MUST expose pending proposals if Context is absent.
Mobile supports list/search/get and proposal gate through standard renderers.

## 8. Storage, migration, backup, uninstall and reinstall

Plugin DB owns `p_entries_index`, FTS, `p_proposals`, recall stats and reconciliation cursors.
Proposal JSON files become DB rows so status/event transitions are transactional; content is
sensitive and backup-included. Repo/private Markdown remains authoritative and backup treatment is:
repo files excluded as Git-owned, private files included in encrypted Node backup when selected.

- **CUR-MEM-011:** V2 clean-start imports no V1 SQLite index/proposal files/private Memory. Existing
  repository `.acorn/memory` content is ordinary repository configuration and is indexed only after
  the repository is registered and trusted for reading; it is not a V1 state migration.
- **CUR-MEM-012:** Disable stops reconciliation/review but never removes Markdown. Uninstall retains
  proposal/index DB 30 days; delete-now deletes DB/private files only after explicit separate choice
  and never repo files.

## 9. Setup, settings, health, update and failure

Setup explains committed vs Node-private scope and human gate; no credential. Settings enable
launch injection/automatic review, choose eligible headless model connection, and set lower caps.
Health reports filesystem/search index and optional review availability independently. Invalid or
unreadable files are skipped with visible diagnostics; duplicate/conflicting files are not silently
rewritten. Update rebuilds the derived index when its schema/tokenizer changes.

## 10. Security and credential treatment

- **CUR-MEM-013:** File access is confined to approved `.acorn/memory` directories; symlink escape,
  invalid names, oversized file (>256 KiB), unbounded source count and executable frontmatter are
  rejected.
- **CUR-MEM-014:** Model review receives only bounded diff/transcript/index needed for the task,
  through a declared model capability. It cannot read secrets or write files.
- **CUR-MEM-015:** Bodies/transcripts/diffs/private scope are sensitive, encrypted in plugin
  DB/backups and excluded from events/logs. Context receives index only unless owner/agent calls
  get with permission.
- **CUR-MEM-016:** Accept verifies proposal revision, target worktree generation and content again.
  Name conflict creates explicit supersession/confirmation; it does not overwrite invisibly.

## 11. Coupling that must be removed

Remove Memory → Notes store/import, Memory UI embedded import in Context, core schema/index tables,
direct agent profile/headless/task environment/workflow notice calls, application-specific
`KnowledgeBridge`, and core context wiring over implementations. Replace with plugin DB, context
section export, Agents/model lifecycle capability, notification contribution and safe core
file/Git/search brokers.

## 12. Fresh-install parity scenarios

- **CUR-MEM-017:** Registered repo Markdown reconciles to equivalent list/search/get, cross-worktree
  dedupe, newest winner, FTS rank, index generation and private+repo filtering.
- **CUR-MEM-018:** Agent `memory_write` and automatic review create visible proposals only; human
  edit/accept writes the Task branch and reject writes nothing.
- **CUR-MEM-019:** Launch injection and Context section preserve the index/body caps and never expose
  full long-tail bodies without get.
- **CUR-MEM-020:** Missing headless provider skips review without harming session/archive; remote
  Electron can review proposals owned by the remote Node.
