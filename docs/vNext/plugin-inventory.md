# Plugin inventory

All 20 first-party plugins: what each does, its node/client/data split, what it depends on, and
anything genuinely tricky about extracting it from V1. Defaults that apply to all (stated once):
own SQLite DB only if listed under **Data**; secrets via the core secret store; child processes
via the process broker; UI through the standard registries; behavior parity with V1 unless noted.

Dependencies marked *(opt)* are optional capabilities — the consumer degrades gracefully when the
provider plugin is disabled.

## Required plugins

### github
- **Does**: PR review center — repo/PR browse, three-column review, diff, create PR,
  merge/draft/auto-merge, comments/reviews/threads/labels/reviewers, checks + Actions logs,
  conflict detection, task promotion.
- **Node**: GitHub REST/GraphQL adapter; serve-then-revalidate mirror (ETag/TTL, single-flight,
  batch prefetch); provider writes that update the mirror (or mark stale) before returning;
  conflict analysis via `git merge-tree`; Actions log fetch with credential-stripped redirects.
- **Client**: default workspace source; browse route; PR pane (10, ⌘⇧R); create-PR flow; checks
  UI; connection settings; review shortcuts.
- **Data**: connections, mirror tables (pulls/files/reviews/comments/threads/checks/sync state),
  viewed-files, pinned repos; patch/blob bodies in the shared blob store.
