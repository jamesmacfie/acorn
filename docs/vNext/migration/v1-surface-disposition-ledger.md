# V1 surface disposition ledger

**Status:** Normative frozen implementation inventory<br>
**Requirement prefix:** `MIG-LEDGER`

This ledger is the mechanical cutover boundary between the shipped V1 tree and V2. It inventories
the route registries, public automation operations, event channels, database tables and Client
contributions that exist at the V1 freeze. V2 does not preserve their wire/storage shapes; each
entry has a target contract, explicit removal or clean-start disposition.

## 1. Freeze and verification method

`MIG-LEDGER-001` The V1 freeze is the repository state inspected on 2026-07-30. The implementation
gate extracts:

1. Hono methods and mount prefixes from `core/server/index.ts`, `app/server/routes.ts` and provider
   route registration;
2. public operation/event contributions from `app/server/publicApi.ts` and the core registry;
3. table exports from `core/server/db/schema.ts`;
4. `ClientEventMap`, `WillEventMap` and `core/shared/ws.ts` channel unions; and
5. composition registrations in `app/client/activate.ts`, `pageContributions.tsx`,
   `slotContributions.tsx`, `providerContributions.tsx` and
   `persistedSliceContributions.ts`.

`MIG-LEDGER-002` CI serializes and sorts the extracted IDs. Any added, removed or renamed V1 item
changes the frozen digest and requires a new ledger row before cutover. A family expression below
uses literal brace expansion: every comma-separated alternative is a separate item; it is not a
runtime wildcard.

## 2. Interactive HTTP registry

All `/auth/*` and `/api/*` V1 paths disappear. V2 has only the OpenAPI `/v2` protocol; Electron uses
that same protocol for local and remote Nodes.

| V1 mounted surface | Exact V1 family | V2 disposition |
| --- | --- | --- |
| `/auth` | `GET test-login|login|permissions|callback`, `POST logout` | removed; Node pairing/device identity and plugin-owned provider setup |
| `/api/me` | `GET /` | Node descriptor/current device principal |
| `/api/api-tokens` | `GET|POST /`, `DELETE /:id` | removed without replacement; V1 tokens invalid |
| `/api/settings/api` | `GET|PATCH /` | removed; no V2 automation listener setting |
| `/api/pins` | `GET|PUT /` | core repository preference commands |
| `/api/prefs` | `GET|PUT/PATCH` preference family | scoped settings and Client presentation store |
| `/api/workspaces` | list/create/bootstrap/get/patch/delete; assignments; ignore/unignore/all; projects get/replace; repo assignment | core Workspace/Repository queries and commands; only eligible configuration imports |
| `/api/tasks` | list/create/get/patch/archive/restore/status/links and task context | core Task queries/commands plus Context contract; no task import |
| `/api/tasks/:id/config-trust` | snapshot/get/acknowledge/revoke | core repository-config trust commands |
| `/api/tasks/:id/run` | targets/default URL/start/stop/restart/status | core run-target operations; Terminal no longer owns them |
| `/api/tasks/:id/tools` and `/renderer-tools` | list/invoke typed agent tools | core broker capability exports; no private endpoint call |
| `/api/agent-tools` | catalog | core capability/tool catalog query |
| `/api/integrations` | list/connect/credentials/test/update/delete | owning plugin settings, wizard, secret and provider capabilities |
| `/api/tasks/:id/review-notes` | list/create/edit/delete/mark-sent | Changes notes queries/commands |
| `/api/tasks/:id/search` | search | Editor search query |
| `/api/tasks/:id/editor` | root/files/list/read/write | Editor operations/object stream |
| `/api/tasks/:id/local` | changes/diff/blob/stage/unstage/discard/stage-all/unstage-all/discard-all/commit/push | Changes operations using core Git |
| `/api/tasks/:id/database` | connect/disconnect/tables/columns/rows/query/update/insert/delete/saved queries/generate | Database operation catalog |
| `/api/docker` | info; container/image/volume/network list/inspect/action/remove; prune; Compose; task summary/containers/teardown | Docker queries/commands/streams |
| `/api/http/:owner/:repo` | request/variable CRUD and send | HTTP plugin operations; repository becomes node-qualified |
| `/api/agents` | providers/usage; attachment/artifact/session/turn/request/webhook lifecycle | Agents operation/stream catalogs |
| `/api` Notes/Memory | memory list/search/proposals/resolve/create; workspace/task Notes list/get/create/write/include/title/delete | separate Notes and Memory owner contracts |
| `/api` Workflows | definition/run/step/gate/trigger operations | Workflows operation/event catalogs |
| `/api` Terminal | sessions/profiles/status; kill/interrupt/remove/resize/send; repo path/config; task preview/on-created/checkout/archive/MCP | Terminal product operations; generic path/config/worktree/process/run/MCP and Preview work move to their owners |
| `/api/repos` GitHub | repos/refresh; PR list/detail/conflicts/files/blob/batch/create; branches/labels/mentions/compare; all review/merge/Actions mutations | GitHub operation/stream catalogs |
| `/api/integrations/:id` Linear | projects/issues/resolve/comment | Linear normalized operations |
| `/api/integrations/:id` Rollbar | items/detail/occurrences | Rollbar normalized operations |

