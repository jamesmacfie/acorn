# Agent tools

Agent tools are Node-owned capabilities projected to the renderer and to task-scoped MCP clients.
The registry and schemas live in `packages/node-core/src/server/agentTools/` and plugin contributions
live beside the feature they operate.

## Contribution

```ts
type AgentToolContribution = {
  name: string
  description: string
  risk: 'read' | 'write' | 'execute'
  input: ZodSchema
  requiresSession?: boolean
  execute(input, context): Promise<unknown>
}
```

The exact type carries more metadata for rendering, permissions, and task context. A contribution
must validate input again at execution time and use CoreServices for files, Git, processes, secrets,
and task lookup.

Tool groups cover task and context inspection, the issue and error trackers, Git and changes, the
pull request, notes, memory, findings, terminal handoff, and browser operations. Nothing drives a workflow,
opens a database, or talks to Docker: [the MCP doc](./mcp.md) § Tool surface says why, and the
registry is the authority on the list.

## GitHub

Three tools, one write and two reads.

`github_pull_create` is write-tier. It is available only for a managed session on a task with a
GitHub project and branch, creates from that branch, and records the session in core's task-PR
relation before returning whether the new PR became primary or related.

`pr_review_comments` and `pr_checks` are read-tier, and both read the mirror this plugin already keeps
fresh, so neither spends a credential or touches the network. Between them they answer the two
questions an agent on a reviewed PR has: what did people say, and what is red. The first groups the
mirror's per-comment `review_threads` rows back into threads and leaves resolved ones out unless
asked; the second returns every check with its raw status plus the failing names, by the same rule the
ci-loop step uses (`checkFailed` in `plugins/github/src/server/mirrorQueries.ts`).

Both distinguish an unmirrored pull request from an empty one, and say which in a `status` field. A
task whose PR has never been mirrored is not a PR with no feedback, and it is not a green one.

## Findings

The findings plugin contributes two read tools and two write tools. All four derive the task from the
tool context. The record and withdraw tools also require a signed managed-session claim.

| Tool | Input | Result |
| --- | --- | --- |
| `findings_record` | Source key, kind and version, title, Markdown body, claim status, evidence, and optional correction ID | Observation ID, whether the call created it, and the scope revision |
| `findings_list` | Optional cursor, limit, and `active` or `history` state | A bounded page, next cursor, and scope revision |
| `findings_get` | Observation ID | The observation, provenance, evidence, correction link, and withdrawal history |
| `findings_withdraw` | Observation ID and optional reason | Whether the call changed the record and the scope revision |

An agent can record only for its signed task and session. It can withdraw only an observation from
that session. Cross-task and foreign-session lookups return `not_found`. Repeating a source key with
the same payload returns the original record; changing the payload returns `conflict`. These calls do
not generate notices or attention items. For the data and limits, see [Findings](./findings.md).

## issue_detail

`linked_issues` answers "what is attached to this task" from the cached summary: an identifier, a
title, a URL and a state. An agent asked to implement a ticket needs the description and the
comments, and an agent asked to fix an error needs the trace. Neither is in a summary, and neither is
in the task-context prompt, which is why an agent used to fall back to its own Linear connector and
fail.

`issue_detail` is the read that closes that gap. It takes an identifier, an optional provider and an
optional `refresh`, asks every connected workspace in turn, and returns the first that answers.
Read-tier, so it is permitted by default.

Core owns the tool and the provider owns the read. That split remains intentional even though Linear
and Rollbar can now declare loaded tools: one shared `issue_detail` name searches every connected
provider, while a manifest tool belongs to one package and one owned route. What each provider
declares is `detail` on its provider contribution, a function core calls once per
connection with one method lent back to it:

```ts
export type ProviderDetailContext = {
  resource<TInput, TOutput>(resourceId: string, input: TInput, force?: boolean): Promise<RouteResult<TOutput>>
}
export type ProviderItemDetail = (context: ProviderDetailContext, identifier: string) => Promise<unknown | null>
```

That one method is the same resource runtime the provider's own routes go through, so the cache, the
TTL, the request budget and the credential scope are the ones already in place. The provider composes
its own resources rather than pointing at one, because only it knows how many the answer takes:
Linear reads the issue, and Rollbar reads the item, its occurrence list and the newest occurrence,
where the trace is.