- **Depends**: core git + http + secrets; linear *(opt)* for the PR reference panel.
- **Tricky**: GitHub OAuth stops being app login — the GitHub identity becomes a per-node
  integration credential; Acorn auth is device tokens. Credential acquisition, **as shipped in
  Phase 1**: the **node** runs the OAuth **device authorization grant** (RFC 8628) and stores the
  resulting token in its own encrypted `integrations` row — `POST /v2/p/github/auth/device/start`
  and `/poll` (`plugins/github/src/server/routes/deviceAuth.ts`); the client only renders the user
  code and polls. This inverts what this document originally specified (a client-run
  loopback-redirect flow, with device flow as "the fallback for CLI-only setup of a headless
  node"), and the inversion is the point: the device flow needs **no client secret** — so a secret
  recoverable from a distributed binary stops being a caveat — and **no redirect URI**, so a local
  node and a remote one run byte-identical code. The renderer has no server-served origin to
  redirect back to any more, and a remote node would have needed its own registered callback URL.
  It also deletes the auth `BrowserWindow` and the navigation-intercept dance in Electron main.
  The cost is one extra user action: read a code, type it at github.com/login/device. Never serve a
  pre-write mirror value as fresh after a successful provider write.

### terminal
- **Does**: task-scoped terminals — shell + agent profiles, ephemeral PTY or durable tmux,
  bottom drawer with tabs, raw-agent status heuristics, send-to-agent, controller handoff with
  the agents plugin.
- **Node**: session semantics over the core PTY broker (it spawns nothing itself); tmux
  reconciliation on restart; replay tail (256 KiB raw + canonical framebuffer) for reattach;
  output coalescing (~16 ms); idle/blocked heuristics; stream frames with credit backpressure.
- **Client**: drawer (⌘⇧T, tabs, per-task last-active), xterm wrapper from client-core (WebGL +
  DOM fallback), profile menu, status badges, settings.
- **Data**: session metadata only — never scrollback/output.
- **Depends**: core PTY broker; profile plugins register launch specs via capability; agents
  *(opt)* consumes handoff/roster.
- **Tricky**: V1's terminal module owns worktree/run-target/config-trust/captured-command routes
  that must move to core first (biggest scope shed in the migration). Reattach ordering is a hard
  barrier: reset + framebuffer, then buffered live output, then stream — the raw tail never
  replays as screen history.

### agents
- **Does**: managed AI sessions per task (Claude via ACP, Codex via app-server): normalized
  transcript, turn queue, permission/question cards, attachments/artifacts, fork/compact/archive,
  Agent Center, usage/pricing, webhooks.
- **Node**: provider-driver registry + supervisor; scheduler (1 turn/session, caps per workspace
  and provider account); session state machine with an append-only per-session event ledger (its
  own durable sequence — the replay authority for transcripts); attachment/artifact stores; FTS
  search; account-level usage probes (cached ~5 min); HMAC-signed webhook dispatch.
- **Client**: Agent Center source (fleet-aggregated); agent pane (15, ⌘⇧A) with transcript,
  composer, queue, request cards; context picker; usage header; pricing settings; notifications.
- **Data**: sessions, turns, session events, requests, attachments, artifacts, webhooks, FTS,
  provider health.
- **Depends**: core process/secrets/scheduler; terminal *(opt)* handoff; profile plugins *(opt)*
  as drivers; workflows *(opt)* consumes `sessionExecute`.
- **Tricky**: state + ledger event committed in one transaction; never auto-resubmit a turn once
  any of its events committed; exclusive controller lease for terminal handoff. Transcript
  streaming rides the WS as a stream, backed by the ledger for catch-up.

## Default plugins

### editor
- **Does**: file tree, tabs + Monaco editor, ⌘P quick-open, find-in-files, send file/selection
  refs to agent.
- **Node**: thin routes over core file/git/search services: list (git ls-files), read (capped),
  revision-checked atomic write, ripgrep search (bounded, the `.` path-arg gotcha lives in core).
- **Client**: editor pane (50, ⌘⇧E), search pane (60, ⌘⇧F), files overlay (⌘P); preview tabs,
  1.5 s autosave, per-task tab persistence.
- **Data**: none on node — the worktree is the store; client keeps tab metadata.
- **Depends**: core files/git/search; agents *(opt)* for references. Monaco lives in client-core.
- **Tricky**: autosave becomes revision-checked — V1's unconditional overwrite is replaced by a
  conflict UI (deliberate behavior change).

### changes
- **Does**: PR-style view of uncommitted worktree changes: stage/unstage/discard/commit/push,
  inline review notes, send to agent.
- **Node**: review-note storage + prompt formatting; all Git via core git service.
- **Client**: changes pane (20, ⌘⇧G) using the shared diff viewer; commit/push UI; note composer.
- **Data**: review notes (path, range, body, sent-revision).
- **Depends**: core git; agents *(opt)* for send; shared diff viewer from client-core.
- **Tricky**: mark notes "sent" only on confirmed enqueue to the agent; a note edited after
  sending reverts to unsent.

### notes
- **Does**: working notes at task/workspace/global scope; scratchpad; include-in-context toggle;
  agent read/append tools.
- **Node**: note CRUD with revisions; context projection; markdown import/export.
- **Client**: notes pane (30, ⌘⇧D); debounced autosave with conflict-on-revision-mismatch.
- **Data**: notes (storage moves from loose markdown files to the plugin DB; files become
  explicit import/export).
- **Depends**: context *(opt)* consumes its section; memory *(opt)* consumes promotion source.
- **Tricky**: V1's knowledge bridge (memory constructs notes' store) is severed — notes owns its
  data, memory consumes a capability.

### memory
- **Does**: durable reviewed knowledge: committed `.acorn/memory/*.md` + node-private entries,
  search, agent proposals gated by human review, end-of-session review, launch injection.
- **Node**: file-format ownership + reconciliation (hash dedupe, supersession); proposal
  lifecycle; FTS index (rebuildable — markdown files stay authoritative); recall stats.
- **Client**: context-section contribution (index + proposal gate + manual add); attention items.
- **Data**: entry index + FTS + proposals (index reconstructable from files).
- **Depends**: notes *(opt)* promotion; agents *(opt)* lifecycle events + headless review runs.
- **Tricky**: agents can never write accepted memory directly — the proposal gate is structural,
  and acceptance re-verifies proposal revision + worktree state.

### context
- **Does**: assembles "what the agent sees" per task: PR summary, issues, notes, memory, with
  include toggles, byte budgets, exact preview, sync-to-agent.
- **Node**: section registry + deterministic budget engine live in core; context contributes
  ordering/labels. Sections resolve independently with per-section deadlines; one failing
  section renders stale/absent without hurting siblings.
