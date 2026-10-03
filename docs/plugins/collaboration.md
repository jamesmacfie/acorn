# Collaboration rules

This page covers how plugins work together without importing each other: contracts, capabilities,
broadcasts, and client registries. It's part of the [plugin reference](../plugins.md).

## Collaboration rules

Plugins collaborate through four mechanisms:

1. **Contracts.** Import only a provider's `contract/` entrypoint, for types, capability ids, or narrow
   pure functions.
2. **Capabilities.** Resolve typed functions from the Node's per-runtime capability registry at call
   time. Route handlers get a read-only capability view through `RuntimeBindings`, and providers
   register during `init`. A missing optional provider gives a degraded feature, not a module import.
   The helpers in `server/bridge.ts` are typed route adapters, and their setters exist only for
   isolated route tests.
3. **Broadcasts** through `ctx.events`. They tell connected clients that something changed, and let a
   node half hear what core and other plugins say changed ([events](./events.md)). Durable history
   belongs in the owning plugin's tables.
4. **Client registries and slots.** Register UI contributions without importing another plugin's
   implementation. The host records disposables, so disabling or reloading a plugin removes its
   entries.

The architecture test enforces zero non-contract plugin-to-plugin edges, no app imports from packages
or plugins, no shell bindings outside `apps/desktop/src/shell`, protocol purity, declared dependencies,
an acyclic package graph, and the client and Node split.

## Capability ids

A capability id belongs to the plugin that publishes it. A loaded plugin may provide only ids that
start with `<its own id>.`, the same binding the host applies to its routes, schedules, data sources,
integration flows, and extension points. Providing anything else fails registration, and the reason
lands on the roster row. Without the rule, a package could publish `github.mirror` while the real
plugin was disabled, and callers would resolve the impostor.

`agents.harnessRegistry` is exempt, because the host declares it as an invitation: whichever plugin
owns agent sessions on a Node fills it. `HOST_OWNED_CAPABILITY_IDS` in
`packages/node-core/src/server/plugins/permissions.ts` is the list, and a test holds it against the
real constants.

A capability a manifest didn't grant reads as absent through `get`, the same as a disabled provider.
`require` throws.

`CapabilityCatalogue` in `acorn-plugin-types` lists every id the first-party plugins publish, with its
signature. Most ids are declared in `plugins/*/src/contract/` modules a loaded plugin can't import, so
the catalogue is how an outside author learns what exists.

## Client capabilities

`packages/client-core/src/infra/node/clientCapabilities.ts` mirrors capabilities on the client: a typed
`Map` keyed by `ClientCapabilityId<T>`, so one plugin's client half can call another's without an
import edge. The first case was the agent task sidebar merging the workflows plugin's steps into its
list, while the workflows node half already needed the agents plugin to run a session. Those two
couplings point opposite ways, and a package cycle won't build. A capability id breaks the cycle.

It has the Node registry's four verbs behind `ctx.capabilities`: `provide`, `get`, `require`, and
`ids`. `clientCapability` and `requireClientCapability` are the same reads as free functions, for a
component with no `ctx`. It isn't the platform gate. That's `requires` on a contribution, answered by
`hostCapabilities()`.

Call sites resolve at call time, never at module scope or in a component body that runs once, because
client registration order isn't a contract. The Node's registry is per runtime, because the service
can boot twice in one process. The client's is a module singleton, because a renderer has one client
graph, and `_resetClientCapabilities` exists only for tests.

### Where a key lives

A capability key lives with whichever side would otherwise have to import the other. On the Node that's
almost always the provider. `WORKFLOW_CONTROL` is the exception: agents declares it, workflows
provides it, and the id still names the provider, because agents draws the control and workflows
already imports agents. Put the key where it doesn't recreate the import you were avoiding, and say
which in its file.