Three answers have to stay apart. A value is the item. `null` is "not in this connection", which is
what every workspace but one legitimately says. A throw is that workspace refusing, and core reports
it rather than the not-found, because a 401 from the workspace that owns the ticket must not read as
"no such ticket".

A provider that declares no `detail` offers summaries only. Naming it explicitly is a `bad_request`
that says so, and when no provider declares one the tool's `when` withholds it entirely.

## Loaded manifest carriers

A loaded package does not receive the live `ctx.tools` or `ctx.contextSections` registries. It
declares data in `acorn-plugin.json`, and the host adapts that data into the same registries used by
compiled plugins:

```json
{
  "contributions": {
    "agentTools": [{
      "id": "lookup",
      "description": "Read the package's task-local record.",
      "inputSchema": {
        "type": "object",
        "properties": { "id": { "type": "string", "minLength": 1, "maxLength": 100 } },
        "required": ["id"],
        "additionalProperties": false
      },
      "risk": "read",
      "scope": "task",
      "handler": "/v2/p/example/tools/lookup",
      "timeoutMs": 5000,
      "maxOutputBytes": 65536
    }],
    "contextSections": [{
      "id": "references",
      "label": "Example references",
      "scope": "task",
      "order": 60,
      "read": "/v2/p/example/context/references",
      "defaultIncluded": false,
      "timeoutMs": 5000,
      "maxBytes": 32768,
      "maxTokens": 4096
    }]
  }
}
```

Tool IDs are lowercase snake case and become `<pluginId>_<id>` in the registry. The compatibility
case where a context section's local ID equals its plugin ID keeps the established `<pluginId>`
section ID; other sections become `<pluginId>:<id>`. Persisted tool and inclusion preference IDs must
not be renamed casually.

The accepted JSON Schema language is deliberately small: one object root, object/array/scalar types,
`properties`, `required`, boolean `additionalProperties`, `items`, `enum`, string/number/array limits,
and descriptions. `$ref`, remote or recursive schemas, combinators, executable validators, and every
unknown keyword fail manifest validation. A schema is limited to 64 KiB, eight levels, 64 properties,
and 64 enum values. The host compiles it once and validates arguments on every call.

The handler receives `POST { arguments, origin: { taskId, sessionId?, callId? } }`. Those origin fields
are informational: the route's `PluginRequestContext.principal` is built by the host from the verified
task/session token and signed tool ceiling. The handler route is confined to the declaring plugin,
and the internal task principal cannot use device-only routes. Owner preferences, session requirement,
risk permission and signed ceiling all run before dispatch. Handler output must be JSON and fit the
declared limit (1–256 KiB); timeouts are 100 ms–30 seconds and return the ordinary `timeout` tool error.

A context read receives `POST { origin: { taskId }, scope: "task" }` under a host-built task
principal and returns:

```json
{
  "items": [{
    "id": "record-1",
    "kind": "reference",
    "label": "Record one",
    "body": "Bounded reference text",
    "details": ["optional detail"],
    "sources": [{ "label": "origin", "uri": "urn:example:record-1" }]
  }],
  "compact": "## Example references\n- Record one",
  "omitted": 0,
  "unavailable": { "detail": "optional non-fatal status" }
}
```

The response is a strict, bounded data shape, never a renderer or formatter function. The assembler
applies the descriptor's byte/token ceilings and the 512 KiB global budget in deterministic
`order`, then ID order. A timeout, HTTP failure, oversized response or invalid response marks that
section unavailable (with `timeout`, `unavailable`, or `invalid-response`) and does not discard its
siblings. `defaultIncluded` supplies only the initial inclusion; an owner's explicit include list
remains authoritative. Returned text is reference data, not host instructions.

The descriptor adapter never retries a handler. The MCP loopback proxy may reconnect after a node
restart, but it keeps one `x-acorn-tool-call-id` for the logical call. A mutating domain must use that
ID (or its own domain key) for idempotency; a lost plugin reply is not permission to repeat a write.
Reload first removes the old owner's registrations and replays the new descriptor set. Failed reload
restores the prior set; successful update and unload cannot leave a stale tool or context section.