- **Client**: context pane (40, ⌘⇧X): checkboxes, budget bars, token estimates, jump intents,
  target-agent picker, staleness fingerprints. Selection state is client-local.
- **Data**: none durable — it's a pure projection.
- **Depends**: notes/memory/github/linear/rollbar *(opt)* section providers; agents for
  snapshot/send (the snapshot artifact is agents-owned).

### workflows
- **Does**: durable orchestration from `.acorn/workflows/*.toml`: agent steps, human/policy
  gates, CI loop, fan-out/join, budgets, triggers that run with the client closed.
- **Node**: definition loader (static expansion, cycle rejection); run/step state machine on the
  operations pattern; agent-slot semaphore; budget rails; trigger cursors; restart
  reconciliation by persisted operation IDs (never blind rerun: unknown external outcome parks
  the run in a gated recovery state).
- **Client**: settings inspector + problems; palette rows; task activity slot; gate
  approve/reject; attention items.
- **Data**: definitions, runs, steps, gates, handoffs, trigger cursors.
- **Depends**: agents `sessionExecute` *(opt — agent steps unavailable without it)*; terminal
  runTargets *(opt)*; github checks policy *(opt)*.
- **Tricky**: structured step output is the only control-flow currency — transcripts/free text
  never gate anything. Repo definitions are config-trust-gated at start, not at listing.

### database
- **Does**: task-scoped Postgres client: schema browse, paged rows, PK edits, SQL editor,
  repo-scoped saved queries, AI SQL generation from live schema.
- **Node**: connection leasing via a core Postgres broker (plugin never sees the URL — resolution
  order: trusted repo url-script → worktree .env → env, config-trust gated); schema
  introspection; saved-query storage.
- **Client**: database pane (70, ⌘⇧J): Monaco SQL editor, data grid, generate-SQL modal.
- **Data**: saved queries (repo-scoped).
- **Depends**: core postgres broker + config trust; model-providers *(opt)* for generation.
- **Tricky**: `sql.execute` is always treated as a mutation (no read-only parse classification)
  and never auto-retried after an ambiguous network failure.

### docker
- **Does**: node-local Docker: inventory source, task-matched container pane, logs/stats/exec,
  Compose lifecycle, prune, archive-time teardown prompt.
- **Node**: fixed-argv Docker CLI invocations via process broker; `docker events` watcher with
  backoff; short-TTL projection caches; task matching (compose project/workdir/branch slug);
  teardown flow that itemizes partial failures.
- **Client**: docker source + conditional task pane (75); running-count badges; archive prompt;
  exec via the terminal UI kit.
