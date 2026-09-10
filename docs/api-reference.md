# API reference

The Node exposes one Hono application under `/v2`. It serves JSON routes and one authenticated
WebSocket. It serves no HTML, JavaScript, or static assets.

Route and response types live in `packages/protocol/src/api.ts`; the server composition is
`packages/node-core/src/server/index.ts`; plugin route declarations are registered by each Node
plugin. The table below maps routes by responsibility. Use the route modules for fields and
validation details when changing a contract.

## Transport

| Surface | Path | Auth |
| --- | --- | --- |
| Node probe | `GET /v2/node` | pre-auth; unauthenticated response is limited |
| Pairing | `POST /v2/pair` | pre-auth; consumes a one-time code |
| Core | `/v2/core/*` | device or permitted internal principal |
| Plugin | `/v2/p/<plugin>/*` | device or permitted internal principal |
| Events/streams | `GET /v2/events` | authenticated WebSocket upgrade |

A request that reaches a node through the desktop broker is killed after 30 seconds. That is less
than one model call is allowed to take, so a caller that knows its route is slow passes `timeoutMs`
on the request and the broker uses that instead. It is the exception: the default is what everything
else runs on, and a route that needs more than half a minute usually wants an event rather than a
longer wait. Workflow generation is the only route that asks, at 150 seconds for two model calls
([workflows.md](./workflows.md) § Generating one from a description). A renderer served by the node
itself, under `dev:node`, never goes through the broker and has no such cap.

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

A pairing code is a one-time 128-bit credential with a 10-minute window and a 5-attempt budget. The
node issues and displays it as a QR code plus text, and the owner types it into the new client. It
lives in memory only. A code that survived a node restart would be a credential on disk for a window
the owner believes has closed, so a restart loses an in-flight code and the owner reopens the window.
Issuing a new code replaces any open one, so at most one window is open at a time.

Every failure mode answers with the same 401 status and message: no open window, an expired window,
an exhausted attempt budget, a wrong code, or a malformed body. A caller cannot tell which one it
hit, so there is no oracle for "right code, wrong something". The attempt counter increments before
the code comparison runs, so racing concurrent guesses cannot dodge the budget.

`POST /v2/pair` returns the device's bearer token once, in that response, and the node stores only
its hash from then on. The node's unauthenticated probe response carries the TLS certificate
fingerprint for the new client to compare against the node's own screen. Sending the fingerprint over
the connection being authenticated proves nothing by itself. The comparison's value comes from the
owner reading both screens.

`DELETE /v2/core/devices/:id` closes that device's open WebSocket connections immediately, because a
live socket holds no bearer to re-check against a revocation. A device may revoke itself. Every
paired device already has full owner authority, so there is no separate self-revocation guard.

## Versioning

**One number, one meaning.** `NODE_PROTOCOL_VERSION` (`packages/protocol/src/node.ts`) is the
protocol major and the entire compatibility contract. There is no minor, no capability negotiation,
and no feature handshake. Each side refuses a major it does not speak. The pairing probe refuses
before pairing, and the broker re-probes `GET /v2/node` on every connect, producing the
`incompatible` connection state and the `protocol_mismatch` error code. Checking only at pairing is
not enough, because a paired node upgrades by restarting, which drops the socket, so the reconnect is
where a new major shows up.

**Within a major, changes are additive only.** New routes, new optional response fields, and new
WebSocket channels are all safe. Renaming a field, removing one, or changing what one means is the
next major. Reads are tolerant by rule: `readJson` does not validate, so unknown fields pass and a
missing field arrives as `undefined`. That is a licence to add, never to remove, because a removal
surfaces as a crash deep inside a component rather than at the boundary. Mutations keep their Zod
validation. A request body is not a read.

**The handshake is the most tolerant surface.** `nodeInfoSchema` and `pairResultSchema` ignore
unknown fields, in every major, forever. This is the response by which a client learns it cannot
speak to a node, so every version of it must be readable by every client. A client that cannot parse
it cannot say why, and reports "this is not an acorn node" about something that plainly is. Both were
`strictObject` until 2026-08-15, so the first field any future node added would have broken every
older client in exactly that way.