## Projections

The same registry is projected into:

1. `GET /v2/core/agent-tools` for the Settings → Agent tools catalog.
2. `/v2/core/tasks/:id/tools` and `/v2/core/tasks/:id/tools/:name` for the renderer.
3. The stdio MCP server for a spawned agent.

Renderer calls require a device principal. MCP calls require an internal principal whose token is
bound to the task. The Node applies the caller scope, task identity, and the owner's per-tool
permission preference before executing.

Permissions have two layers, persisted together as one prefs slice under `agentTools.perms`: a
**tier** default (`read` / `write` / `execute`) and a **per-tool** override. A per-tool toggle wins
over its tier. Turning a tier off removes every tool at that risk level from `tools/list` and rejects a
direct harness call for one of them. This applies before any workflow or profile ceiling, which can
only narrow the tool list further.

A tier the owner has never touched falls back to `TOOL_TIER_DEFAULTS`
(`@acorn/protocol/toolPermissions.ts`): `read` and `write` allowed, **`execute` denied**. That is the
state every installation is in for a tool that ships in a later release, which is why the fallback
matters more than it looks. Adding an execute tool used to grant it to everyone on upgrade with nothing
shown to the owner; now it is inert until someone turns the tier on in Settings → Agent tools. The
node's `isToolPermitted` and the settings page read the same constant, so what the page draws is what
the wire enforces.

## Managed-session orchestration

The Agents plugin contributes five execute-tier tools for agent-driven delegation. They operate on
managed sessions through `ManagedAgentRuntime`; they do not create workflow runs or mutate workflow
definitions.

| Tool | Input | Result |
| --- | --- | --- |
| `agent_spawn` | `title`, `prompt`, optional `profileId`, `isolation`, `resultSchema`, `configOptions`, and `toolCeiling` | Stable spawn, task, session, and initial-turn IDs; depth; provisioning state; and cursor |
| `agent_prompt` | `sessionId`, `prompt`, and optional `resultSchema` and `configOptions` | Durable turn ID, queue state and ordinal, session state, and cursor |
| `agent_wait` | `sessionId`, `afterSeq`, one of `ready`, `attention`, `turn_completed`, or `stopped`, and `timeoutMs` | Whether the condition matched or timed out, plus state, attention, and the latest sequence |
| `agent_read` | `sessionId`, `afterSeq`, and `limit` | A bounded page of folded assistant messages, diagnostics, errors, and validated structured output |
| `agent_cancel` | `sessionId` and an optional `turnId` | The cancelled turn and resulting session state |

`agent_spawn` defaults to shared-task isolation and starts the first turn before returning. Worktree
isolation creates a selectable child task, but the managed session remains the execution authority.
The caller can prompt, wait for, read, or cancel only a direct child recorded in the Agents plugin's
spawn ledger. A missing, foreign, sibling, ancestor, descendant, or cross-task ID returns
`not_found`.

These contributions set `requiresSession`, so the registry hides them unless authentication supplies
a signed task and session claim. A transport `x-acorn-session-id` header cannot satisfy that gate.
The MCP proxy assigns one `x-acorn-tool-call-id` to each logical call and keeps it across a loopback
retry. Spawn, prompt, and cancel scope that ID to the signed owner and operation so a retry cannot
create a second resource.

The owner must enable the execute tier or the individual tools. The server also intersects a child's
requested tool ceiling with the signed parent's ceiling and persists the result in the child session.
A workflow-owned managed session cannot see `agent_spawn`, because delegated descendants are not
charged to workflow budgets. Delegation depth is capped at two, and each root can have at most 12
live descendants. Managed runtime workspace and provider concurrency limits still apply.

If a turn declares `resultSchema`, the Agents plugin adds the result contract to the prompt and
validates the returned JSON against that schema. `agent_read` reports a diagnostic instead of
returning malformed structured output. Reads page the durable event sequence, fold assistant deltas,
omit verbose tool and attachment payloads, cap individual text items at 16 KiB, and cap projected
text at 64 KiB per response. Waits last at most 30 seconds and a timeout does not cancel the child.

## Context sections

