# Terminal, command execution, Git, worktrees, and files

These are plugin-owned public routes. All paths are relative to `/api/v1`; every route begins with
`/plugins/<plugin-id>`. They are documented together because they share the task → confined
worktree boundary and because process execution is the highest-risk part of the API.

## 1. Cross-cutting execution rules

- Resolve the task and its cwd server-side. Ignore/reject caller-supplied absolute cwd values.
- Use `resolveTaskCwd` and realpath/symlink confinement for every file/Git/process operation.
- Require repo-config trust before executing commands sourced from `.acorn/config.toml`.
- An ad-hoc command supplied directly by a write-scoped API caller does not require repo-config
  trust; the bearer itself is the authorization. Record its actor/token id and never log its text.
- Do not run through string interpolation. When the contract is argv-shaped, spawn argv directly.
  Shell-shaped endpoints deliberately invoke the user's configured shell with one command string.
- Strip Acorn secrets from inherited environments unless a profile explicitly needs its internal
  agent environment. Public ad-hoc commands must not inherit `INTERNAL_TOKEN`,
  `SESSION_ENC_KEY`, GitHub/integration credentials, or the public bearer.
- Bound captured output and time. PTY output remains transient and streams through WebSocket.
- A read token can inspect status/output metadata; only write can spawn, input, signal, or remove.

## 2. Terminal schemas

```ts
const AgentStateSchema = z.enum([
  'starting', 'working', 'waiting', 'idle', 'blocked', 'permission', 'done', 'unknown',
])

const TerminalSessionSchema = z.strictObject({
  id: IdSchema,
  taskId: IdSchema,
  title: z.string(),
  kind: z.enum(['shell', 'agent']),
  profileId: z.string(),
  backend: z.enum(['node-pty', 'tmux']),
  status: z.enum(['running', 'exited']),
  idle: z.boolean(),
  agentState: AgentStateSchema,
  isWorktree: z.boolean(),
  cwd: z.string(),
  commandLabel: z.string(), // redacted/display label, not necessarily the raw command
  tmuxSession: z.string().optional(),
  repo: z.strictObject({ owner: OwnerSchema, name: RepoNameSchema }).optional(),
  pull: z.strictObject({ number: z.number().int().positive() }).optional(),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
  createdAt: UnixMillisSchema,
  exitedAt: UnixMillisSchema.nullable(),
  exitCode: z.number().int().nullable(),
})

const TerminalProfileSchema = z.strictObject({
  id: z.string().min(1).max(100),
  label: z.string(),
  kind: z.enum(['shell', 'agent']),
  available: z.boolean(),
  tmuxMissing: z.boolean().optional(),
})

const EnvironmentSchema = z.record(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  z.string().max(64_000),
).refine((v) => Object.keys(v).length <= 200)

const CreateTerminalSessionSchema = z.discriminatedUnion('launch', [
  z.strictObject({
    launch: z.literal('profile'),
    profileId: z.string().min(1).max(100).default('shell'),
    title: z.string().trim().min(1).max(240).optional(),
    cols: z.number().int().min(1).max(1000).default(120),
    rows: z.number().int().min(1).max(1000).default(40),
  }),
  z.strictObject({
    launch: z.literal('command'),
    command: z.string().min(1).max(100_000),
    env: EnvironmentSchema.default({}),
    title: z.string().trim().min(1).max(240).optional(),
    durable: z.boolean().default(true),
    cols: z.number().int().min(1).max(1000).default(120),
    rows: z.number().int().min(1).max(1000).default(40),
  }),
])
```

Do not expose the raw command in list responses by default; terminals commonly contain secrets in
their invocation. `commandLabel` is the profile label or explicit title. A future privileged inspect
endpoint would need a separate threat decision.

## 3. Terminal endpoints

Base: `/plugins/terminal`.

| Method | Path | Scope | Payload | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/profiles` | `read` | — | bounded `TerminalProfile[]` |
| `GET` | `/sessions` | `read` | page + `taskId?`, `status?`, `kind?` | page of sessions |
| `POST` | `/tasks/:taskId/sessions` | `write` | `CreateTerminalSession`; idempotency required | `201 TerminalSession` |
| `GET` | `/sessions/:sessionId` | `read` | — | session |
| `POST` | `/sessions/:sessionId/interrupt` | `write` | no body | updated session |
| `POST` | `/sessions/:sessionId/kill` | `write` | no body | updated session |
| `DELETE` | `/sessions/:sessionId` | `write` | query `force=false` | `204` |
| `POST` | `/sessions/:sessionId/resize` | `write` | `{ cols, rows }` | updated session |
| `POST` | `/sessions/:sessionId/send` | `write` | agent send payload | send result |

```ts
const ResizeTerminalSchema = z.strictObject({
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
})

const SendToAgentSchema = z.strictObject({
  text: z.string().min(1).max(1_000_000),
  submit: z.enum(['now', 'after-ready', 'draft']),
})

