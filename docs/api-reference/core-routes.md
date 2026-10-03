# Core routes

This page lists every route core mounts under `/v1/core`, grouped by owner, with the gate in front of
each group. It's part of the [API reference](../api-reference.md). The route modules under
`packages/node-core/src/server/routes/` own the bodies and validation.

`packages/node-core/src/server/mountCoverage.test.ts` builds the app and fails unless every core
route is behind a gate mount or named, with its reason, as open to a task token.
[Transport and authentication](../security/transport-and-auth.md) explains the gates.

## Node administration

Every route in this table is device-only.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/core/pair/start` | Open or replace the ten-minute pairing window |
| `DELETE` | `/v1/core/pair` | Close the pairing window |
| `GET` | `/v1/core/devices` | List paired devices, without token material |
| `DELETE` | `/v1/core/devices/:id` | Revoke a device and close its sockets |
| `GET` | `/v1/core/plugins` | The plugin roster, install state, and pending agent install requests |
| `PUT` | `/v1/core/plugins` | Replace the disabled list with `{ disabled }` |
| `POST` | `/v1/core/plugins/install` | Install a package from GitHub, npm, a URL, or a folder. Needs `Idempotency-Key` |
| `POST` | `/v1/core/plugins/:id/update` | Update an installed package. Needs `Idempotency-Key` |
| `POST` | `/v1/core/plugins/:id/review` | Approve or remove a package held for review. Needs `Idempotency-Key` |
| `POST` | `/v1/core/plugins/:id/reload` | Swap a loaded plugin's node half in the running process. Needs `Idempotency-Key` |
| `DELETE` | `/v1/core/plugins/:id` | Uninstall a package. Needs `Idempotency-Key` |
| `POST` | `/v1/core/plugins/requests/:requestId` | Answer an agent's install request, `approved` or `denied` |
| `POST` | `/v1/core/plugins/:id/cli/:name` | Invoke one manifest CLI command with `{ input }` |
| `GET` | `/v1/core/plugins/:id/bundles/:hash` | Read the exact client bundle with that hash, for device custody |
| `GET` | `/v1/core/plugins/:id/client.js` | The installed client bundle, for clients older than the hash route |
| `GET` | `/v1/core/audit` | Read the audit trail |
| `GET` | `/v1/core/security` | Read the Node's security posture |
| `GET` | `/v1/core/storage` | Node memory and database, plugin database, and blob cache sizes |
| `GET` | `/v1/core/attachment` | The control plane this Node is attached to, if any |
| `DELETE` | `/v1/core/attachment` | Detach: revoke the control plane's device row and forget it |
| `GET` | `/v1/core/nodes` | Nodes this Node's plugins know about, and the verbs each provider declared |
| `POST` | `/v1/core/nodes/adopt` | Connection material and credential for one provided Node |
| `POST` | `/v1/core/nodes/create` | Ask a provider for a Node |
| `POST` | `/v1/core/nodes/destroy`, `/start`, `/stop` | The lifecycle verbs that name an existing Node |
| `GET` | `/v1/core/backup` | Suggest a destination path for a backup |
| `POST` | `/v1/core/backup` | Write a credential-scrubbed database archive to a path on the Node |

Each roster row may carry `active`, the declaration and client hash of the running loaded runtime,
beside `installed`, the package on disk. `active: null` says no loaded runtime is active. The bundle
route resolves by hash, including retained active bytes after an on-disk update, so custody can check
the hash before any trust decision. A task-scoped agent asks for an install through the
`plugin_request` tool and reaches neither the roster nor the decision route
([installing plugins](../security/plugin-install.md)).

CLI command discovery reads only `active.contributions.cliCommands` on a running loaded plugin. The
invocation route resolves the descriptor again, rechecks the device, the declared core capability,
the resource scope, and both JSON schemas, and needs an `Idempotency-Key` for a write command. It
calls only the plugin's reserved `/v1/p/<id>/cli/<name>` path and returns `{ result }`. See
[CLI command authoring](../plugin-authoring/cli-commands.md).

## Schedules

Device-only, because a schedule is code the Node runs unattended. [Schedules](../schedules.md) owns
the model.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/core/schedules` | Every schedule on this Node, plus the global pause flag |
| `PATCH` | `/v1/core/schedules` | Pause or resume the whole loop |
| `GET` | `/v1/core/schedules/targets` | The targets this Node can run, for the creation picker |
| `POST` | `/v1/core/schedules` | Create a user schedule against a registered target kind |
| `POST` | `/v1/core/schedules/:key/confirm` | Take consent again after a target's risk tier rose. No body |
| `PATCH` | `/v1/core/schedules/:key` | Pause, resume, retune the cadence, or rename a user row |
| `DELETE` | `/v1/core/schedules/:key` | Delete a user schedule. Declared ones are paused, not deleted |
| `POST` | `/v1/core/schedules/:key/run` | Run one now. `Idempotency-Key` names a manual workflow occurrence |
| `GET` | `/v1/core/schedules/:key/runs` | The recent-run ring, newest first |