`MIG-LEDGER-003` The server-route gate walks actual registered routers, not every source file
containing a Hono test or helper. A route that remains reachable but absent above blocks cutover.

## 3. `/api/v1` automation operation inventory

The frozen registry has 190 operations: 166 literal IDs plus six Editor IDs and eighteen
scope-expanded Notes IDs. They are all removed at the wire and mapped semantically below.

| Owner | Exact V1 operation IDs | V2 target |
| --- | --- | --- |
| core system | `core.system.{health,capabilities,principal,plugins}`, `core.settings.api.{get,patch}` | Node descriptor/handshake/capability negotiation; API setting removed |
| core workspaces | `core.workspace.{list,create,bootstrap,get,patch,delete,projects.get,projects.replace}` | core Workspace queries/commands |
| core repositories | `core.repository-assignment.{list,put,patch}`, `core.pinned-repository.{list,replace}` | core Repository assignments/preferences |
| core tasks | `core.task.{list,create,get,patch,archive,restore,status,links.list,links.create,links.delete}` | core Task operations |
| core integrations | `core.integration.{list,connect,credentials,test,patch,delete}` | owning plugin wizards/secrets/operations |
| core commands/UI | `core.commands.{list,get,invoke}`, `core.ui.{windows,primary,window}` | local command registry and typed presentation intents; no remote UI injection |
| Agents | `agents.providers.list`, `agents.sessions.{list,search,create,import-transcript,get,wait,patch,fork,compact,resume-managed,verify-imported-resume,handoff-terminal,delete,export}`, `agents.turns.{enqueue,cancel,patch-queued,remove-queued}`, `agents.requests.resolve`, `agents.artifacts.list`, `agents.webhooks.{list,create,patch,delete,deliveries}` | exact Agents V2 catalog |
| Changes | `changes.git.{status,diff,blob,stage,unstage,discard,commit,push}` | Changes queries/commands |
| Database | `database.connection.{open,close}`, `database.{tables.list,columns.list,rows.list,query,rows.insert,rows.update,rows.delete}` | Database queries/commands |
| Editor | `editor.{root,files,entries,file.read,file.write,search}` | Editor queries/commands |
| GitHub | `github.repos.{list,refresh,labels,branches,mentions,compare}`, `github.blobs.get`, `github.pulls.{list,get,files,refresh,refresh-one,create,merge,comment,close,reopen,prefetch,files.batch,draft,auto-merge.enable,auto-merge.disable,labels.add,labels.remove,files.viewed,review-comments.create,review-comments.reply,threads.resolved,reviews.submit,reviewers.add,reviewers.remove}`, `github.actions.{jobs,job-log,rerun-failed}` | GitHub V2 catalog |
| Linear | `linear.projects.{list,issues}`, `linear.issues.{resolve,get,comment}` | Linear operations |
| Memory | `memory.{entries.list,search,entries.create,proposals.list,proposals.resolve}` | Memory operations |
| Notes | `notes.{global,workspace,task}.{list,create,get,write,delete,included}` | Notes operations; V2 adds rename/append/import/export through new contracts |
| Preview | `preview.{configuration,resolve-url,url.set,navigation,view.delete}` | Preview Node and selected-Client capability contracts |
| Rollbar | `rollbar.items.{list,get}` | Rollbar normalized queries |
| Terminal | `terminal.sessions.{list,create,get,interrupt,kill,delete,resize,send}`, `terminal.{mcp.inspect,mcp.starter,profiles.list,checkout.get,checkout.set,checkout.run-targets,worktree.status,worktree.create,worktree.adopt-checkout,worktree.delete,executions.create,executions.get,executions.cancel}` | Terminal product operations plus core-owned MCP/worktree/process/repo-config capabilities |
| Workflows | `workflows.{definitions.list,runs.start,runs.list,runs.get,runs.steps,gates.resolve,runs.cancel,triggers.evaluate,steps.kill}` | Workflows operation/event catalogs |