const AgentSendResultSchema = z.strictObject({
  sent: z.boolean(),
  queued: z.boolean(),
  reason: z.string().optional(),
})
```

Raw interactive input is sent through the public WebSocket's `terminal.input` frame, not JSON POST
per keystroke. `send` preserves the current higher-level agent semantics. Deleting a running session
without `force=true` returns `409 session_running`; `force` kills then removes.

Terminal creation does not implicitly open the UI drawer. Invoke `core.terminal.focus` if visual
presentation is wanted. This separation makes terminal automation work when no renderer is open.

## 4. Captured command executions

Terminal sessions are interactive and transient. Automation also needs a bounded, queryable command
result. Add a terminal-plugin execution resource rather than making the create request wait for an
unbounded command.

```ts
const CreateExecutionSchema = z.strictObject({
  command: z.string().min(1).max(100_000),
  env: EnvironmentSchema.default({}),
  timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000),
  maxOutputBytes: z.number().int().min(1_024).max(10_485_760).default(1_048_576),
})

const ExecutionSchema = z.strictObject({
  id: IdSchema,
  taskId: IdSchema,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed-out']),
  createdAt: UnixMillisSchema,
  startedAt: UnixMillisSchema.nullable(),
  completedAt: UnixMillisSchema.nullable(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  outputTruncated: z.boolean(),
})
```

| Method | Path | Scope | Payload | Response |
| --- | --- | --- | --- | --- |
| `POST` | `/tasks/:taskId/executions` | `write` | `CreateExecution`; idempotency required | `202 Execution` |
| `GET` | `/executions/:executionId` | `read` | query `includeOutput=false` | execution |
| `POST` | `/executions/:executionId/cancel` | `write` | no body | updated execution |

Execution stdout/stderr streams as events. Persist only bounded final metadata and output if product
requirements confirm history is wanted; otherwise keep results in a bounded in-memory TTL store and
document `410 execution_expired`. The implementation plan recommends a 24-hour SQLite record with
bounded output because HTTP clients need to reconnect after app restarts.

## 5. Repository checkout mapping and worktrees

Base remains `/plugins/terminal` because the terminal/worktree runtime currently owns checkout
discovery and lazy worktree creation.

```ts
const RepoPathSchema = z.strictObject({
  owner: OwnerSchema,
  repo: RepoNameSchema,
  path: z.string().min(1).max(4096),
  runTargets: z.array(z.strictObject({
    id: z.string().min(1).max(100),
    command: z.string().min(1).max(100_000),
    stop: z.string().max(100_000).optional(),
    restart: z.string().max(100_000).optional(),
    url: z.url().optional(),
    urlCommand: z.string().max(100_000).optional(),
    icon: z.string().max(100).optional(),
    default: z.boolean().optional(),
  })).max(100),
})

const PutRepoPathSchema = z.strictObject({ path: z.string().min(1).max(4096) })
const PutRunTargetsSchema = z.strictObject({ runTargets: RepoPathSchema.shape.runTargets })
```

| Method | Path | Scope | Payload | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/repositories/:owner/:repo/checkout` | `read` | — | checkout mapping or `404` |
| `PUT` | `/repositories/:owner/:repo/checkout` | `write` | `{ path }` | validated mapping |
| `PUT` | `/repositories/:owner/:repo/run-targets` | `write` | complete target set | mapping |
| `GET` | `/tasks/:taskId/worktree` | `read` | — | task worktree status |
| `POST` | `/tasks/:taskId/worktree/create` | `write` | no body | worktree status |
| `POST` | `/tasks/:taskId/worktree/adopt-checkout` | `write` | no body | worktree status + actual branch |
| `DELETE` | `/tasks/:taskId/worktree` | `write` | query `force=false` | `204` |
| `GET` | `/tasks/:taskId/mcp` | `read` | — | MCP config files and safe server summaries |
| `POST` | `/tasks/:taskId/mcp/starter` | `write` | no body | starter-file creation result |

The `PUT checkout` handler validates that the path exists, is a Git checkout for the named remote
repo, and can be realpathed. The API intentionally does not invoke the native folder chooser.
MCP inspection never returns environment secret values; starter creation is idempotent and refuses
to overwrite an existing file with different content.

## 6. Run targets

Base: `/plugins/terminal/tasks/:taskId/run-targets`.

| Method | Relative path | Scope | Payload | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/` | `read` | — | merged config targets, layout recipes, and named parse errors |
| `GET` | `/:targetId` | `read` | — | target definition + live status |
| `POST` | `/:targetId/start` | `write` | no body | run status/session id |
| `POST` | `/:targetId/stop` | `write` | no body | run status |
| `POST` | `/:targetId/restart` | `write` | no body | run status/session id |

Starting/restarting a repo-configured target applies the existing config-trust gate. Trust failure is
`409 config_trust_required` with the task id and current config hash, never a hanging request.

## 7. Git schemas

Base: `/plugins/changes/tasks/:taskId/git`.

```ts
const LocalChangeSchema = z.strictObject({
  path: RelativePathSchema,
  status: z.enum(['modified', 'added', 'deleted', 'renamed', 'untracked']),
  oldPath: RelativePathSchema.optional(),
  staged: z.boolean(),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
})

const GitPathsSchema = z.discriminatedUnion('selection', [
  z.strictObject({ selection: z.literal('paths'), paths: z.array(RelativePathSchema).min(1).max(1000) }),
  z.strictObject({ selection: z.literal('all') }),
])

const DiscardSchema = z.discriminatedUnion('selection', [
  z.strictObject({
    selection: z.literal('paths'),
    paths: z.array(z.strictObject({ path: RelativePathSchema, untracked: z.boolean().default(false) })).min(1).max(1000),
  }),
  z.strictObject({ selection: z.literal('all'), includeUntracked: z.boolean().default(false) }),
])

const CommitSchema = z.strictObject({
  message: z.string().min(1).max(100_000),
})

const GitActionSchema = z.strictObject({
  changed: z.boolean(),
  summary: z.string().max(20_000).optional(),
})
```

## 8. Git endpoints and command payloads

| Method | Path | Scope | Payload/query | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/status` | `read` | — | `{ changes: LocalChange[], branch, ahead, behind }` |
| `GET` | `/diff` | `read` | `path`, `scope=staged` or `unstaged` | bounded patch |
| `GET` | `/blob` | `read` | `path`, `ref?` | bounded UTF-8 text |
| `POST` | `/stage` | `write` | `GitPaths` | `GitAction` |
| `POST` | `/unstage` | `write` | `GitPaths` | `GitAction` |
| `POST` | `/discard` | `write` | `Discard` | `GitAction` |
| `POST` | `/commit` | `write` | `Commit` | `{ commitSha, summary }` |
| `POST` | `/push` | `write` | no body | `GitAction` |

This is the complete explicit Git action set currently present in the UI: status/diff/blob,
stage/unstage/discard by file or all, commit, and push. Arbitrary Git subcommands remain possible via
the write-scoped command execution endpoint; do not add a second weakly validated `/git/exec` alias.

Rules:

- `stage`/`unstage`/`discard` arrays execute as one requested operation and return non-2xx if any
  path fails; do not claim partial success without an explicit per-path result schema;
- `discard` is irreversible and must not be mapped to `GET` or a generic command id;
- commit rejects an empty/whitespace-only message;
- push uses the task branch's configured upstream, matching the UI. Missing upstream is
  `409 upstream_not_configured`; `v1` does not accept arbitrary credentials/remotes in the body;
- patches/blobs have a response byte cap (default 5 MiB) and return `413 response_too_large` with
  metadata if exceeded rather than silently truncating source content.

## 9. Editor and search schemas

Base: `/plugins/editor/tasks/:taskId`.

```ts
const FileEntrySchema = z.strictObject({
  name: z.string(),
  path: RelativePathSchema,
  kind: z.enum(['file', 'directory']),
})

const FileContentSchema = z.strictObject({
  path: RelativePathSchema,
  content: z.string(),
  encoding: z.literal('utf8'),
  version: z.string(), // content hash used for optimistic writes
})

const WriteFileSchema = z.strictObject({
  content: z.string().max(10_485_760),
  expectedVersion: z.string().optional(),
})

const SearchSchema = z.strictObject({
  query: z.string().min(1).max(4096),
  glob: z.string().max(4096).optional(),
  caseSensitive: z.boolean().default(false),
  maxResults: z.number().int().min(1).max(1000).default(200),
})

const SearchMatchSchema = z.strictObject({
  path: RelativePathSchema,
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  preview: z.string().max(20_000),
})
```

## 10. Editor and search endpoints

| Method | Path | Scope | Payload/query | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/root` | `read` | — | display root metadata |
| `GET` | `/files` | `read` | optional `query`, `limit`, `cursor` | page of worktree paths |
| `GET` | `/entries` | `read` | `path` (empty means root) | bounded directory entries |
| `GET` | `/file` | `read` | `path` | `FileContent` |
| `PUT` | `/file` | `write` | query `path`; `WriteFile` | updated `FileContent` |
| `POST` | `/search` | `read` | `Search` | bounded matches + truncation flag |

Search is a read operation even though it uses `POST` to carry an arbitrary structured query; scope
is declared explicitly rather than inferred only from method. `PUT file` with a mismatched
`expectedVersion` returns `409 file_changed`. Atomic write/rename should prevent partial content.

The UI currently has no delete/rename file operation, so those are not in `v1`. Add them later as
explicit endpoints if the product gains them; do not smuggle them through `PUT` flags.

## 11. Verification cases

- every path traversal, absolute path, NUL, symlink escape, and missing-worktree case fails closed;
- read tokens cannot create/input/signal terminals, execute commands, mutate worktrees, Git, or files;
- secret environment keys are stripped and response/log redaction is tested;
- PTY output subscription is task/session-authorized and revocation closes input capability;
- captured execution enforces timeout and byte cap and survives/reconciles restart as specified;
- config-trust applies to every run-target path;
- Git arrays are atomic or accurately report a designed partial-result type;
- file optimistic version conflicts do not overwrite disk;
- public terminal/Git/editor adapters and existing UI adapters call the same services in tests.
