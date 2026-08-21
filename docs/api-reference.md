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

## Pairing

A pairing code is a one-time, 128-bit credential with a 10-minute window and a 5-attempt budget,
issued and displayed by the node (QR plus text) and typed into the new client. It lives in memory
only and is never persisted: a code that survived a node restart would be a credential sitting on
disk for a window the owner believes has closed, so a restart loses an in-flight code and the owner
just reopens the window. Issuing a new code replaces any code already open; there is at most one open
window at a time.

Every failure mode, no open window, an expired window, an exhausted attempt budget, a wrong code, or
a malformed request body, answers with the same 401 status and message. The response gives a caller
no way to tell which of those it hit, so there is no oracle for "right code, wrong something". The
attempt counter increments before the code comparison runs, so exhausting the budget cannot be
avoided by racing concurrent guesses.

`POST /v2/pair` returns the device's bearer token exactly once, in that response; the node stores
only its hash from then on. The node's unauthenticated probe response carries the TLS certificate
fingerprint, for the new client to compare against what the node's own screen shows. Sending the
fingerprint over the connection being authenticated proves nothing by itself; the comparison's value
comes from the owner reading both screens.

`DELETE /v2/core/devices/:id` closes that device's open WebSocket connections immediately, since a
live socket holds no bearer to re-check against a revocation. A device may revoke itself; every
paired device already has full owner authority, so there is no separate self-revocation guard.

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

The client mints the key, never the broker: only the call site knows that a retry is the same
logical mutation, and a broker-minted key would defeat replay entirely.

## Errors

Every route that fails returns the same envelope, `{ error: { code, message, requestId, retryable,
details? } }` (`@acorn/protocol/errors.ts`). `ERROR_CODES` is a small set of transport-level codes,
the floor every consumer can rely on for a failure with no domain meaning: things like `not_found`,
`internal`, and `rate_limited`. Error bodies never carry secrets, tokens, file contents, or a
provider's raw response body; an unknown internal failure returns `internal` plus a `requestId` and
logs the rest server-side.

That floor is closed but not exclusive. A route may return its own documented code instead of a
floor code, and about three dozen of those domain codes are already load-bearing on the client:
`needs-trust` opens the config-trust modal, `provider_needs_auth` rewrites the error message, and so
on. Collapsing every route onto the ten floor codes would delete that behavior. A closed set exists
to buy interop discipline across an API boundary, and there is no such boundary here: the client and
the Node ship from the same repository and release together (§ Versioning above). So the floor is a
fallback for the case a route did not think to name, not a whitelist a route must stay inside.

`retryable` is derived from the HTTP status, not set by hand, so callers never maintain a per-code
table: `408`, `429`, `502`, `503`, and `504` are retryable, and no other 5xx is. A `500` usually means
the request itself is broken, and marking it retryable would only invite a client to hammer it.

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
| `GET` | `/v2/core/schedules` | List every schedule on this node, plus the global pause flag |
| `PATCH` | `/v2/core/schedules` | Pause or resume the whole loop |
| `POST` | `/v2/core/schedules` | Create a user schedule against a registered target kind |
| `PATCH` | `/v2/core/schedules/:key` | Pause/resume, retune the cadence, rename (user rows only) |
| `DELETE` | `/v2/core/schedules/:key` | Delete a user schedule — declared ones are paused, not deleted |
| `POST` | `/v2/core/schedules/:key/run` | Run one now |
| `GET` | `/v2/core/schedules/:key/runs` | The recent-run ring, newest first |

These routes are device-only. Backup uses Node filesystem paths, so an internal task token must not
reach it. Schedules are the same class for a different reason: a schedule is code the node runs
unattended, so declaring one is a way to make code run later (docs/schedules.md). `GET /v2/core/plugins` also carries `requests` — the queue of installs an agent has asked for
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

The preview tunnel (`/v2/tunnel`, `packages/node-core/src/main/tunnel.ts`) is a separate upgrade on
the same listener, resolved from `?task=<uuid>&port=<n>` and gated by the same device/internal-token
authorization as `/v2/events`. It forwards raw bytes to `127.0.0.1` on the named port only, never to a
resolved hostname: only declared ports are tunnellable, and there is no general SOCKS proxy to
whatever else is listening on the node's loopback. A port counts as declared when the task's run
bridge already names it as a run target's URL, or when the project's `previewMode` is `'port'`.
`previewMode: 'script'` is not a source, because its value is a shell command whose output would have
to run on every tunnel attempt to answer the question; a remote task configured that way gets no
tunnel until the same port also appears as a run target's URL or a `'port'` value. `previewMode: 'url'`
is also declared, the same way as `'port'`: without it, a remote task configured with
`http://localhost:8025` would resolve the tunnel request, get refused, and fall back to loading the URL
as given, which rendered whatever was on the owner's own port 8025 while claiming to show the remote
preview. A URL naming a host other than loopback contributes nothing to the allowlist: it is already
reachable from the client directly, so there is nothing to tunnel.

A frame's channel is `<owner>:<verb>`, and the token before the first `:` is the registered prefix on
both ends. Core owns three of them: `term:` (transport on both ends), `workflow:` (the notification
bell's notices and step events) and `plugins:` — whose one frame, `plugins:changed`, is the content-free
ping the Node sends when it reloads a plugin's node half in place (docs/plugins.md § The dev loop). The
client re-reads the roster route rather than trusting a payload. Every other prefix belongs to the plugin
that registered it.