`MIG-LEDGER-004` `/api/v1/openapi.json`, `/api/v1/ws`, bearer-token issue/list/revoke and the
listener settings are explicit removals. Every other V1 operation above MUST have a V2 descriptor
in the [core operation registry](../contracts/core-operation-registry.md) or
[current-plugin operation catalog](../current-plugins/operation-contract-catalog.md), with exact
payload fields in the corresponding payload catalog.
No V1 token, path, request field, response field, cursor, sequence or idempotency receipt carries
forward.

## 4. V1 event and live-channel inventory

### 4.1 Renderer-local events

| Exact V1 event | V2 disposition |
| --- | --- |
| `boot:restored` | Electron Client cache restoration phase; never a Node product event |
| `presentation:pane-intent` | typed `NavigationIntent` with node-qualified resource |
| `presentation:terminal-focus` | Terminal focus navigation intent |
| `presentation:file-scroll` | GitHub/diff renderer-local focus/selection state |
| `runtime:task-archived` | core Task product event drives local eviction |
| `runtime:workspace-removed` | core Workspace product event drives local eviction |
| `task:archive`, `workspace:remove`, `app:quit` | Electron prompt/concern orchestration; plugin concern contributions with 250 ms V1 behavior replaced by bounded host prompt workflow |
| browser `acorn:logout` | removed; per-Node revocation/cache partition clearing |

### 4.2 Internal WebSocket channels

| Direction | Exact V1 channels | V2 disposition |
| --- | --- | --- |
| Client → service | `term:input`, `term:attach`, `term:detach` | Terminal stream frames |
| Client → service | `docker:logs:attach`, `docker:logs:detach`, `docker:stats:attach`, `docker:stats:detach`, `docker:exec:open`, `docker:exec:in`, `docker:exec:resize`, `docker:exec:kill` | Docker negotiated stream frames |
| Client → service | `ui:register`, `ui:state`, `ui:command-result` | removed generic public UI bridge; selected-client typed capability results only |
| service → Client | `term:out`, `term:status` | Terminal stream/state event |
| service → Client | `docker:changed`, `docker:log`, `docker:stats`, `docker:stream-end`, `docker:exec:out`, `docker:exec:exit` | Docker facts plus ephemeral streams; content never durable |
| service → Client | `workflow:notice`, `workflow:step:event` | Workflows durable facts/attention plus bounded progress stream |
| service → Client | `agent:event`, `agent:session`, `agent:deleted` | Agents durable events/snapshots |
| service → Client | `ui:command` | removed generic injection; manifest-declared typed presentation intent only |

