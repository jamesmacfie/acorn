# Secrets, routes, and agent tools

This page covers how a loaded plugin borrows a credential, what task tokens may reach through its
routes, and the rules for the agent tools it contributes. Read it before you add a credential-shaped
API or an agent tool. It's part of [plugin security](./node-plugin-security.md).

## Secrets

The goal is that plugin code never holds a decrypted secret. Model providers already work that way:
an adapter registers, consumers call `generateTextForConnection`, and the key never leaves core's
use-scoped call path.

Loaded integration providers have three compatibility exceptions. Each is bounded by the host to one
owner and provider, and none is a general read or lookup:

- `PluginProviderRuntime.withConnections` lends a decrypted credential inside a provider-owned async
  callback, matching the built-in `forEachConnection` contract.
- A connection contribution's `projects.list({ connection, secret })` is the same lend, for the
  project picker.
- `PluginProviderRuntime.items(providerId)` returns a provider-scoped store object synchronously,
  rather than plain data over an async call.

Moving the node half out of process must turn the two credential callbacks into an explicit visitor
protocol, or replace them with the credential-injecting broker below, rather than put a long-lived
secret on the wire. Each new callback- or object-shaped contract raises the cost of that move, so
prefer a route the host fetches when one can do the job.

A Node-side contribution with no request, such as GitHub's create-PR agent tool, uses
`ctx.providers.withConnection(userId, providerId, callback)`. The host checks that the plugin owns the
provider, picks only the first usable connection so a write can't fan out, lends the secret for that
callback, and applies scrub-on-throw. A task-scoped child can't call provider-spending routes, so the
write-tier tool invocation is the authorization, and the trusted plugin makes the call.

### The credential-injecting broker

This is the target design, not shipped code:

1. A plugin registers a named credential slot, such as `ntfy-token`, and the user fills it through
   core's secret storage and settings. The plugin's own tables never store it.
2. For an authenticated request, the plugin asks the broker to, for example, GET a URL with
   `ntfy-token` as `Authorization: Bearer`. The Node attaches the secret, makes the call, and returns
   the answer.
3. The broker enforces the manifest's `net` allowlist on brokered traffic, and follows a redirect only
   within that set, because a redirect to another host with the header attached is the classic leak.
4. The response body goes back to the plugin. The credential never does.

It would be a `ctx.core` facet gated by `secrets: true`, and the only thing that grant gives. There's
no "read secret value" call on the public surface to abuse or retire later.

## Routes and task tokens

The host passes the verified principal to compiled routers and fetch handlers. Task-shaped mounts
enforce the signed task ID ([task scope](./transport-and-auth.md#task-scope)). A handler outside those
mounts checks resource scope from the principal before doing work. Database CLI and context handlers
enforce supplied task IDs, and Memory resolves the caller's project before reading files.
Device-only administration is gated on its own.

There's no blanket task-token denial and no per-route opt-in metadata. A default-deny policy with
opt-in metadata and trust-prompt disclosure is a design, not a control.

Keep every broadcast a third party can hear content-free or scoped to the plugin itself.
`ctx.events.status()` is content-free by design, so one plugin's events can never carry another's data
to a subscribed frame. The bridge filters frames by declared channel, and this rule is what makes that
filter enough.

## Agent tools

- **A plugin-contributed tool is a prompt-injection surface.** An LLM reading hostile content can
  call it. The risk metadata and per-owner tool permissions apply
  ([agent tools](../agent-tools.md)). Trusting a plugin's code and trusting an agent to call its tools
  on its own are separate decisions, so the UI keeps them apart.
- **The `execute` tier is denied by default.** A tier the owner hasn't decided falls back to
  `TOOL_TIER_DEFAULTS` (`@acorn/protocol/toolPermissions.ts`), where `execute` is `false`. `read` and
  `write` are allowed and written out, so the next tier added has to say which it is. The Node and
  Settings read the same constant.
- **Loaded tool and context routes get task authority, never device authority.** A manifest's
  `agentTools[].handler` and `contextSections[].read` paths are confined to the declaring package at
  parse time. Core calls them with an internal principal whose user, task, session, and signed tool
  ceiling came from the authorized caller, and IDs in the body can't widen it. Schemas, answers,
  deadlines, and output sizes are bounded before data reaches MCP or prompt assembly. A failed context
  section is recorded as unavailable without failing its siblings.
- **A reviewer prompt isn't a sandbox.** Before a provider can back a read-only reviewer preset,
  conformance tests must prove both the acorn tool ceiling and the provider's own limits on edits,
  shell commands, and other writes. A provider that can't enforce both isn't offered for that preset.
- **Delegation authority is direct and fails closed.** The agents plugin records each spawn's signed
  owner task and session before it creates a child. Prompt, wait, read, and cancel need that exact
  owner and child pair. Missing, foreign, sibling, ancestor, descendant, and cross-task ids all return
  the same `not_found`. A managed child can't approve its own permission or question request.
- **Tool ceilings only narrow.** A delegated child gets the intersection of its parent's signed
  ceiling and any requested one. A workflow-owned session can't spawn a child, because workflow budget
  accounting doesn't count delegated descendants. The execute permission, the depth-two limit, the
  12-live-descendant limit, and the runtime concurrency ceilings are separate gates.

## Why

The first rule of the design is no general secret read path, because a method that returns a secret
can't be taken back once plugins depend on it. Every exception above is a visit the host controls,
scoped to one connection and one operation, and the list stays short on purpose.
