# Phase 3: workspace, project, task, and managed agent writes

Status: proposed implementation handoff, 2026-09-27. Depends on Phases 1 and 2.

## Outcome and rationale

A script can choose or create a workspace, register a local project in it, create a task, and start
one or more managed agent sessions with prompts. It can later list, inspect, follow, and wait for
those sessions from another process. Each command is one explicit Node operation with typed input
and output. The task and managed agent ledgers remain the authority for execution state.

The first shared-write journey is:

```sh
set -o pipefail
acorn workspace create --name "Platform" --output json |
  acorn project add --workspace - --path /srv/repos/api --output json |
  acorn task create --project - --title "Investigate timeout" --branch timeout-review --output json |
  acorn agent start --task - --profile codex --prompt-file brief.md --output json
```

The path is on the selected Node host. Branch/worktree setup can execute project configuration;
the command must make that effect visible in help and error output. An agent command returns after
its first turn is accepted into the queue, while the Node keeps running it.

## Work to deliver

1. Deliver the workspace and project administration in
   [workspace-and-project-commands.md](./workspace-and-project-commands.md). Its create/add path
   comes first so a CLI user can establish a task's project. Its rename, move, visibility, remove,
   configuration, and external-project mapping commands are bounded follow-ups within this phase.
   Require explicit workspace selection for project registration and preserve the distinction
   between local folders and provider projects.
2. Implement `task create --project ID --title TEXT [--branch NAME] [--skip-setup]`. Send
   `origin: "local"` unless a later explicit origin contract is justified. Match the client
   creation sequence: `POST /v1/core/tasks` followed by `POST /v1/core/tasks/:id/on-created`.
   That hook seeds notes and may prepare a worktree or run project setup. Decide whether core should
   expose one atomic application service for this pair; if retained as two calls, surface a partial
   result with the created task ID and a retryable setup step. The CLI must not report a wholly
   failed create when the task row exists.
3. Add `agent providers`, `agent list [--task|--workspace]`, `agent show`, `agent start`,
   `agent send`, `agent events`, and `agent wait`. Use the Agents plugin's provider/profile roster,
   session create, turn enqueue, snapshot, durable event page, and wait routes. `start` needs a task,
   provider/profile, and prompt. Choose interactive session kind as the initial default and show
   provider-specific requirements from the server. Accept `--prompt TEXT` or `--prompt-file PATH|-`;
   enforce the route's size and input-part constraints before sending. A prompt is not a shell
   command. `send` queues a turn on an existing session; its output is an acknowledgement, not a
   completed response.
4. Define how `agent start` composes session create and first-turn enqueue. Each route already has
   domain-level idempotency and requires an `Idempotency-Key`. Preserve a stable key per operation
   across a caller retry, expose both the session and turn IDs in success/partial responses, and
   never create a second session just because enqueue failed. A caller-provided `--request-id UUID`
   or a persisted local operation record is needed for a new CLI process to retry safely. Document
   its scope and retention. The generic device middleware also accepts a UUID key for other
   mutations and replays saved non-5xx responses; use it for workspace, project, and task writes.
   Its save occurs after the domain write, so a crash in that gap still needs resource inspection
   and may motivate intended resource IDs in core.
5. Use one resource schema for agent session snapshots and separate schemas for turn acknowledgements
   and event records. `events --follow` pages the durable event ledger, then uses WebSocket notices
   only to trigger more reads. Resume after reconnect from the last durable sequence. For `wait`,
   compose the route's bounded wait calls under one CLI `--timeout`; preserve attention, failure,
   cancellation, and success as distinct states. Ctrl+C ends local following, not the agent.

## Scope and policy

Managed agents are not the raw terminal PTY sessions. They can run in a task worktree, create
artifacts, request approval, and use contributed tools under the Agents plugin's policy. A CLI
command does not approve requests on its own or bypass the Node's task scope and authorization.
Multiple sessions may be launched for a task, but the CLI should warn when they will share a
worktree; it does not promise conflict isolation. A workflow child-task step is the route to isolated
parallel branches. If `agent start` is exposed as a multi-session convenience later, each session
needs its own explicit prompt, provider/profile, idempotency key, and result ID; partial failure
must be inspectable.

Workspace and project lists are machine-scoped but authenticated. A workspace name and project name
are display labels, not unique identifiers. The pipe validates `kind` and `nodeId`, then passes the
ID. `project add --path` must detect duplicate registration consistently with core rather than
creating a second project row for a different spelling of the same path.

## Tests and acceptance

- Create a workspace, add a project to it, list both from a second CLI process, and pipe the project
  resource into task creation. Repeat with two workspaces containing projects with the same display
  name; ID-based selection remains unambiguous. A remote relative path fails before a write.
- Create a task in a Git project and a non-Git project. Verify title, `origin`, branch behavior,
  notes seed, setup hook, and the final worktree state match the desktop creation path. Inject a
  failure after task row creation; the CLI reports the task ID and recoverable step.
- Start an agent using a file prompt, inspect its session, send a second turn, page and follow
  events, and wait until completion. Run the read commands in a fresh process. Test attention,
  failure, timeout, Ctrl+C, and an event sequence gap.
- Replay identical UUID keys after a lost response and verify no duplicate workspace, project,
  task, session, or turn. Reusing a key with a different body yields a conflict. Inject a crash
  between task create and hook, and between session create and turn enqueue, then prove a recovery
  command can find and finish the existing resource.
- Validate JSON output schemas, stdout/stderr separation, maximum prompt size, typed stdin,
  wrong-Node pipes, and a command attempting to consume stdin twice.

## Verify before building

- Read `packages/node-core/src/server/routes/projects/workspaces.ts`, `projects.ts`, `tasks.ts`,
  and `worktree.ts`; `packages/client-core/src/features/tasks/taskMutations.ts`; and
  `packages/node-core/src/server/middleware/idempotency.ts`.
- Read `plugins/agents/src/server/routes/managed.ts`, `plugins/agents/src/shared/schemas.ts`, and
  [managed agents](../../managed-agents.md) before naming flags or output fields.
- After implementation run `pnpm lint`, focused core and Agents plugin tests, and the cases in
  [verification](./verification.md).