The rules are this blunt this early because the client and node ship together, so any wire change is
safe and none of this costs anything. Once a node is a download (`docs/future/bundle.md`), old nodes
exist forever and that freedom is gone. There is deliberately no response-schema validation, no
OpenAPI, and no codegen. For more information, see wire validation in
[the architecture overview](./architecture-overview.md). There is no protocol export snapshot either.
The plugin API has one because its authors are outside the repo, and the protocol's consumers are all
inside it until standalone nodes ship.

The plugin bridge takes the same posture for the same reason. Frame-SDK verbs ship inside plugin
bundles while the broker ships in the shell, so within a `PLUGIN_API_MAJOR` bridge verbs are additive
only. For more information, see the plugin API section in [the plugins doc](./plugins.md).

## Request processing

`createApp()` applies the following order:

1. Request-id assignment.
2. Principal resolution from a device bearer or `x-acorn-internal`.
3. The two pre-auth pairing routes.
4. The `requireUser` auth gate.
5. Idempotency replay for device mutations.
6. Device-only, task-scope, provider-scope, and route-specific gates.
7. Core and plugin routers.

`traceparent` is read, when the node is collecting telemetry, and it is the only header the request
middleware reads besides `x-request-id` and the two credentials. A well-formed one makes the
request's span a child of the caller's; anything else is ignored and the request starts its own
trace. The parser takes exactly the W3C form and the raw header never reaches a log line, because it
is attacker input like any other ([telemetry.md](./telemetry.md) § Traces). `x-request-id` is
unchanged.

`Idempotency-Key` is optional for most mutations and required by agent session creation, agent-turn
enqueue, and request resolution. A device-keyed replay stores the request hash and final response;
reuse with a different body returns `idempotency_conflict`. Internal callers have no device replay
namespace.

The client mints the key, never the broker: only the call site knows that a retry is the same
logical mutation, and a broker-minted key would defeat replay entirely.

## Errors

Every route that fails returns the same envelope, `{ error: { code, message, requestId, retryable,
details? } }` (`@acorn/protocol/errors.ts`). `ERROR_CODES` is a small set of transport-level codes
such as `not_found`, `internal`, and `rate_limited`, the floor every consumer can rely on for a
failure with no domain meaning. Error bodies never carry secrets, tokens, file contents, or a
provider's raw response body. An unknown internal failure returns `internal` plus a `requestId` and
logs the rest server-side.

That floor is closed but not exclusive. A route may return its own documented code instead, and about
three dozen domain codes are load-bearing on the client. `needs-trust` opens the config-trust modal,
`provider_needs_auth` rewrites the error message, and so on. Collapsing every route onto the ten
floor codes would delete that behavior. A closed set buys interop discipline across an API boundary,
and there is no such boundary here, because the client and the Node ship from the same repository and
release together. The floor is a fallback for the case a route did not think to name, not an
allowlist a route must stay inside.

