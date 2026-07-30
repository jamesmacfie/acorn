# `/api/v1` removal and V2 replacement

**Status:** Normative breaking-change contract<br>
**Requirement prefix:** `MIG`

Acorn V2 does not mount or emulate the V1 public automation API.

`MIG-060` Requests to `/api/v1`, including WebSocket upgrades, MUST return `404` from a V2 Node.
They MUST NOT redirect, issue a V2 credential, or disclose whether a V1 token was valid.

`MIG-061` V1 bearer tokens MUST NOT be read, imported, hashed into a V2 database, or accepted during
pairing. V2 owner Clients authenticate with mutually authenticated device certificates.

## Replacement model

| V1 concept | V2 replacement |
| --- | --- |
| Bearer token | Paired owner Client certificate; plugin-scoped host capability |
| Core REST resource | `/v2` OpenAPI resource query/command |
| Plugin REST namespace | Manifest-declared plugin query/command/capability |
| Public WebSocket event | Authenticated `/v2/events` subscription with durable cursor |
| Terminal public frames | Negotiated terminal stream |
| `read`/`write` token scopes | Full owner Client authority; fine-grained plugin capability grants |
| In-memory replay ring | Durable Node outbox, seven-day/256-MiB bound, snapshot recovery |
| V1 idempotency table | V2 command receipt with canonical request digest and expiry |

`MIG-062` V2 MUST publish an operation mapping for every V1 endpoint used by a current Acorn feature.
“Removed without replacement” is permitted only for the V1 token-management and compatibility
surfaces, and MUST be explicit.

`MIG-063` The V2 Node protocol is not a general unauthenticated or bearer-token automation service.
Future headless automation requires a separate decision and principal model.

## Exhaustive V1 surface disposition

This table is the owner/family index for every route registered by the V1 core and plugin public-API
registries. The named V2 contract documents contain the individual query and command identifiers;
there is deliberately no route-by-route wire-compatible alias.

| V1 owner and operation family | V2 disposition | Normative target |
| --- | --- | --- |
| core health, capabilities, principal, plugins | replaced by authenticated Node descriptor, handshake and capability negotiation | `GET /v2/node`, `POST /v2/session/handshake`, `PUT /v2/session/capabilities` |
| core API settings and token issue/list/revoke | removed without replacement | pairing/device management; V1 tokens are invalid |
| core workspace CRUD, bootstrap, projects, repository assignments and pins | replaced by core snapshot queries and node-qualified workspace/repository commands | [core operation registry](../contracts/core-operation-registry.md) and Workspace events |
| core task CRUD, archive/restore, status and links | replaced by node-qualified task queries and commands | [core operation registry](../contracts/core-operation-registry.md) and Task events |
| core integration list/connect/credentials/test/update/delete | replaced by owning-plugin settings, secret broker and setup/repair wizard contracts | plugin settings/wizard/capability operations |
| core presentation command list/invoke/status | split: discovery remains a Client command registry; invocation is a typed Electron presentation intent | no remotely injected UI command and no cross-Node mutation |
| GitHub repository, pull, files/blobs, review, labels, reviewers, Actions, refresh and prefetch | replaced by GitHub plugin queries, commands, capabilities and large-object transfers | [GitHub plugin contract](../current-plugins/github/README.md) |
| Terminal sessions, input/resize/interrupt/kill, executions, profiles, MCP, checkout/run-target and worktree | replaced by Terminal queries/commands/streams plus core process/worktree/config-trust capabilities | [Terminal plugin contract](../current-plugins/terminal/README.md) |
| Agents providers, sessions, turns, requests/permissions, lifecycle, import/export, artifacts and webhooks | replaced by Agents queries/commands/events/streams and owner-attention contracts | [Agents plugin contract](../current-plugins/agents/README.md) |
| Changes status/diff/blob/stage/unstage/discard/commit/push | replaced by Changes queries and optimistic commands using core Git/worktree capabilities | [Changes plugin contract](../current-plugins/changes.md) |
| Editor root/files/entries/read/write/search | replaced by Editor queries, commands and object/stream transfer | [Editor plugin contract](../current-plugins/editor/README.md) |
| Notes workspace/repository/task list/get/create/write/delete/inclusion | replaced by Notes-owned scoped queries/commands/events | [Notes plugin contract](../current-plugins/notes.md) |
| Memory entries/search/proposals/resolve | replaced by Memory-owned queries/commands/events | [Memory plugin contract](../current-plugins/memory.md) |
| Workflows definitions/runs/steps/gates/triggers/cancel/kill | replaced by Workflows queries/commands/events and durable activity projections | [Workflows plugin contract](../current-plugins/workflows/README.md) |
| Preview configuration/resolve URL/set URL/navigation/delete view | Node configuration operations remain plugin queries/commands; navigation becomes an Electron browser presentation intent | [Preview plugin contract](../current-plugins/preview/README.md) |
| Database connection/schema/rows/query/DML | replaced by Database queries/commands, result streams and destination-bound credential use | [Database plugin contract](../current-plugins/database.md) |
| Linear project/issue/resolve/comment | replaced by Linear queries/commands and external-reference capability | [Linear plugin contract](../current-plugins/linear.md) |
| Rollbar item list/detail | replaced by Rollbar queries and source promotion/navigation intents | [Rollbar plugin contract](../current-plugins/rollbar.md) |
| `/api/v1/openapi.json` and `/api/v1/ws` | replaced by the V2 OpenAPI artifact and the authenticated, cursor-based AsyncAPI socket; neither endpoint preserves V1 shape | [V2 contracts](../contracts/README.md) |

`MIG-064` The implementation inventory MUST enumerate every frozen V1 registry operation under
exactly one table row above and verify that its referenced plugin/core dossier names an individual
V2 query, command, capability, stream, presentation intent, or explicit removal.

The normative [V1 surface disposition ledger](./v1-surface-disposition-ledger.md) freezes the
complete 190-operation registry together with interactive routes, event channels, 47 tables and
Client contribution registries.

`MIG-065` A V2 operation MAY retain a familiar semantic name, but it MUST use the V2 resource,
authentication, authorization, error, idempotency, concurrency, event and version contracts. Name
similarity does not constitute compatibility.

## Owner communication

The V2 release notes and first-run UI MUST state:

- V1 automations do not connect to V2;
- existing bearer tokens are not migrated;
- V1 remains available against its untouched data;
- V2 uses device pairing, not pasted API tokens; and
- a new automation principal may be designed later without weakening paired-client identity.

`ACCEPT-MIG-010` A valid V1 token receives no different response from an invalid token at V2
`/api/v1`.

`ACCEPT-MIG-011` Searching the V2 data root after configuration import finds no V1 token identifier,
hash, label, scope, or secret.
