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

## Versioning

**One number, one meaning.** `NODE_PROTOCOL_VERSION` (`packages/protocol/src/node.ts`) is the
protocol major, and it is the entire compatibility contract — there is no minor, no capability
negotiation and no feature handshake. Each side refuses a major it does not speak: the pairing probe
refuses before pairing, and the broker re-probes `GET /v2/node` on every connect, producing the
`incompatible` connection state and the `protocol_mismatch` error code. Checking only at pairing is
not enough, because a paired node upgrades — usually by restarting, which drops the socket, so the
reconnect is where a new major shows up.

**Within a major, changes are additive only.** New routes, new optional response fields and new
WebSocket channels are all safe. Renaming a field, removing one, or changing what one means is the
next major, not a patch. Reads are tolerant by rule and not by accident: `readJson` does not validate,
so unknown fields pass and a missing field arrives as `undefined` — which is a licence to ADD, never a
licence to remove, because the removal surfaces as a crash deep inside a component rather than at the
boundary. Mutations keep their Zod validation exactly as they are; a request body is not a read.

**The handshake is the most tolerant surface, not the least.** `nodeInfoSchema` and `pairResultSchema`
ignore unknown fields, in every major, forever. This is the response by which a client learns it
*cannot* speak to a node, so every version of it must be readable by every client — a client that
cannot parse it cannot even say why, and reports "this is not an acorn node" about something that
plainly is. Both were `strictObject` until 2026-08-15, which meant the first field any future node
added would have broken every older client in exactly that way.

Why the rules are this blunt, and this early: today the client and node ship together, so any wire
change is safe and none of this costs anything. Once a node is a download (`docs/future/bundle.md`),
old nodes exist forever and that freedom is gone. There is deliberately no response-schema validation,
no OpenAPI and no codegen (see `docs/architecture-overview.md § Wire validation`), and no protocol
export snapshot — the plugin API has one because its authors are outside the repo, and the protocol's
consumers are all inside it until standalone nodes ship.

The plugin bridge inherits the same posture for the same reason: frame-SDK verbs ship inside plugin
bundles while the broker ships in the shell, so within a `PLUGIN_API_MAJOR` bridge verbs are additive
only (`docs/plugins.md § The plugin API`).

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
| `POST` | `/v2/core/plugins/:id/reload` | Swap a loaded plugin's node half in the running process |
| `POST` | `/v2/core/plugins/requests/:requestId` | Answer an agent-raised install request (`approved`/`denied`) |
| `GET` | `/v2/core/audit` | Read the retained audit trail |
| `GET` | `/v2/core/security` | Read Node security posture |
| `GET` | `/v2/core/backup` | Suggest a destination path for a backup |
| `POST` | `/v2/core/backup` | Create a credential-scrubbed database archive |

These routes are device-only. Backup uses Node filesystem paths, so an internal task token must not
reach it. `GET /v2/core/plugins` also carries `requests` — the queue of installs an agent has asked for
and the owner has not answered — and the decision route is what closes one. A task-scoped agent can raise a
request through the `plugin_request` tool and can reach neither route, which is the whole point
(docs/plugins.md § Approval-mediated install). What it *can* read is the authoring contract, through the
`plugin_authoring` tool — a read of this node's own schemas, on the agent-tool surface rather than as a
route, so it adds nothing here for a plugin frame to be denied (docs/plugins.md § Teaching the agent).

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
| `GET` | `/v2/core/workspaces` | List workspaces and their project membership |
| `POST` | `/v2/core/workspaces/bootstrap` | Initialize the default workspace |
| `POST` | `/v2/core/workspaces` | Create a workspace |
| `PATCH` | `/v2/core/workspaces/:id` | Update workspace identity |
| `DELETE` | `/v2/core/workspaces/:id` | Delete a non-default workspace |
| `GET` | `/v2/core/projects` | List local projects and their facets |
| `POST` | `/v2/core/projects` | Add or import a project |
| `PATCH` | `/v2/core/projects/:id` | Update project identity, folder, or visibility |
| `GET` | `/v2/core/workspaces/:id/external-projects` | List provider projects linked to a workspace |
| `PUT` | `/v2/core/workspaces/:id/external-projects` | Replace provider projects linked to a workspace |
| `GET` | `/v2/core/tasks` | List active tasks on this Node |
| `POST` | `/v2/core/tasks` | Create a task |
| `PATCH` | `/v2/core/tasks/:id` | Update task metadata or archive/activate a task |
| `POST` | `/v2/core/tasks/:id/links` | Add an external item link |
| `DELETE` | `/v2/core/tasks/:id/links` | Remove an external item link |
| `GET` | `/v2/core/tasks/:id/context` | Assemble task context (`?include=` names section ids; `*` for all) |
| `GET` | `/v2/core/tasks/:id/tools` | List task agent tools |
| `POST` | `/v2/core/tasks/:id/tools/:name` | Invoke an authorized task tool |
| `GET` | `/v2/core/agent-tools` | Catalog tools for Settings |

Task-addressed routes are guarded by the `taskId` in a task-scoped internal token. Task lifecycle,
worktree, run-target, and repo-config authority remains in core.

### Worktrees, configuration, and run targets

The core worktree router covers project configuration and task lifecycle surfaces, including:

```text
/v2/core/task-statuses
/v2/core/projects/:id/run-targets
/v2/core/projects/:id/config
/v2/core/tasks/:id/{preview-url,on-created,archive}
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
/v2/core/tasks/:id/{archive,preview-url,on-created,mcp}
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
| `linear` | projects, issues, comments, reference resolution, and rail rows (loaded package) |
| `rollbar` | normalized items, occurrences, and details |
| `preview` | preview rules and browser-agent operations |

## WebSocket

`/v2/events` carries sequence-numbered events and feature frames. The event stream is a live
invalidation channel, not a durable replication log. After reconnect or a sequence gap, the client
marks the Node stale and refetches. Durable agent and workflow history is read from plugin tables.

PTY output, Docker logs/stats/exec, workflow notices, agent streams, and preview tunnels use the
same authenticated socket with feature-specific frames and bounded backpressure/replay semantics.

A frame's channel is `<owner>:<verb>`, and the token before the first `:` is the registered prefix on
both ends. Core owns three of them: `term:` (transport on both ends), `workflow:` (the notification
bell's notices and step events) and `plugins:` — whose one frame, `plugins:changed`, is the content-free
ping the Node sends when it reloads a plugin's node half in place (docs/plugins.md § The dev loop). The
client re-reads the roster route rather than trusting a payload. Every other prefix belongs to the plugin
that registered it.
