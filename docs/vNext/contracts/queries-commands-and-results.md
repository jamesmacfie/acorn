# Queries, commands and results

Status: **Normative**
Requirement prefix: `CON-QUERY` / `CON-CMD`

## Queries

`POST /v2/queries/{queryId}` executes a manifest/core-declared side-effect-free query. `queryId` is a
lowercase reverse-DNS identifier such as `acorn.core.tasks.list.v2`. Input and output are validated
against the descriptor's exact schema digests.

- **CON-QUERY-001** Queries MUST NOT mutate durable state, refresh an external provider, trigger a
  process or acknowledge an event. Such behavior is a command.
- **CON-QUERY-002** Responses include `observedAt`, `snapshotSequence` and per-resource revision.
  Provider-backed data additionally includes `freshness: live|stale|offline` and `sourceObservedAt`.
- **CON-QUERY-003** Query cursors are opaque, authorization-bound and limited as defined in
  [`resource-identities.md`](resource-identities.md).

## Command envelope

`POST /v2/commands` accepts:

| Field | Type | Rule |
| --- | --- | --- |
| `apiVersion` | string | `acorn.dev/command/v2` |
| `commandId` | UUIDv7 | idempotency identity |
| `command` | string | declared reverse-DNS operation ID |
| `target` | Acorn URI | exactly one owning Node |
| `expectedRevision` | decimal/null | required by operation declaration |
| `sessionRevision` | decimal | current negotiated session |
| `deadline` | timestamp | no more than operation maximum |
| `input` | object | exact command schema |

- **CON-CMD-001** Command authorization is evaluated from authenticated device, target, requested
  operation and delegated capability chain. Payload claims never grant permission.
- **CON-CMD-002** Validation, authorization, revision comparison and idempotency conflict detection
  happen before side effects.
- **CON-CMD-003** A command definition MUST state its commit point, maximum duration, cancellability,
  retry class, expected events, input/output schema and required capabilities.
- **CON-CMD-004** State commit and outbox append MUST share one SQLite transaction. External effects
  use an operation/saga record and idempotent adapter; they MUST NOT be represented as committed
  before the durable state can reconcile them.

## Results

Terminal command results are a closed discriminated union:

- `committed`: mutation committed; includes `resourceRevision`, `eventSequence` and result;
- `accepted`: durable operation created; includes an operation URI and current revision; or
- `cancelled`: cancellation committed before the operation commit point; includes
  `cancelledAt`, the stable `cancelled` code and no result;
- `failed`: terminal failure persisted; includes `failedAt`, stable operation error code,
  `retryable`, safe message, bounded safe details and no result; or
- a replay of any terminal result: semantically identical to the stored original with
  `replayed: true`.

HTTP `202` is used only for `accepted`; every terminal variant and replay uses `200`. Pre-dispatch
HTTP failures use the normal error envelope and are not stored command results. Once an asynchronous
command has been accepted, its terminal failure is represented only by the `failed` variant so
polling and event-driven clients observe the same durable outcome.

## Idempotency

- **CON-CMD-005** The Node stores `commandId`, device ID, operation, target, canonical input hash and
  terminal result for at least seven days.
- **CON-CMD-006** It stores a command tombstone containing identity and input hash for 30 days.
  Reuse with different content/device returns `idempotency_conflict`; same-content retry after the
  result expires returns `idempotency_result_expired` and MUST NOT re-execute.
- **CON-CMD-007** Command UUID timestamp must be no more than 120 seconds in the future or 30 days
  old. Invalid age returns `command_id_out_of_range`.

## Cancellation

`DELETE /v2/commands/{commandId}` requests cancellation. Before the commit point it MUST persist
`cancelled` and compensate completed saga steps. After commit it returns `already_committed`.
Uncancellable operations return `not_cancellable`. Connection loss never implies cancellation.

## External calls and sagas

A multi-step command records each step, idempotency key, attempt, result and compensation state.
Recovery resumes from durable state. Cross-plugin sagas use capability calls; cross-Node sagas are
prohibited. A compensation failure enters `manual_intervention` and emits a redacted attention
event.

## Core worktree operation family

Core, not Terminal or a plugin, owns the following complete V2 worktree family. All paths are
generated or resolved by core and never accepted as host absolute paths.

| Operation | Kind | Exact input | Result and committed fact |
| --- | --- | --- | --- |
| `acorn.core.worktrees.list.v2` | query | `repository` URI; `cursor` string/null; `limit` integer 1–100, default 50 | bounded items `{worktree, repository, branch, status, task|null, revision}` |
| `acorn.core.worktrees.get.v2` | query | target worktree URI | the same item plus safe relative display path and dirty summary |
| `acorn.core.worktree.create.v2` | command | `repository` URI; `branch` validated ref; `baseRef` validated ref; `task` URI/null; `open` boolean, default false | worktree URI; `acorn.core.worktree.created.v2`, then optionally `opened` |
| `acorn.core.worktree.open.v2` | command | `task` URI/null; `focusClient` boolean, default false | updated association; `acorn.core.worktree.opened.v2` |
| `acorn.core.worktree.adopt.v2` | command | `repository` URI; `relativePath` rooted repository-relative path; `task` URI/null | adopted worktree URI; `acorn.core.worktree.adopted.v2` |
| `acorn.core.worktree.remove.v2` | command | `forceDirty` boolean, default false; `deleteBranch` boolean, default false | tombstone; `acorn.core.worktree.removed.v2` |

- **CON-CMD-008:** Every worktree operation authenticates the paired owner device or a delegated
  plugin caller. Queries require `core.worktree` `list`/`read`; commands require their exact
  `create`, `open`, `adopt` or `remove` operation and a repository selector containing the
  authoritative repository. Plugin grants MUST set `pathMode: core-managed-only`; no capability
  permits choosing an arbitrary worktree root.
- **CON-CMD-009:** Create/adopt/remove require `expectedRevision`; open requires it when changing an
  existing association. Create and remove are idempotent by command envelope and semantic target.
  A same-input retry replays its stored result; a different branch/path/flags input conflicts.
  Queries are safely retryable. Open is safely retryable after commit.
- **CON-CMD-010:** Create/adopt use a durable saga. Their commit point is insertion of the
  authoritative worktree record after Git verifies the directory and identity; pre-commit failure
  removes only the core-created candidate path. Remove's commit point is the tombstone after Git
  removal succeeds. Dirty removal requires `allowDirtyRemoval: true`, `forceDirty: true` and
  high-friction owner confirmation. Branch deletion is a separate Git-authorized saga step.
- **CON-CMD-011:** Default timeout is 60 seconds and maximum is five minutes. Commands are
  cancellable before commit; post-commit cancellation returns `already_committed`. Node restart
  reconciles the saga by repository/worktree identity and never repeats a destructive step without
  its recorded idempotency outcome. Expected errors are `not_found`, `revision_conflict`,
  `branch_invalid`, `branch_exists`, `path_conflict`, `repository_busy`, `worktree_dirty`,
  `confirmation_required`, `capability_denied`, `deadline_exceeded`, `cancelled`,
  `already_committed` and `manual_intervention`.
- **CON-CMD-012:** `focusClient` is advisory presentation only. A remote Node event cannot focus
  Electron. When true, the command result carries a navigation intent that the initiating Client
  may honor under current user-presence policy; other Clients receive only the committed fact.