`retryable` comes from the HTTP status rather than by hand, so callers keep no per-code table. `408`,
`429`, `502`, `503`, and `504` are retryable, and no other 5xx is. A `500` usually means the request
itself is broken, and marking it retryable would invite a client to hammer it.

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
| `GET` | `/v2/core/attachment` | Which control plane this Node is attached to, if any |
| `DELETE` | `/v2/core/attachment` | Detach: revoke the control plane's device row and forget it |
| `GET` | `/v2/core/nodes` | Nodes this Node's plugins know about, plus which verbs each provider declared |
| `POST` | `/v2/core/nodes/adopt` | Connection material and credential for one provided Node (host-only in practice) |
| `POST` | `/v2/core/nodes/create` | Ask a provider for a new Node |
| `POST` | `/v2/core/nodes/{destroy,start,stop}` | The three lifecycle verbs that name an existing Node |
| `GET` | `/v2/core/backup` | Suggest a destination path for a backup |
| `POST` | `/v2/core/backup` | Create a credential-scrubbed database archive |
| `GET` | `/v2/core/schedules` | List every schedule on this node, plus the global pause flag |
| `PATCH` | `/v2/core/schedules` | Pause or resume the whole loop |
| `POST` | `/v2/core/schedules` | Create a user schedule against a registered target kind |
| `PATCH` | `/v2/core/schedules/:key` | Pause/resume, retune the cadence, rename (user rows only) |
| `DELETE` | `/v2/core/schedules/:key` | Delete a user schedule. Declared ones are paused, not deleted |
| `POST` | `/v2/core/schedules/:key/run` | Run one now |
| `GET` | `/v2/core/schedules/:key/runs` | The recent-run ring, newest first |

These routes are device-only. Backup uses Node filesystem paths, so an internal task token must not
reach it. Schedules are the same class for a different reason: a schedule is code the node runs
unattended, so declaring one is a way to make code run later. For more information, see
[the schedules doc](./schedules.md).

`GET /v2/core/plugins` also carries `requests`, the queue of installs an agent has asked for and the
owner has not answered, and the decision route closes one. A task-scoped agent can raise a request
through the `plugin_request` tool and can reach neither route, which is the point. What it can read
is the authoring contract, through the `plugin_authoring` tool. That is a read of this node's own
schemas on the agent-tool surface rather than a route, so it adds nothing here for a plugin frame to
be denied. For more information, see approval-mediated install and teaching the agent in
[the plugins doc](./plugins.md).

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
| `GET` | `/v2/core/models/backends` | List the model backends this owner can generate with |
| `POST` | `/v2/core/telemetry` | Take a batch of records another runtime collected |
| `GET` | `/v2/core/telemetry/summary` | Counts of what this node has collected since it started |

Integration administration is restricted to device and Node service principals. Secret values are
write-only.

`POST /v2/core/telemetry` is device-only, and it is the one door into the node's collector for a
runtime that is not the node: the renderer today, the terminal client and the desktop helper next
([telemetry.md](./telemetry.md) § Other runtimes). The body is `{ runtime, records }`, capped at one
mebibyte and refused whole if any record is malformed. `runtime` names the sender and cannot say
`node`, because the collector stamps that on its own records and a batch that could claim it would
be indistinguishable from one at a sink. The answer is `202` with `{ accepted }`, which is `0` when
the preference is off or no sink is subscribed; that is not an error, and the sender stops on its
own when it next reads the preference.

`GET /v2/core/telemetry/summary` is the other half of that router and is device-only for the same
reason: it names which plugins are subscribed as sinks. It answers counters rather than records,
per owner and kind since the node started, plus the drop and truncation totals, the last flush, and
the sink list. Settings → Telemetry is the one caller
([telemetry.md](./telemetry.md) § What the page shows).

`GET /v2/core/models/backends` is device-only, and answers `backends` plus `missing`. A backend is a
connected model provider or an agent CLI installed on this machine, projected to an id, a label and a
model catalog; connections come first. `missing` names every agent CLI that declares a one-shot text
mode whose command is not on this machine, which is what the onboarding wizard draws as "not found".
For more information, see model providers in [the integrations doc](./integrations.md).