Plugins register context sections through the Node context-section registry. Each contribution
declares its wire order and the registry sorts by that value, so core keeps no list of plugin IDs.
Core applies byte and token budgets, records section status and freshness, and returns a
deterministic snapshot. GitHub, notes, memory, Linear, Rollbar, and task sections are optional
contributions, and one failing section does not discard its siblings.

A section is also *shaped* by the plugin that owns its rows, not just registered by it: `pr` lives in
`plugins/github/src/server/contextSection.ts`, `notes` and `memory` in the same file under their own
packages. Core offers `truncateBytes` and `formatOmitted` through `@acorn/plugin-api/node` so a
section's own `format` applies the same ceiling arithmetic core applies to items, and keeps the
assembly, the declared order and the 512 KiB budget.

Core's own `issues` section registers at module scope in `contextSections.ts`, not through
`wireAgentTools`. `wireAgentTools` is not called on every boot shape: the standalone Node
(`pnpm dev:node`, and any Node a client pairs with over the LAN) never calls it. Registering at
module scope means the section, and its "Linked issues" row in the context pane, exists on that boot
too.

Orders are spaced by 10 so a new section slots between two without renumbering. The order is
load-bearing: every prompt, the client's Manifest preview, and the byte-exactness rule below assume
`pr`, `issues`, `notes`, `memory` in that sequence, so changing a number changes what an agent reads.

A section's `compact` rendering must not depend on which other sections ship alongside it. That lets
the client assemble the exact context block a send will produce from a single `include=*` inventory,
by filtering `ctx.sections` and calling `formatContextBlock`, with no second curated fetch. A section
that reads sibling-inclusion state into its own `compact` breaks byte-exactness silently.

`sections` is the canonical context representation for the renderer and the MCP context formatter.
The response also keeps the top-level `pr`, `issues`, `notes`, and `memory` fields as a bounded
compatibility projection for older task-context clients and agent tools. Both views come from the
same contribution and are budgeted in one pass. A protocol-version migration can drop the projection
once those consumers move to `sections`.

### Drawing inside a section

A section the node assembles is data. What the Context pane draws under it is a separate question, and
the pane answers it with an extension point rather than a private registry: `context:section`, a
`remote` point that stacks, keyed by the section id. For more information, see the cooperative
extension points in [the plugins doc](./plugins.md).

Memory is the one contributor. Its proposal queue and its add-memory form are a component registered
against `context:section` with `matches: ['memory']`, so context draws its own rows for the section and
memory's card joins them. Neither plugin imports the other. Disable memory and the section still draws
its rows.

A compiled plugin contributes a component and the host mounts it. A loaded plugin contributes a bundle
entry and the host runs it in a worker. The owner writes one `Slot` and cannot tell which answered.

`issues` and `task_links` are core tables. For more information, see the external-item read model in
[the data layer doc](./data-layer.md). GitHub and Rollbar write them through the `ExternalItemStore`
seam rather than owning them. The core-owned `issues` section is the only one that reads the database
handle, which is why the shared `PluginContextSection` contract can withhold that handle from every
other section at no cost.

## plugin_authoring

`server/agentTools/pluginAuthoring.ts` (`read` tier) teaches an agent to write a plugin for the node
that will run it. It takes no arguments and answers with a markdown guide plus the same facts
structured, so a manifest can be checked without parsing prose.

The rule it enforces is: never answer a plugin API question from memory. Everything an author gets
wrong by remembering is derived at call time. The manifest key list, the cap on each contribution,
the two closed action-verb sets, the frame targets, the host slots, and the command categories all
come out of `z.toJSONSchema(pluginManifestShape)`. The `permissions.node` blocks come from the same
schema, and its `core` facet list from `server/plugins/permissions.ts`. The frame bridge's message kinds,
`ui` ops, document ops, webview ops, and HTTP methods are read off the wire union in
`@acorn/protocol/plugin/bridge.ts` through `satisfies`, so a new message kind is a compile error here
rather than a silent omission. Only process is hand-written, because no schema states it, and
`pluginAuthoring.test.ts` re-derives every list and asserts it reached the rendered text.

Two things it leaves out. The `@acorn/plugin-api` export list, because a hand-written plugin cannot
import that package and a packaged node has no copy of `surface.snapshot.txt` to read. The snapshot
has its own drift gate and is the answer for a plugin that is built. And the grantable
`permissions.api` scope names, because that allowlist lives in the client and the node cannot import
it. A wrong scope name in a guide the agent believes is worse than none.

