# Node-side extension points

[Back to plugins](../plugins.md)

## Node-side extension points

The same model, on the node, for the same problem: plugin A opens a named point and any number of
plugins deliver into it. `ctx.extensionPoints` (`node-core/server/pluginHost/extensionPoints.ts`), with
three calls — `declare(point, label)`, `handle(point, entry)`, `handlers(point)`. They are the same
three words [hooks](node-side-extension-points.md#hooks) uses, because it is the same shape asked a different question
(§ One vocabulary across the registries). They were `open`, `contribute` and `entries` until
2026-08-31; those spellings still work and are deprecated.

It exists because capabilities are single-provider by construction. `ctx.capabilities.provide` throws
on a second provider, and that is correct for what a capability is — a named typed function with one
owner — but wrong for "many plugins each add a workflow step kind". Every such case was becoming a
private registry inside the plugin that needed it, each with its own duplicate check and its own
disposer convention (2026-08-27 extensibility review, finding 4).

**Reach for a capability when there is one right answer, and for a point when there are many.** And
reach for a [hook](node-side-extension-points.md#hooks) when the many are being asked a question rather than adding a thing: a point
collects values, a hook runs a chain and comes back with a verdict.

The rules are the client's, so there is one model to learn:

| | |
| --- | --- |
| the point's name | `<ownerPluginId>:<pointId>`. Checked against the opening plugin, so a package cannot open a point in a stranger's name. |
| the entry's id | `<contributorPluginId>:<entryId>`, minted by the host. Two plugins may use the same entry name without either shadowing the other. |
| ordering | by `order`, ties broken on id, so two entries at the same order are stable rather than dependent on init sequence. |
| duplicates | one plugin filing two entries under one id on one point throws. |
| lifecycle | both halves — points opened and entries filed — go when the plugin does. |
| resolution | `handlers()` is resolved per call, never cached at init. Contributing to a point nobody has opened yet is fine and expected: init order is not a dependency contract, so the entry waits. An unopened point reads as empty. |

The typed id lives in the owner's `contract/` and is the only thing a contributor imports, the same
`capabilityId` trick and for the same reason:

```ts
// plugins/workflows/src/contract/extensions.ts
export const WORKFLOW_STEP_KIND = extensionPointId<StepKindContribution>('workflows:step-kind')

// the owner, once
ctx.extensionPoints.declare(WORKFLOW_STEP_KIND, 'Workflow step kinds')
for (const entry of ctx.extensionPoints.handlers(WORKFLOW_STEP_KIND)) { /* … */ }

// anyone else
ctx.extensionPoints.handle(WORKFLOW_STEP_KIND, { id: 'request', value: { handler, validate } })
```

**A point's value may carry a description the host draws.** A step kind's value is
`{ handler, validate?, describe? }`, and `describe` is the kind's form as data: a label, an icon, and
a closed list of fields. The host renders it on both hosts and applies the field rules first:
`required`, `min`, `max`, and a static select's membership. Then it calls the plugin's own
`validate`. That splits
the work the way it should be split: the contributor keeps every judgement that needs its own code,
and gives up only the drawing. A `GET /catalog` route on the owning plugin then answers the whole
vocabulary, resolved per request rather than cached, because the plugin that fills the point may start
after the owner does. See [workflows.md](../workflows.md) § Contributed step kinds for the field
vocabulary and the worked kinds.

A contributor that cannot import the owner's `contract/` names the point by its string instead. That
happens when importing it would make the workspace package graph cyclic, as it does for
`plugins/terminal`, which the workflows plugin already depends on. The string is the contract; the
contributor mirrors as much of the value type as it uses, in its own `contract/`, and the owner's
test suite holds the mirror against the real type.

Unlike the client's, this one carries **functions, not descriptors**, and that is not an inconsistency:
a client contribution crosses an iframe boundary into another realm, and a node contribution does not
— both tiers of plugin run in the node's own process. The rung-1 argument applies unchanged
([security.md](../security.md) § Rung 1): this is least privilege for cooperative code, not a sandbox.

Reach it only through `ctx`. A loaded plugin's bundle inlines every `@acorn/*` import it makes, so a
plugin that imported the registry module directly would get a private copy of the maps and contribute
into nothing.

The proving pair is workflows and http: workflows opens `workflows:step-kind`, `workflows:policy` and
`workflows:trigger`, and the http plugin contributes the `http:request` step, with neither package
importing the other's implementation ([workflows.md](../workflows.md) § Contributed step kinds).

Findings opens two more points. `findings:kind` collects versioned kind descriptors and optional
validators. `findings:producer` connects a contributor to a host-bound writer. The writer stamps the
contributor's identity and accepts only kinds that contributor declared. Resolve both point rosters
per call so disabling either plugin revokes cached writers. For more information, see
[Findings](../findings.md#plugin-collaboration).

`findings:review-target` is the review-side point. A target validates its own versioned payload and
receives a revocable completion callback tied to that registration. The callback may report
applying, applied, or conflict after the target's own authorized operation; findings receives no
target write function. Memory is the first handler, for `memory:change` version 1.


## Hooks

Everything above is about drawing. Hooks are about **deciding**. "Before I push, does anyone object?"
"Before I send this prompt, does anyone want to change it?" The owner declares the moment and what is
allowed at it, contributors register a handler, and the host runs the chain and hands the owner a
verdict (`node-core/server/pluginHost/hooks.ts`).

**A hook is not an event.** An event has already happened; "task archived" cannot be blocked after the
archive. Events fan out, fire and forget, and carry state rather than deltas. A hook runs *before*, in
a chain, with a return value, ordered, timed out and validated. The two are different contracts and
they stay different: a producer that declares no `emits` has said no to listeners, and an owner that
declares no hook has said no to interceptors. An audit or analytics plugin is an event subscriber.

**The owner declares it**, in the manifest or through `ctx.hooks.declare`:

```json
{ "id": "before-push", "kind": "hook", "label": "push",
  "payload": { "taskId": "string", "branch": "string", "force": "boolean" },
  "allows": ["observe", "veto"], "timeoutMs": 5000, "onTimeout": "allow" }
```

- `payload` is the declared shape, in the same small vocabulary a remote tree's props use: `string`,
  `number`, `boolean` and arrays of those. Nothing else fits, which is deliberate — a payload is a
  decision's subject, not a document.
- `allows` is the subset of `observe | transform | veto` the owner permits. A handler asking for a mode
  not listed gets nothing.
- `timeoutMs` bounds each handler. `onTimeout` is `allow` or `deny` and applies to veto handlers only.
- `order` is `priority` (the handler's own number, then install time) or `install`. Ties are stable.
- `collect` runs every veto rather than stopping at the first, so the owner can show all the reasons.

The owner's node half calls it at the moment:

```ts
const verdict = await ctx.hooks.run('before-push', { taskId, branch, force })
if (!verdict.ok) return { ok: false, reason: `${verdict.by}: ${verdict.reason}` }
await push(verdict.payload)   // transformed, or the original if nobody transformed
```

**A contributor registers a handler**, naming the owner out loud:

```json
{ "id": "scan-push", "point": "changes:before-push", "label": "Secret scan",
  "route": "/v2/p/secret-scan/push", "mode": "veto", "priority": 50 }
```

The route is on the contributor's own namespace and is called by the host with the payload. A
first-party plugin registers a function instead, through `ctx.hooks.handle`; the host wraps both in one
closure at registration and nothing inside the chain knows which it has. Two carriers, one chain — the
same shape the route registry uses.

What a handler answers:

| `mode` | Answers | What the host does with it |
| --- | --- | --- |
| `observe` | anything | dropped unread. Called alongside the chain, never in it. |
| `transform` | `{ payload }` | validated against the owner's declared shape. A violation is treated as no change and recorded. |
| `veto` | `{ ok: true }` or `{ ok: false, reason }` | `reason` is display text, capped; the host stamps `by` with the contributor's id. |

**Chain rules**, without exception:

- Handlers never see each other. Each gets the payload as it stands when its turn comes.
- Order is the owner's rule, then install time.
- Observers run alongside the chain and cannot affect it.
- A handler that throws or times out is skipped and recorded on its roster row. A timed-out veto is
  treated as `onTimeout` says. **Fail open by default**, because a plugin that stalls must not brick a
  push.
- The chain stops at the first veto unless the owner set `collect`.
- A transform's output is validated against the same shape as its input. A handler cannot turn a
  payload into something the owner did not declare.
- Both directions appear in the trust prompt with host-owned copy: "lets other plugins act before it
  pushes", "can stop a push in the changes plugin", "can change a prompt before the agents plugin sends
  it". The plugin id and the verb are interpolated from fixed tables; manifest text never is. A handler
  that changes or stops another plugin's decision is a **high** grant, the way running commands is.

The owner draws the refusal in its own UI with the provenance the host stamped. Whether "push anyway"
exists is the owner's decision: the hook says no, and the owner says what no means.

**The hooks open today.** Core owns three, because core owns the choke point:

| Owner | Hook | Allows | Who wants it |
| --- | --- | --- | --- |
| core | `core:worktree-created` | observe, transform | setup scripts. The terminal plugin's handler is the first, and used to be a single-slot capability |
| core | `core:before-tool-call` | observe, veto | approval gates beyond the built-in tiers. `onTimeout: deny`, alone among these: a gate that opens when its keeper stops answering is not one |
| core | `core:before-snapshot` | observe, transform, veto | budget shaping, PII stripping. The payload is section names, so a handler drops a section and nothing else |
| changes | `changes:before-commit` | observe, transform, veto | commit lint, message helpers |
| changes | `changes:before-push` | observe, veto | secret scanning, changesets, branch protection |
| agents | `agents:before-send` | observe, transform, veto | prompt policy, redaction, context injectors |
| terminal | `terminal:before-run-target` | observe, veto | change freezes, environment checks. Runs in `RuntimeService.start`, after the repo-config trust gate and before the session is spawned |
| workflows | `workflows:before-step` | observe, veto | "no deploys today" from an incident tool |
| editor | `editor:before-save` | observe, transform, veto | format on save, lint on save |

**A payload's booleans are part of the decision, not trimmings.** `changes:before-commit` carries
`{ taskId, branch, message, amend }` and `changes:before-push` carries `{ taskId, branch, force }`.
`amend` earns its place because rewriting the message of a commit that already exists is a different
decision from writing a new one: a commit-lint handler that holds new work to a subject format usually
wants to leave a reword alone. `force` earns its place for the same shape of reason: a
branch-protection handler that refuses every push to `main` is a nuisance, and one that refuses only
the push that replaces a commit somebody else may be standing on is the thing it was written to be.
Payload matching is exact, so a declared boolean is a field every call has to carry
(`plugins/changes/src/server/localGit.ts` § `CHANGES_HOOKS`).

**What is refused.** Hooks on streams or per-keystroke paths — PTY output, editor keystrokes, the agent
token stream. The events design refused those as events, and a hook costs more than an event. A
transform that changes the payload's *shape*. A hook the owner did not declare, or a mode the owner did
not allow. And hooks that run on the client: the chain is node-side, for the same reason an event is
node-emitted and never renderer-local.

**Two seams that are hook-shaped and are not hooks.** [Task checks](client-authoring-and-the-ui-kit.md#task-checks) already do what
`before-archive` would, and more: a check answers with a *concern* and an opt-in cleanup plan, which a
`{ ok, reason }` verdict cannot express. Converting it would have deleted the checkbox. And the
`routeCapability` seams in `server/bridge.ts` are single-provider service bridges — `scheduler.list()`,
`sessions.archive()` — which is RPC rather than a decision; a chain in front of one would answer a
question nobody asked.

## Node providers

A plugin can declare that it knows about Nodes, and optionally that it can make and remove them:
`ctx.providers.nodes(provider)` (`node-core/server/nodeProviders/registry.ts`). This is the second
door into the fleet, beside probe-then-pair, and it is what a control-plane plugin is built from.

```ts
ctx.providers.nodes({
  id: 'machines',                                     // the host stamps `<pluginId>:machines`
  label: 'Acme Cloud',
  list: async (signal) => [/* ProvidedNode records */],
  create: async (spec, signal) => {/* … */},          // declaring create makes destroy required
  destroy: async (providerNodeId, signal) => {/* … */},
  start: async (providerNodeId, signal) => {/* … */},
  stop: async (providerNodeId, signal) => {/* … */},
})
```

The rules follow every other registry on `ctx`, plus one borrowed from
[DevPod](https://devpod.sh/docs/developing-providers/quickstart):

| | |
| --- | --- |
| the id | `<pluginId>:<id>`, minted by the host. An id containing a colon is refused, so a package cannot qualify itself. |
| `create` obliges `destroy` | validated at registration, so a provider that can make Nodes but not remove them is a load error rather than a support ticket. A person who cannot remove a machine has already been billed for it. |
| lifecycle | providers go when the plugin does, like its routes and capabilities. |
| where it runs | **node-side, on some Node, not necessarily the one the person is sitting at, and with no client necessarily attached.** Write nothing into a provider that assumes otherwise. |

That last row is a contract term, not advice, and it has two halves. Node-side, because a
renderer-side provider would put the cloud account credential in the renderer, the one place the
architecture has always kept credentials out of. And *some* Node, because the client reads this by
fanning out over every reachable Node and unioning the answers, deduped on `providerId` plus
`providerNodeId` — so a provider on a headless Node is exactly as visible as one on the laptop.
`providerNodeId` is the provider's own id for a machine, stable no matter which Node asked, which is
what makes two Nodes signed into one account show one row instead of two.

**There is no seam for a provider to say how to reach its node, and there should not be one.** A
provider returns an endpoint the host dials, pinned by the fingerprint that provider vouched for, and
the dial happens in the credential path — the one place holding the device token and the pin. A
plugin that shapes that connection is a plugin inside it, which is what
[security.md](../security.md) § The control plane keeps out everywhere else. So a provider whose nodes
sit behind a NAT has a networking problem, not a plugin problem; [future/remote.md](../future/remote.md)
owns the relay question if it ever becomes ours.

**`ProvidedNode.enrollment.deviceToken` never reaches a client.** `GET /v2/core/nodes` projects it
out — as an explicit field list, so a new field cannot leak by omission — and
`POST /v2/core/nodes/adopt` is the only way to get one. The desktop host is what calls it: the
renderer names a provider and a node id, the host fetches the endpoint, fingerprint and credential
from the Node that listed the record, then probes that endpoint and refuses a certificate whose
fingerprint is not the one the provider vouched for. So the renderer cannot introduce a Node of its
own invention, and still never sees a device token
([security.md](../security.md) § The control plane).

Confirmation for the four verbs is the client's, drawn from the `ToolRisk` tiers `nodeActions`
already uses (`NODE_LIFECYCLE_RISK` in `packages/protocol/src/nodeProviders.ts`): `create`, `start`
and `stop` are `write`, and `destroy` is `execute` and asks twice. Core decides those tiers, not the
provider — a provider that could call its own destroy `read` would be choosing how loudly acorn warns
about it.

The reference implementation is `plugins/nodes-file`, which reads Nodes out of a JSON file named by
`ACORN_NODES_FILE`. It is not a toy: it is the seam's only consumer until a cloud plugin exists, it is
what the tests run against, and it is deliberately a loaded plugin whose only resource grant is
read-write access to the file named by that variable. Build it into a data root with
`pnpm --filter @acorn/node build:plugin nodes-file`; it is not in
the bundled roster, so a shipped install has no node providers and Settings → Nodes draws no
provider section.

### The first-party rule

**A first-party control-plane plugin gets no host privilege a third party lacks.** It is a loaded
plugin, built only from the seams documented here, and if it ever needs one special host change then
that change is a moat and the seam is not finished. The reason is not fairness, it is rot: a privilege
nobody outside exercises is one nobody notices breaking.

The way to check it is to diff what the plugin imports and what its manifest grants against what
`create-acorn-plugin` scaffolds. `plugins/nodes-file` is the standing worked example — one
registration, no core, secret, process, or network grants, and one environment-configured file grant.

## Replacing a core surface

The other half is bb's exclusive slot, and the important word is *offer*. A plugin may declare a
replacement for one of acorn's own designated surfaces:

```json
{ "client": "./dist/client.js", "contributions": { "frames": [
  { "target": "coreSlot", "id": "board-rail", "label": "Board task list", "coreSlot": "rail.taskList" }
] } }
```

**Registering seizes nothing.** Three plugins may all offer to replace the rail's task list and the
rail keeps drawing its own. The user picks a provider in **Settings → Plugins → replaced surfaces**,
and that choice is a device preference — which list a person looks at is a property of the screen they
are looking at.

The picker lives in Settings → Plugins, not Appearance, because of what the choice is about.
Appearance's colour and shape axes exist whether or not anything is installed; this picker's options
are named after installed plugins and exist only because something is installed. It is hidden
entirely when nobody has offered a replacement, since a select with one option cannot do anything and
a permanent "no plugin replaces your task list" row would be chrome earning nothing.

**Core is the fallback in the strong sense**: not "when nothing is set" but whenever anything at all is
off. Nobody chosen, the chosen plugin not installed on this node, installed but disabled or untrusted,
or its surface threw while rendering — all four draw core's own implementation, and the settings row
says so when the last one is why. A provider that threw gets another attempt at the next contribution
sync, which is the one moment its bytes can have changed.

`rail.taskList` is the only designated surface, and the list grows the way every other vocabulary in
this document does: when a second surface has both a reason and a fallback worth writing.

## There is no uncooperative extension

On the record, because the absence is the feature. **Nothing lets plugin B alter plugin A's UI or
behaviour without A's declared consent.** Specifically refused, permanently:

- **DOM access into another realm.** bb's de facto universal mechanism is content scripts — any plugin
  may rewrite any other plugin's rendered DOM. bb documents its version honestly as "trusted
  same-origin page code, not a security sandbox," and that honesty is the whole problem: it makes
  every plugin part of every other plugin's attack surface, and it makes A's behaviour undebuggable
  from A's own source.
- **Patching another plugin's registrations.** A plugin's contributions are registered by the host from
  the manifest the host read. There is no runtime door onto anyone's, including its own.
- **Reading another plugin's routes.** Refused at manifest parse, refused again on the device, and
  refused a third time at the frame bridge (`packages/client-core/src/host/frames/scopes.ts`).

If a real need surfaces that cooperative points cannot express, **the answer is a wider vocabulary, not
an open realm** — and which vocabulary depends on which of the three tiers it is. Memory's section
inside context's tray is the worked example: editable inputs, a select, a textarea and a two-button
gate per proposal, which is UI rather than a descriptor. Growing descriptors until that fits would have
built a widget toolkit in the wire format. It is a `context:section` contribution instead, drawn from
kit nodes, and the same source would work from a worker if memory were ever loaded rather than
compiled.

Nothing here is reachable from a plugin frame. The registry is populated host-side from the manifests
and contributions the device read; the bridge gained no message kind and no route, so a frame can
neither read a point's deliveries nor contribute to one.