### Workspaces and tasks

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v2/core/workspaces` | List workspaces and their project membership |
| `POST` | `/v2/core/workspaces/bootstrap` | Initialize the default workspace |
| `POST` | `/v2/core/workspaces` | Create a workspace |
| `PATCH` | `/v2/core/workspaces/:id` | Rename a workspace |
| `DELETE` | `/v2/core/workspaces/:id` | Delete a non-default workspace |
| `GET` | `/v2/core/projects` | List local projects and their facets |
| `POST` | `/v2/core/projects` | Add or import a project |
| `GET` | `/v2/core/projects/:id` | Read one project |
| `PATCH` | `/v2/core/projects/:id` | Update project identity, colour, folder, or visibility |
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

The exact method/body contracts are in `packages/node-core/src/server/routes/projects/worktree.ts`,
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
| `/v2/p/github/tasks/:taskId/pulls` | Durable Acorn-created PR relations for a task |
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
/v2/p/agents/concurrency
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
/v2/p/terminal/tasks/:taskId/run-targets
/v2/core/tasks/:id/{archive,preview-url,on-created,mcp}
/v2/p/workflows/catalog
/v2/p/workflows/defs[/*]
/v2/p/workflows/tasks/:id/workflows*
/v2/p/workflows/workflows/runs/:runId/{steps,gate,cancel,kill,retry}
```

The terminal plugin owns session control and stream attachment. Core owns worktrees and run-target
execution. Workflows own durable definitions, runs, steps, gates, and reconciliation.

`POST /v2/p/workflows/tasks/:id/workflows` takes `{ def, inputs? }` or `{ defId, inputs? }`, one or
the other. A `defId` of `repo:<fileId>` or `user:<fileId>` names a file the task's project loads;
anything else names a `workflow_defs` row, and a task-confined caller is refused that with a 403
because a row skips the repository trust snapshot. `inputs` is a table of strings, one per input the
definition declares; the runner refuses a required input with no value and a name the definition does
not declare. `GET` on the same path answers the task's file layers, plus the workspace's rows for a
device caller. `POST .../runs/:runId/retry` takes `{ stepId, prompt? }` and puts a
failed node back to pending. Retry answers 403 to a task-confined caller, because an agent could
otherwise loop a failed step past the rail that stopped it. Every other run-scoped path treats a
foreign or unknown run as a 404.

`GET /v2/p/workflows/catalog` answers every step kind this node can run, with the form each one
draws, plus the policies and the agent profiles
([workflows.md](./workflows.md) § Contributed step kinds). It takes an optional `projectId` and
ignores it: the answer is node-wide, and the parameter is there so a later per-project answer needs no
second route. Two routes answer the option lists that a kind's `select` fields point at, both shaped
`{ options: [{ value, label, description? }] }`:
`GET /v2/p/terminal/tasks/:taskId/run-targets` and
`GET /v2/p/database/projects/:projectId/saved-queries`. The second refuses a task-confined caller,
because no task in the path means no scope gate.

Definitions stored as rows live under `/v2/p/workflows/defs`, and the whole family is device-only
([workflows.md](./workflows.md) § Database definitions):

| Route | Body or query | Answer |
| --- | --- | --- |
| `GET /defs?workspaceId=` | | The merged list: the workspace's rows, every project's committed files, and the user layer, each with its `source`, `projectId` and `problems`. A repo id wins a collision. |
| `POST /defs` | `{ workspaceId, projectId?, def }` | The row. A definition the loader would reject is a 400 carrying its problems. |
| `GET /defs/:id` | `?projectId=` | The row with its definition, or a 404. An `:id` of `repo:<fileId>` or `user:<fileId>` names a committed file instead, read from the named project's checkout, and answers `revision: 0` so the editor knows it has no row to save into. |
| `PUT /defs/:id` | `{ def, revision }` | The row with `revision + 1`. A stale `revision` is a 409 whose `details` carry the row that won. |
| `DELETE /defs/:id` | | `{ ok }`. Runs that froze this definition are untouched. |
| `POST /defs/validate` | `{ def, projectId? }` | `{ problems }`, the loader's own list. `projectId` is accepted and ignored: what a step names inside a project is checked when the step runs. |
| `POST /defs/:id/save-to-repo` | `{ taskId?, keepRow? }` | `{ path }` after writing `.acorn/workflows/<slug>.toml`, deleting the row unless `keepRow`. |
| `POST /defs/generate` | `{ backendId, modelId?, description, workspaceId, defId?, name?, inputs? }` | `{ def, notes, problems, repaired, providerId, modelId }`: a whole definition written by whichever backend `backendId` names, what was taken out of the reply, and what the checker still says about it. |
| `GET /defs/model-connections` | | The backends this owner can generate with, ids and labels only, connections before installed agent CLIs. The path keeps the older name because only this plugin's own code calls it. An empty list is why the editor draws no **Generate** button. |