## Preferences, integrations, and telemetry

| Method | Path | Gate | Purpose |
| --- | --- | --- | --- |
| `GET`, `PUT` | `/v1/core/prefs` | Device | Read Node preferences, or upsert one |
| `GET` | `/v1/core/integrations` | Provider access | Provider descriptors and connection state |
| `POST` | `/v1/core/integrations` | Provider access | Create and validate a connection |
| `PUT` | `/v1/core/integrations/:id` | Provider access | Replace credentials or configuration |
| `PATCH` | `/v1/core/integrations/:id` | Provider access | Enable or disable a connection |
| `POST` | `/v1/core/integrations/:id/test` | Provider access | Test provider connectivity |
| `DELETE` | `/v1/core/integrations/:id` | Provider access | Disconnect and cascade provider data |
| `GET` | `/v1/core/integrations/:id/projects` | Provider access | The provider's projects, for the mapping picker |
| `GET`, `PUT` | `/v1/core/integrations/:id/mappings` | Provider access | Read or replace this connection's workspace project mappings |
| `GET` | `/v1/core/models/backends` | Device | Model backends this owner can generate with |
| `POST` | `/v1/core/telemetry` | Device | Take a batch of records another runtime collected |
| `GET` | `/v1/core/telemetry/summary` | Device | What this Node has collected since it started |

The provider-access gate admits device principals and the Node's own `service` calls, never a task
token. Creating a connection or replacing its credentials takes a `credentials` object of provider
fields, such as `{ "credentials": { "token": "…" } }`. A top-level `token` field or a missing
`credentials` object gets `400 provider_bad_config`. Secret values are write-only.

