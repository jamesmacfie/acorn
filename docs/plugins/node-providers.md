# Node providers

This page covers the node provider seam: how a plugin lists Nodes, and optionally creates and removes
them, so they join the fleet. It's what a control-plane plugin is built from. It's part of the
[plugin reference](../plugins.md).

## Node providers

`ctx.providers.nodes(provider)` (`node-core/server/nodeProviders/registry.ts`) is the second way into
the fleet, beside probe-then-pair:

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

| | |
| --- | --- |
| The id | `<pluginId>:<id>`, minted by the host. An id with a colon is refused, so a package can't qualify itself |
| `create` requires `destroy` | Checked at registration, so a provider that can make Nodes but not remove them is a load error. A person who can't remove a machine has already been billed for it |
| Lifecycle | Providers go when the plugin does |
| Where it runs | On the Node side, on some Node, not necessarily the one the person is using, and with no client necessarily attached |

The last row is a contract term. A provider runs on a Node because a renderer-side provider would put
the cloud account credential in the renderer, where acorn keeps credentials out. It runs on some Node,
because the client fans out over every reachable Node and unions the answers, deduplicated on
`providerId` plus `providerNodeId`. A provider on a headless Node is as visible as one on the laptop.
`providerNodeId` is the provider's own id for a machine, the same whichever Node asked, so two Nodes
signed into one account show one row.

There's no seam for a provider to shape how its Node is reached. A provider returns an endpoint the
host dials, pinned by the fingerprint the provider vouched for, and the dial happens in the credential
path, which holds the device token and the pin. A provider whose Nodes sit behind a NAT has a
networking problem, not a plugin problem ([the control plane](../security/control-plane.md)).

`ProvidedNode.enrollment.deviceToken` never reaches a client. `GET /v1/core/nodes` projects it out with
an explicit field list, so a new field can't leak by omission. `POST /v1/core/nodes/adopt` is the only
way to use it. The desktop host calls it: the renderer names a provider and a Node id, and the host
fetches the endpoint, fingerprint, and credential from the Node that listed the record, then probes
the endpoint and refuses a certificate whose fingerprint doesn't match. The renderer can't introduce a
Node of its own invention and never sees a device token.

The client confirms the four lifecycle verbs using the `ToolRisk` tiers in `NODE_LIFECYCLE_RISK`
(`packages/protocol/src/device/nodeProviders.ts`). `create`, `start`, and `stop` are `write`. `destroy`
is `execute` and asks first in the shell's confirmation, which names what goes and what stays. Core
sets these tiers, not the provider.

The reference implementation is `plugins/nodes-file`, which reads Nodes from a JSON file named by
`ACORN_NODES_FILE`. It's the seam's only consumer, the tests run against it, and it's a loaded plugin
whose only resource grant is read-write access to that file. Build it into a data root with
`pnpm --filter @acorn/node build:plugin nodes-file`. It isn't in the bundled roster, so a shipped
install has no Node providers and **Settings > Nodes** draws no provider section.

### The first-party rule

A first-party control-plane plugin gets no host privilege a third party lacks. It's a loaded plugin
built only from the seams on these pages. If it ever needs one special host change, that change marks
an unfinished seam. A privilege nobody outside uses is one nobody notices breaking.

To check it, compare what the plugin imports and what its manifest grants with what
`create-acorn-plugin` scaffolds. `plugins/nodes-file` is the worked example: one registration, no
core, secret, process, or network grants, and one file grant configured by an environment variable.