- **Data**: matching config + settings; inventory is never persisted — Docker is authoritative.
- **Depends**: core process/stream brokers; terminal *(opt)* exec UI.
- **Tricky**: compose execution is config-trust-gated on the hash of the compose file set
  (V1's declarative-vs-executable split: matching config is declarative, running compose is not).

### http
- **Does**: Bruno-style HTTP client: repo-filed + ad-hoc requests, variables
  (value/secret/command), auth helpers, curl import/export, response viewer.
- **Node**: request model + one-pass interpolation; sends via core http service (30 s / 5 MiB
  caps); command variables execute via process broker with per-variable grants (15 s / 1 MiB).
- **Client**: API Requests source + task pane (76, ⌘⇧H); tabs with memory-only drafts;
  variables settings.
- **Data**: requests + variables (secret fields as refs).
- **Depends**: core secrets/http/process only.
- **Tricky**: scheme validation *after* interpolation (a variable can smuggle a scheme);
  owner-invoked only — no agent/plugin access to the send capability; overriding a command
  variable suppresses its execution entirely.

### preview
- **Does**: renders the task's dev URL in a hardened WebContentsView with browser chrome;
  page-rule fills; agent browser driving (navigate/snapshot/click/fill/screenshot/console).
- **Node**: config + precedence resolution (recipe → run-target → repo config → setting; raw
  shell mode removed); URL resolution; browser rules; view-binding leases.
- **Client**: preview pane (80, ⌘⇧B) driving the client-core browser-view host service
  (sandboxed per-binding WebContentsView: ephemeral partition, no preload, permissions denied,
  chrome outside the guest; CDP driver with method allowlist; overlay-synchronized visibility) —
  the plugin holds no Electron code itself.
- **Data**: configurations + browser rules.
- **Depends**: terminal runTargets *(opt)*; agents *(opt)* consumes browser capabilities;
  core config trust for URL scripts.
- **Tricky**: for remote nodes, "localhost" means the node's host — the preview uses the
  protocol's tunnel streams (protocol.md § Streams) to reach declared task ports; local nodes
  skip it. Secret fills use CDP DOM primitives, never injected JS. Raw shell URL-script mode is
  removed (recorded parity divergence).

### linear
- **Does**: Linear browser: projects/issues + detail, comments, task promotion with branch
  suggestion, PR-text reference detection.
- **Node**: GraphQL ops via core http; normalized projections; reference detection;
  promotion/comment semantics.
- **Client**: linear source; linked-issue task pane (⌘⇧L); settings + setup.
- **Data**: normalized issue/project caches + freshness.
- **Depends**: none required; github *(opt)* consumes reference detection.
- **Tricky**: issue keys resolve only within a connection; comment creation persists an
  idempotency record before the provider call and reports `unknown-outcome` honestly.

### rollbar
- **Does**: read-only error browser: active items across connections, occurrence detail, task
  promotion (focuses existing task instead of duplicating), permalinks.
- **Node**: Rollbar API ops; strict allowlist normalizer for hostile payloads (bounded frames/
  fields; headers/cookies/bodies/IPs always dropped) — nothing raw is persisted or rendered.
- **Client**: rollbar source + task pane (⌘⇧O); lazy occurrence loading; settings.
- **Data**: normalized projections + freshness.
- **Depends**: none required; context *(opt)* diagnostic section.
- **Tricky**: normalization failure rejects the item (fail closed); widening the allowlist is a
  privacy decision, not a bug fix.

### model-providers
- **Does**: OpenAI + Anthropic as generic connections behind a `modelProviders.generate`
  capability (used by database SQL generation; available to future consumers).
- **Node**: per-provider adapters (request/response translation, catalogs, error mapping) over
  core http/secrets; small concurrency caps.
- **Client**: settings/wizard only (write-only key, test, default model); no pane/source.
- **Data**: catalog cache + health.
- **Depends**: consumers declare the capability optional.
- **Tricky**: prompts/responses never stored by this plugin; generation is never auto-retried
  after an ambiguous outcome; consumers own their routes (V1 decision, kept).

### profiles-claude / profiles-codex / profiles-aider
- **Does**: terminal/agent launch profiles. Claude: interactive + headless stream-JSON + resume
  + MCP registration. Codex: same shape (`codex exec --json`, `--output-schema`, resume). Aider:
  interactive-only.
- **Node**: launch spec (argv grammar — callers can't append flags), env policy, availability
  probe; claude/codex add a stream normalizer (provider JSON → common execution-event schema).
- **Client**: a picker row; consumers render everything.
- **Data**: none.
- **Depends**: terminal (interactive); agents/workflows *(opt)* consume headless execution.
- **Tricky**: distinct from agents' managed drivers — either works without the other. Codex's
  temp schema file is core-created, single-use, deleted on every exit path. Exit-zero without a
  result parses as `malformed`, not success.

### onboarding
- **Does**: first-run flow: workspace/repo setup, GitHub connection, optional V1 config import,
  disk-encryption check. Local node bootstraps silently first — onboarding never mentions
  distributed concepts.
- **Node**: setup-state evaluation + completion record in core settings.
- **Client**: first-run wizard + settings re-entry; setup-incomplete attention item.
- **Data**: none (completion state in core).
- **Depends**: github for connection setup; core importer.
- **Tricky**: completion commits only after invariants verify — a crash mid-setup resumes, never
  half-done. The V1 importer scope is exactly: workspace names/colors/order, repo membership,
  checkout paths (re-validated), repo config text (arriving untrusted), branch prefix. Never
  tokens, tasks, notes, memories, terminals, or preferences.