It answers through a context section rather than an `agentContexts` descriptor because the shapes
don't match. `agentContexts` is a manifest key, so a core-owned entry would mean core pretending to
be a plugin, and its contract is an `options` GET plus a `capture` POST against a plugin's own
namespace, a picker over rows. `contextSections` already has the one dial this needs,
`defaultIncluded: false`.

Neither door is a new route. The tool call and the context section both resolve inside the Node
process, so nothing was added to the frame allowlist (`client-core/host/frames/scopes.ts`). The
one place a frame can reach this text is `GET /v2/core/tasks/:id/context` with an explicit
`include=plugin-authoring`, a read of acorn's own published contract under a scope the task owner
already granted.

The `defaultIncluded: false` flag is what makes the section affordable. A task that is not writing a
plugin never assembles it and pays nothing, while a human who is can tick **Plugin authoring** in the
composer's context picker, or an agent can ask for it with
`task_context { include: 'plugin-authoring' }`.

## plugin_request

One core tool sits apart from the rest, and it is worth reading before adding anything like it. It
lets an agent ask the owner to install, update, or remove a plugin on this node
(`server/agentTools/pluginRequests.ts`, `execute` tier, never projected to the renderer). It is the
only tool whose subject is which code the node runs.

It installs nothing. It writes a row in an in-memory queue, broadcasts a content-free notice, and
throws `needs-trust` (409) with a sentence telling the agent to call again with the same arguments to
collect the owner's answer. The owner answers in the shell, and the device then performs the install
over the device-gated `/v2/core/plugins/*` routes with its own principal. Prompt injection is a named
threat, so an agent must never hold a credential that can install code. The defence is structural:
that module imports no installer, no data root, and no filesystem, and a test pins its import list so
a convenience import fails the build rather than the boundary.

Only the first raise of a given request rings the bell, 20 outstanding requests is the cap, and
collecting a decision spends the row, so a second identical call is a new question rather than a
second use of an old yes. The agent's `reason` string is capped and rendered as text. It explains the
request and is not evidence for it. For the full flow, see approval-mediated install in
[the plugins doc](./plugins.md).

## Safety rules

- Tool input and all path and task IDs are validated at the Node boundary.
- Task-scoped callers cannot address another task.
- Secrets are used through scoped provider APIs and never returned by a tool.
- Child processes use the process broker and bounded output.
- Agent text is not control flow. Workflow gates consume structured step output only.
- Tool failures use the common API error envelope and do not expose provider payloads or credentials.

## Adding a tool

Add the contribution to the owning plugin, register it in the Node plugin host, add the protocol and
client rendering metadata if needed, and test it through the real `createApp()` route and MCP
projection.

## Browser tools

`plugins/browser` contributes the `browser_*` tools (navigate, snapshot, act, screenshot) through the
same registry, so they project to the renderer and to MCP like every other contribution, and an agent
on any node, including a headless remote one, gets a browser. The plugin ships `playwright-core` and
drives an installed Chrome. The browser itself is in no bundle, and the tools report why they are
unavailable on a machine without one. The plugin is compiled rather than loaded because
`playwright-core` carries native bits a hash-addressed loaded bundle cannot.

Rich results are audit-ready by construction. A screenshot is a row in the plugin's own table, keyed
to the task and capped per task, and the tool result is a URL handle rather than inline base64, so it
outlives the transcript. An audit trail of tool usage belongs at the registry dispatch seam, where
every call already passes, not inside this plugin.

The insert and newest-20 retention sweep complete before
`plugin:browser:captures-changed { taskId }` is published. `browser.captures` then lists ordered
metadata for that task; pixels stay behind the authenticated capture route. The older
`capture-created` frame remains for one compatibility period, but new consumers use the collection
event so a missed frame or retention deletion self-heals on re-read.

The user's preview pane and the agent's browser are two surfaces on purpose. The shell's child
webview is view-only for the person, covered by host-owned webviews in [the shell doc](./shell.md),
and when the agent needs to see what the user sees, it points its own browser at the same tunnel URL.