`POST /defs/generate` writes a definition from a sentence
([workflows.md](./workflows.md) § Generating one from a description). `description` is capped at
8,000 characters by the same constant the editor's textarea reads. `workspaceId` says whose
definitions ride along as worked examples and `defId` names the one to leave out of them, since a
definition is a poor worked example of itself. `notes` is a list of `{ code, message, step? }`, one
per thing the reply named that this node does not have. `problems` is the checker's list, which the
editor's footer draws anyway.

It answers 422 `model_answer_unusable` when nothing in the reply could be read as a definition, with
the reason in `message`, and that is the one failure with no definition to apply. A provider failure
keeps the status the provider seam gave it, so `provider_not_connected` is a 404 and
`provider_needs_auth` a 401, and anything else is 502 `provider_unavailable`. The route makes up to
two model calls, which is longer than the broker's default request timeout, so the client sends its
own `timeoutMs` (§ Transport). Neither route needs an owner check of its own: generation spends the
owner's provider key, and the whole `/defs` family is already device-only, which is stricter.

### Notes and memory

```text
/v2/p/notes/tasks/:id/notes[/*]
/v2/p/notes/workspaces/:wsId/notes[/*]
/v2/p/memory/memory[/*]
```

The notes plugin owns the notes namespace. The memory plugin's note paths under
`/v2/p/memory/tasks/.../notes` and `/v2/p/memory/workspaces/.../notes` are deprecated compatibility
aliases for one release and resolve through the same notes store.

### Other feature plugins

| Plugin | Route surface |
| --- | --- |
| `changes` | task-local Git actions, a model-written commit message, and review notes |
| `database` | task-scoped PostgreSQL schema/query operations |
| `docker` | Node inventory and task container actions |
| `editor` | task file reads/writes and search |
| `http` | encrypted request/variable storage and send |
| `memory` | memory entries and proposals; deprecated notes aliases |
| `notes` | task, workspace, and global note CRUD |
| `linear` | projects, issues, comments, reference resolution, and rail rows (loaded package) |
| `rollbar` | normalized items, occurrences, and details |
| `preview` | preview rules and browser-agent operations |

### Command palette routes

A loaded plugin's `search`, `input` and `setting` commands name a route in the plugin's own
namespace, and the host calls it with the query and the identifiers the declared scope owns
([plugins.md](./plugins.md) § Command kinds). They are ordinary plugin routes with ordinary
authentication and owner context; the only thing particular to them is that the answer is untrusted
display data with no field that can choose a route, a URL or a verb.

```text
GET  /v2/p/rollbar/palette/issues        ?q&projectId
GET  /v2/p/linear/palette/issues         ?q&projectId
GET  /v2/p/database/palette/queries      ?q&taskId
POST /v2/p/database/palette/generate     { input, taskId }
GET  /v2/p/http/palette/requests         ?q&projectId
POST /v2/p/http/palette/import-curl      { input, taskId }
```

Each search re-checks the project or task owner on the node and answers at most 50 rows. The two
POSTs require an interactive owner and commit their write before answering success, so the reader is
never navigated to something that is not there yet.

## WebSocket

`/v2/events` carries sequence-numbered events and feature frames. The event stream is a live
invalidation channel, not a durable replication log. After reconnect or a sequence gap, the client
marks the Node stale and refetches. Durable agent and workflow history is read from plugin tables.

PTY output, Docker logs/stats/exec, workflow notices, agent streams, and preview tunnels use the
same authenticated socket with feature-specific frames and bounded backpressure/replay semantics.

