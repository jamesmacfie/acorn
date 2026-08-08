# API reference

The Node exposes one Hono application under `/v2`. It serves JSON routes and one authenticated
WebSocket. It serves no HTML, JavaScript, or static assets.

Route and response types live in `packages/protocol/src/api.ts`; the server composition is
`packages/node-core/src/server/index.ts`; plugin route declarations are registered by each Node
plugin. The table below is the current route map by responsibility. Use the route modules for fields
and validation details when changing a contract.

## Transport

| Surface | Path | Auth |
| --- | --- | --- |
| Node probe | `GET /v2/node` | pre-auth; unauthenticated response is limited |
| Pairing | `POST /v2/pair` | pre-auth; consumes a one-time code |
| Core | `/v2/core/*` | device or permitted internal principal |
| Plugin | `/v2/p/<plugin>/*` | device or permitted internal principal |
| Events/streams | `GET /v2/events` | authenticated WebSocket upgrade |

All responses carry `X-Request-Id`. Errors use:

```json
{
  "error": {
    "code": "not_found",
    "message": "No such resource.",
    "requestId": "…",
    "retryable": false,
    "details": {}
  }
}
```

The `details` member is optional. Route handlers use domain-specific codes where the client needs to
branch; otherwise the transport codes are `bad_request`, `unauthorized`, `forbidden`, `not_found`,
`revision_conflict`, `idempotency_conflict`, `provider_error`, `rate_limited`, `timeout`, and
`internal`.

## Request processing

`createApp()` applies the following order:

1. request-id assignment;
2. principal resolution from a device bearer or `x-acorn-internal`;
3. the two pre-auth pairing routes;
4. the `requireUser` auth gate;
5. idempotency replay for device mutations;
6. device-only, task-scope, provider-scope, and route-specific gates;
7. core and plugin routers.

`Idempotency-Key` is optional for most mutations and required by agent session creation, agent-turn
enqueue, and request resolution. A device-keyed replay stores the request hash and final response;
reuse with a different body returns `idempotency_conflict`. Internal callers have no device replay
namespace.

## Core routes

### Node administration

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v2/core/pair/start` | Open a ten-minute pairing window |
| `DELETE` | `/v2/core/pair` | Close the pairing window |
| `GET` | `/v2/core/devices` | List paired devices |
| `DELETE` | `/v2/core/devices/:id` | Revoke a device |
| `GET` | `/v2/core/plugins` | List plugin status and capabilities |
| `PUT` | `/v2/core/plugins/:name` | Enable/disable an optional plugin |
| `GET` | `/v2/core/audit` | Read the retained audit trail |
| `GET` | `/v2/core/security` | Read Node security posture |
| `GET` | `/v2/core/backup` | Suggest a destination path for a backup |
| `POST` | `/v2/core/backup` | Create a credential-scrubbed database archive |
| `GET` | `/v2/core/import/v1` | Inspect a source root without importing |
| `POST` | `/v2/core/import/v1` | Import configuration from a copied V1 database |

These routes are device-only. Backup and import use Node filesystem paths, so an internal task token
must not reach them.

### Preferences and integrations

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v2/core/prefs` | Read Node-scoped preferences |
| `PUT` | `/v2/core/prefs` | Upsert one preference |
| `GET` | `/v2/core/integrations` | List provider descriptors and connection state |
| `POST` | `/v2/core/integrations` | Create/validate an integration |
| `PUT` | `/v2/core/integrations/:id` | Replace credentials/configuration |
| `PATCH` | `/v2/core/integrations/:id` | Enable or disable a connection |
| `POST` | `/v2/core/integrations/:id/test` | Test provider connectivity |
| `DELETE` | `/v2/core/integrations/:id` | Disconnect and cascade provider data |

Integration administration is restricted to device and Node service principals. Secret values are
write-only.