`POST /v1/core/telemetry` takes `{ runtime, records }`, at most one mebibyte, and refuses the whole
batch for one malformed record. `runtime` can't say `node`. It answers `202` with `{ accepted }`,
which is `0` when the preference is off or no sink is subscribed.
[Telemetry runtimes](../telemetry/runtimes.md#other-runtimes) owns the contract.
`GET /v1/core/telemetry/summary` answers counters, not records, because it names the subscribed sink
plugins ([diagnosis](../telemetry/diagnosis.md#what-the-page-shows)).

`GET /v1/core/models/backends` answers `backends` and `missing`. A backend is a connected model
provider or an agent CLI installed on this machine, with an id, a label, and a model catalog,
connections first. `missing` names each agent CLI that declares a one-shot text mode and isn't on
this machine. See model providers in [integrations](../integrations.md).

## Workspaces, projects, and tasks

Workspace and project routes are device-only. Task routes are open to a task token for its own task.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`, `POST` | `/v1/core/workspaces` | List workspaces with project membership, or create one |
| `POST` | `/v1/core/workspaces/bootstrap` | Create the default workspace |
| `PATCH`, `DELETE` | `/v1/core/workspaces/:id` | Rename, or delete a non-default workspace |
| `GET`, `PUT` | `/v1/core/workspaces/:id/external-projects` | Read or replace provider projects linked to a workspace |
| `GET`, `POST` | `/v1/core/projects` | List projects and their facets, or add one |
| `GET`, `PATCH`, `DELETE` | `/v1/core/projects/:id` | Read, update identity, colour, folder, or visibility, or delete with its tasks |
| `POST` | `/v1/core/projects/:id/detect` | Detect the project's facets again |
| `GET`, `PUT` | `/v1/core/projects/:id/config` | Read or write project configuration |
| `PUT` | `/v1/core/projects/:id/run-targets` | Replace the project's run targets |
| `GET` | `/v1/core/projects/:id/branches` | Local branches grouped by active task, with the checkout branch |
| `GET` | `/v1/core/projects/:id/worktree-availability` | Check a task branch and preview a derived name |
| `GET` | `/v1/core/projects/:id/worktrees` | Free worktrees under the project |
| `GET` | `/v1/core/projects/:id/mcp` | MCP servers the agent CLIs load from this project's config files |
| `POST` | `/v1/core/projects/:id/mcp/starter` | Write an empty `.mcp.json` into the project folder |
| `GET`, `POST` | `/v1/core/tasks` | List tasks, or create one. `?status=archived` lists archived tasks, newest first |
| `PATCH` | `/v1/core/tasks/:id` | Update task metadata |
| `POST`, `DELETE` | `/v1/core/tasks/:id/links` | Add or remove an external item link |
| `GET` | `/v1/core/task-statuses` | Git status for active tasks |
| `GET`, `POST` | `/v1/core/tasks/:id/config-trust` | Read the executable config snapshot, or acknowledge it |
| `POST` | `/v1/core/tasks/:id/preview-url` | Resolve the task's preview URL |
| `POST` | `/v1/core/tasks/:id/on-created` | Prepare a new branch task's worktree and setup |
| `GET` | `/v1/core/tasks/:id/archive-concerns` | What each plugin says about archiving this task |
| `POST` | `/v1/core/tasks/:id/archive`, `/restore` | Archive or restore a task |
| `GET` | `/v1/core/tasks/:id/run` | The task's run targets |
| `GET` | `/v1/core/tasks/:id/run/default-url` | The default run target's URL |
| `POST` | `/v1/core/tasks/:id/run/:target/start`, `/stop`, `/restart` | Control one run target |
| `GET` | `/v1/core/tasks/:id/run/:target/status` | One run target's state |
| `GET` | `/v1/core/tasks/:id/context` | Assembled task context. `?include=` names section ids, `*` for all |
| `GET` | `/v1/core/tasks/:id/repo-info` | Repository facts for the `repo_info` tool |
| `GET` | `/v1/core/tasks/:id/tools` | The task's agent tools, for MCP and harnesses |
| `POST` | `/v1/core/tasks/:id/tools/:name` | Invoke an authorized agent tool |
| `POST` | `/v1/core/tasks/:id/renderer-tools/:name` | Invoke a tool that opts in to renderer calls |
| `GET` | `/v1/core/agent-tools` | The static tool catalog, for Settings |
| `GET` | `/v1/core/search` | Search core and every plugin's search provider. Device-only |
| `GET` | `/v1/core/runs` | Every plugin's runs, merged. A task token sees only its task's runs |

`GET /v1/core/tasks`, `GET /v1/core/task-statuses`, and `GET /v1/core/runs` are filtered rather than
gated: a task token gets its own task and nothing else.

`POST /v1/core/tasks` takes `origin` and `projectId`, plus optional `title`, `icon`, `branch`,
`branchSource`, `baseBranch`, `worktreePath`, `skipSetup`, `pullNumber`, and `links`. `branchSource`
is `exact` by default, and `derived` lets the Node add a numeric suffix on a collision. `baseBranch`
must name a local branch, needs a task branch, and can't be combined with `worktreePath`. The Node
creates the branch from that base's last commit before saving the task, and removes it if the insert
fails. Worktree creation stays lazy. With a base, every local branch name counts as taken. Without
one, an unused local branch can be reused. A bad base returns 400, and an exact name conflict returns
a `worktree-unavailable` 409.

`GET /v1/core/projects/:id/branches` returns
`{ current, tasks: [{ branch, taskId, title }], other: [{ name, committedAt }] }`. `current` is the
checkout branch, or `null` for a detached HEAD. `committedAt` is Unix time in milliseconds. A non-Git
project returns empty groups.

`GET /v1/core/projects/:id/worktree-availability` takes `branch` and optional `branchSource` and
`baseBranch` query parameters. It returns `{ available: true, branch }`, with the next free name for a
derived request, or `{ available: false, branch, reason }`. The preview doesn't reserve the name.

Executable repository configuration is hash-gated before use
([process and path controls](../security/process-and-paths.md)).

## Task scripts

These reads enforce task-token confinement. The typed contract is `@acorn/protocol/taskScripts.ts`.

| Method | Route | Result |
| --- | --- | --- |
| `GET` | `/v1/core/tasks/:id/scripts` | Setup and teardown snapshots, generation, archive progress, and up to 50 attempts |
| `GET` | `/v1/core/tasks/:id/scripts/wait?phase=setup&timeoutMs=30000&attemptId=…` | `{ snapshot, matched, reason }` |
| `GET` | `/v1/core/tasks/:id/scripts/logs?phase=setup&tailLines=100&maxBytes=32768&attemptId=…` | The snapshot, UTF-8 output, availability, truncation, and byte counts |

Waits range from 0 to 30,000 ms, tails from one to 1,000 lines, and bytes from one to 32,768. An
unknown task or attempt returns 404. The reads never run a script or create a worktree. A wait binds
once to its attempt and generation, and a generation change doesn't satisfy it. Aborting the request
releases the wait without cancelling the process.

## Data, queries, dashboards, and authoring

| Method | Path | Gate | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/core/data-sources/:operation` | Provider access | `list`, `discover`, `describe`, `options`, and `query` over typed sources |
| `POST` | `/v1/core/queries/:operation` | Provider access | The workspace query library |
| `POST` | `/v1/core/dashboards/:operation` | Device, in the handler | `list`, `get`, `create`, `save`, `validate`, `publish`, `published`, and `delete` |
| `GET` | `/v1/core/dashboards/history` | Open | The measure series a history panel draws |
| `POST` | `/v1/core/authoring/turn` | Device | One AI authoring turn for a query or dashboard. No execution or publication |

The path's operation must match the body's `operation`. `save` is a compare-and-swap on the draft
revision. See the [workspace query library](../data-sources.md#workspace-query-library).