The preview tunnel (`/v2/tunnel`, `packages/node-core/src/server/transport/tunnel.ts`) is a separate upgrade on
the same listener, resolved from `?task=<uuid>&port=<n>` and gated by the same device and
internal-token authorization as `/v2/events`. It forwards raw bytes to `127.0.0.1` on the named port
only, never to a resolved hostname. Only declared ports are tunnellable, and there is no general
SOCKS proxy to whatever else listens on the node's loopback.

A port counts as declared when the task's run bridge names it as a run target's URL, or when the
project's `previewMode` is `'port'` or `'url'`. `previewMode: 'script'` is not a source, because its
value is a shell command that would have to run on every tunnel attempt to answer the question. A
remote task configured that way gets no tunnel until the same port also appears as a run target's URL
or a `'port'` value. `'url'` counts because without it a remote task configured with
`http://localhost:8025` would be refused and fall back to loading the URL as given, rendering
whatever sits on the owner's own port 8025 while claiming to show the remote preview. A URL naming a
host other than loopback adds nothing to the allowlist, because the client can already reach it
directly.

A frame's channel is `<owner>:<verb>`, and the token before the first `:` is the registered prefix on
both ends. Core owns twelve, and every other prefix belongs to the plugin that registered it.

`term:` is transport on both ends and `workflow:` carries the notification bell's notices, per-step
stream events, and `workflow:step-changed`, which names one step whose status moved so a run surface
can redraw that node without re-reading the run. `ws:shed` is the hub saying it dropped frames because a socket was too far behind to take
them, described under [Backpressure](./terminal.md#backpressure). The other nine are the Node saying
that something it owns has moved, and each is one frame:

- `plugins:changed`, when a Node reloads a plugin's node half in place. See the dev loop in
  [the plugins doc](./plugins.md).
- `tasks:changed`, on every task write: create, patch, links, archive, cancel, and a project delete
  taking its tasks with it.
- `connection:changed`, on every write to a connection's status, including the demotions to
  `needs-auth` that happen mid-request when a credential stops being readable.
- `head:changed`, when a task worktree's tip moves. Detected by the task-status poll, so it fires
  within one status round trip of an in-app commit and within ten seconds of one made from a
  terminal, an agent, or an outside editor, while a client is attached.
- `run:changed`, when a declared run target is started or stopped.
- `agent-session:changed`, when a managed agent session finishes a turn or asks for attention. The
  same two kinds the agent webhook delivers externally.
- `project:changed`, on every project write: create, patch, re-detect, delete, and the config and
  run-target writes.
- `terminal:sessions-changed`, when a terminal session is created, exits, or flips between working
  and idle. The one channel here that fires at machine speed, which is why only the session roster
  hears it.
- `worktree:status-changed`, when something under a task's worktree changes: a stage, a commit, a
  discard, a push, an editor write, a worktree created, a session's command going quiet. It carries
  `taskId`, or `null` when the writer did not know which task it was working in. Separate from
  `head:changed` because a stage or a discard moves the dirty markers without moving HEAD.

`term:status` rides the `term:` prefix and is a narrower thing than its name suggests. It means
"re-read this plugin's chrome descriptors", it carries the `pluginId` whose rows moved, and the
plugin-chrome sweep is the only thing that hears it. A ping with no `pluginId` is core's own, and means
every plugin's. The terminal's two former meanings are `terminal:sessions-changed` and
`worktree:status-changed`.

`plugins:changed`, `tasks:changed` and `terminal:sessions-changed` are content-free, because the list
behind each is a fetchable route and a payload would be a second projection to keep in step.
`connection:changed` carries `integrationId`, `providerId`, and the new `status`, because every
integration plugin hears it and most of them are looking at a different provider. The three fields let
a listener drop the frame without a round trip, and the client still re-reads the route. The other
five carry a payload for the same reason; the shapes are in `@acorn/protocol/nodeEvents.ts`.

All of them are invalidation, not replay: a client that missed a frame is not owed a delta, which is
why each field is what the thing now is rather than what changed about it.