### Workspaces and tasks

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v2/core/workspaces` | List workspaces and visible repository membership |
| `POST` | `/v2/core/workspaces/bootstrap` | Initialize the default workspace |
| `POST` | `/v2/core/workspaces` | Create a workspace |
| `PATCH` | `/v2/core/workspaces/:id` | Update workspace identity |
| `DELETE` | `/v2/core/workspaces/:id` | Delete a non-default workspace |
| `POST` | `/v2/core/workspaces/:id/repos` | Assign a repository to a workspace |
| `GET` | `/v2/core/workspaces/assignments` | List repository-to-workspace assignments and ignore state |
| `POST` | `/v2/core/workspaces/ignore-repo` | Hide one repository from workspace selection |
| `POST` | `/v2/core/workspaces/unignore-repo` | Show one repository in workspace selection |
| `POST` | `/v2/core/workspaces/ignore-all` | Hide or show every mirrored repository |
| `GET` | `/v2/core/workspaces/:id/projects` | List external projects linked to a workspace |
| `PUT` | `/v2/core/workspaces/:id/projects` | Replace external projects linked to a workspace |
| `GET` | `/v2/core/tasks` | List active tasks on this Node |
| `POST` | `/v2/core/tasks` | Create a task |
| `PATCH` | `/v2/core/tasks/:id` | Update task metadata or archive/activate a task |
| `POST` | `/v2/core/tasks/:id/links` | Add an external item link |
| `DELETE` | `/v2/core/tasks/:id/links` | Remove an external item link |
| `GET` | `/v2/core/tasks/:id/context` | Assemble task context |
| `GET` | `/v2/core/tasks/:id/tools` | List task agent tools |
| `POST` | `/v2/core/tasks/:id/tools/:name` | Invoke an authorized task tool |
| `GET` | `/v2/core/agent-tools` | Catalog tools for Settings |

Task-addressed routes are guarded by the `taskId` in a task-scoped internal token. Task lifecycle,
worktree, run-target, and repo-config authority remains in core.

### Worktrees, configuration, and run targets

The core worktree router covers repository paths and task lifecycle surfaces, including:

```text
/v2/core/task-statuses
/v2/core/repos/path
/v2/core/repos/path/run-targets
/v2/core/repos/path/config
/v2/core/tasks/:id/{preview-url,on-created,use-checkout,archive}
/v2/core/tasks/:id/{mcp,mcp/starter}
/v2/core/tasks/:id/config-trust
/v2/core/tasks/:id/run/*
```

The exact method/body contracts are in `packages/node-core/src/server/routes/worktree.ts`,
`configTrust.ts`, and `harness.ts`. Executable repo configuration is hash-gated before it can be
used.

## Plugin routes

Plugin routes are mounted under the plugin's registry namespace. Some modules retain an internal
segment, so the literal path can contain the plugin name twice; route builders in `protocol/api.ts`
are authoritative.

### GitHub

| Path family | Purpose |
| --- | --- |
| `/v2/p/github/auth/device/*` | GitHub OAuth device-flow start and poll |
| `/v2/p/github/pins` | Pinned repository state |
| `/v2/p/github/repos` | Repository mirror and refresh |
| `/v2/p/github/repos/:owner/:repo/pulls` | Open/closed PR lists, batch prefetch, create PR |
| `/v2/p/github/repos/:owner/:repo/pulls/:number` | PR detail, files, blob bodies, and write actions |
| `/v2/p/github/repos/:owner/:repo/actions/*` | Actions jobs/logs and rerun |
| `/v2/p/github/repos/:owner/:repo/labels` | Label choices |
| `/v2/p/github/repos/:owner/:repo/mentions` | Mention autocomplete participants |

GitHub reads use the plugin SQLite mirror with TTL/ETag revalidation where supported. Patch and file
bodies use the shared immutable blob cache. GitHub writes update or invalidate the affected mirror.

### Agents

```text
/v2/p/agents/providers
/v2/p/agents/usage
/v2/p/agents/pricing
/v2/p/agents/sessions
/v2/p/agents/sessions/:id
/v2/p/agents/sessions/:id/events
/v2/p/agents/sessions/:id/turns
/v2/p/agents/sessions/:id/requests/:requestId/resolve
/v2/p/agents/sessions/:id/{cancel,fork,compact,wait,export}
/v2/p/agents/attachments[/:id]
/v2/p/agents/artifacts/:id/content
```

Sessions persist normalized event history and expose paged HTTP reads plus live WebSocket updates.

### Terminal, workflows, and execution

```text
/v2/p/terminal/sessions*
/v2/core/tasks/:id/{archive,preview-url,on-created,use-checkout,mcp}
/v2/p/workflows/tasks/:id/workflows*
/v2/p/workflows/workflows/runs/:runId/*
```

The terminal plugin owns session control and stream attachment. Core owns worktrees and run-target
execution. Workflows own durable definitions, runs, steps, gates, and reconciliation.

### Notes and memory

```text
/v2/p/notes/tasks/:id/notes[/*]
/v2/p/notes/workspaces/:wsId/notes[/*]
/v2/p/memory/memory[/*]
```

The notes plugin owns the current notes namespace. The memory plugin's note paths under
`/v2/p/memory/tasks/.../notes` and `/v2/p/memory/workspaces/.../notes` are deprecated compatibility
aliases for one release and resolve through the same notes store.

### Other feature plugins

| Plugin | Current route surface |
| --- | --- |
| `changes` | task-local Git actions and review notes |
| `database` | task-scoped PostgreSQL schema/query operations |
| `docker` | Node inventory and task container actions |
| `editor` | task file reads/writes and search |
| `http` | encrypted request/variable storage and send |
| `memory` | memory entries and proposals; deprecated notes aliases |
| `notes` | task, workspace, and global note CRUD |
| `linear` | projects, issues, comments, and reference resolution |
| `rollbar` | normalized items, occurrences, and details |
| `preview` | preview rules and browser-agent operations |

## WebSocket

`/v2/events` carries sequence-numbered events and feature frames. The event stream is a live
invalidation channel, not a durable replication log. After reconnect or a sequence gap, the client
marks the Node stale and refetches. Durable agent and workflow history is read from plugin tables.

PTY output, Docker logs/stats/exec, workflow notices, agent streams, and preview tunnels use the
same authenticated socket with feature-specific frames and bounded backpressure/replay semantics.