### 4.3 Public automation events

The exact V1 public channels are `core.workspace.created`, `core.workspace.updated`,
`core.workspace.deleted`, `core.repository-assignment.updated`, `core.task.created`,
`core.task.updated`, `core.task.archived`, `core.task.restored`, `agents.event`,
`agents.deleted`, and `agents.session`.

`MIG-LEDGER-005` Their volatile ring sequences are discarded. V2 emits versioned committed facts
from core/Agents, uses per-Node durable sequence/outbox retention, and forces authorized snapshot
recovery after a replay gap.

## 5. V1 central SQLite table inventory

There are exactly 47 table exports. “Import” means the optional read-only configuration importer;
all tables remain untouched in V1.

| V1 table | V2 owner/disposition | Import |
| --- | --- | --- |
| `repos` | GitHub private mirror DB; canonical core Repository is independently created | owner/name configuration only through `workspace_repos`, not mirror row |
| `pull_requests` | GitHub private mirror DB | no |
| `pr_files` | GitHub private mirror DB/objects | no |
| `reviews` | GitHub private mirror DB | no |
| `comments` | GitHub private mirror DB | no |
| `pr_commits` | GitHub private mirror DB | no |
| `review_threads` | GitHub private mirror DB | no |
| `pr_labels` | GitHub private mirror DB | no |
| `review_requests` | GitHub private mirror DB | no |
| `checks` | GitHub private mirror DB | no |
| `sync_state` | split by owning provider plugin; never core shared sync state | no |
| `viewed_files` | GitHub private user projection | no |
| `pinned_repos` | core repository preference | no; presentation preference excluded |
| `prefs` | split into Electron Client presentation store or owning Node/plugin settings | no |
| `integrations` | owning provider plugin connection metadata plus core opaque secret refs | no |
| `repo_paths` | core Repository checkout/config record | eligible path and declared repository configuration only; owner reconfirms |
| `config_acks` | core exact-snapshot repository trust | no; imported executable config starts untrusted |
| `workspaces` | core Workspace | name/color/icon/order only |
| `workspace_repos` | core Workspace↔Repository membership | owner/name/membership/order |
| `ignored_repos` | core import/discovery preference | selected repository configuration only |
| `workspace_projects` | owning provider binding, not core Workspace | no; credential/provider identity excluded |
| `tasks` | core Task | no |
| `task_links` | core external-reference relation | no |
| `review_notes` | Changes private DB | no |
| `db_saved_queries` | Database private DB | no |
| `memories` | Memory private DB/index | no |
| `terminal_sessions` | Terminal private DB plus core opaque process handles | no |
| `agent_sessions` | Agents private DB | no |
| `agent_turns` | Agents private DB | no |
| `agent_events` | Agents private ledger | no |
| `agent_requests` | Agents private DB | no |
| `agent_attachments` | Agents private DB/object metadata | no |
| `agent_attachment_refs` | Agents private DB | no |
| `agent_artifacts` | Agents private DB/object metadata | no |
| `agent_operations` | Agents private operation journal | no |
| `agent_webhooks` | Agents private DB with core secret ref | no |
| `agent_webhook_deliveries` | Agents private DB | no |
| `workflow_runs` | Workflows private DB | no |
| `workflow_steps` | Workflows private DB | no |
| `issues` | split to Linear/provider private normalized cache | no |
| `issue_resources` | split to owning integration private cache/reference map | no |
| `api_tokens` | removed | never read or imported |
| `oauth_accounts` | owning provider connection/secret state | no |
| `api_idempotency` | removed; V2 core command receipts start empty | no |
| `command_executions` | core process/execution journal | no |
| `http_requests` | HTTP private DB | no |
| `http_variables` | HTTP private DB and core opaque secret refs | no |

`MIG-LEDGER-006` Import reads only the allowlisted columns needed by the four eligible configuration
classes above. It MUST NOT execute `SELECT *`; a schema/version mismatch fails the affected preview
item. Repository setup/dev/restart/teardown/database text, preview/Docker matching and branch-prefix
configuration are read only from their documented repository-configuration source, never inferred
from operational tables.

## 6. Client contribution and persistence inventory

| V1 registry | Exact shipped entries | V2 disposition |
| --- | --- | --- |
| task panes (11) | `pr`, `agents`, `changes`, `notes`, `context`, `editor`, `search`, `database`, `preview`, `docker`, `http` | manifest task-pane contributions; same visible panes by default |
| integration panes (2) | `linear`, `rollbar` | provider task-pane contributions; dormant until configured |
| sources (5) | `docker`, `http`, `agents`, `linear`, `rollbar` | workspace/Fleet source contributions |
| Agent context (5) | `acorn-task-context`, `acorn-terminals`, `acorn-database`, `acorn-docker`, `acorn-http` | context-section/capability contributions with caller delegation |
| Agent tool renderer (1) | Changes renderer | agent-tool-renderer contribution using standard diff |
| pollers (3) | core task status, workflow trigger, Docker task | scheduled/event workers with manifest policy/checkpoint |
| task slots (2) | `docker-footer-badge`, `docker-rail-badge` | badge/task-slot contributions |
| shell slots (7) | `security.config-trust`, `notifications.bell`, `terminal.topbar-toggle`, `palette.commands`, `palette.files`, `palette.workspaces`, `palette.pull-files` | core/system/Verified shell-slot contributions |
| settings (14 production + 1 dev) | `workspaces`, `workspace.detail`, `appearance`, `integrations`, `mcp`, `agent-tools`, `agent-pricing`, `workflows`, `terminal`, `docker`, `http`, `shortcuts`, `permissions`, `api`; dev `gallery` | V2 scoped settings; `api` becomes removal notice/device management; dev gallery is development-only |
| notice kinds (11) | `finished`, `needs-input`, `exited`, `error`, `gate`, `run-done`, `background-error`, `repo-config-trust`, `agent-completed`, `agent-needs-input`, `agent-error` | notification/attention kinds with privacy/dedup/target/expiry policy |
| provider content links (1) | Linear external-reference detector | declared Linear capability/navigation intent; GitHub has no direct import |

The V1 persisted registry contains 21 descriptors: `core.task-layouts`, `core.notices`,
`editor.open-files`, `github.pr-filters`, `context.section-selection`, `docker.prefs`,
`core.theme-follow-system`, `core.theme`, `core.theme-light`, `core.theme-dark`, `core.style`,
`core.keybindings`, `core.pane-shortcuts-legacy`, `github.diff-view`, `core.rail-order`,
`terminal.rail-default`, `terminal.height`, `terminal.font-size`,
`core.startup-context-injection`, `core.onboarded`, and `agent-tools.permissions`.

`MIG-LEDGER-007` None is imported. V2 reassigns each to Electron Client presentation state,
core/plugin Node settings, or removal. Fresh-install defaults and visible behavior are verified by
the desktop parity contract.

## 7. Closure gate

`ACCEPT-MIG-LEDGER-001` The extraction tool reports 47 tables, six renderer Client events, three
will-phase events, the exact internal WS channel union, eleven public event channels, 190 public
operations and the contribution counts above.

`ACCEPT-MIG-LEDGER-002` Every extracted item has exactly one disposition. Duplicate ownership,
missing ownership and “temporary shared V2 table/private route” dispositions fail.

`ACCEPT-MIG-LEDGER-003` Starting V2 and exercising parity traffic produces no request to `/auth`,
`/api`, `/api/v1`, no open of the V1 database, and no lookup of a V1 token.

`ACCEPT-MIG-LEDGER-004` The 25 direct cross-feature imports in the
[extraction map](./coupling-and-extraction-map.md) reach zero before runtime plugin loading is
enabled; generated schemas and declared public contracts are the only permitted cross-package
types.
