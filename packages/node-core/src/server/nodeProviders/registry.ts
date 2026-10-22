import {
  NODE_LIFECYCLE_VERBS,
  type NodeLifecycleVerb,
  type NodeProviderDescriptor,
  type ProvidedNode,
} from '@acorn/protocol/nodeProviders.ts'
import type { Disposable } from '../pluginHost/capabilities'

// Node providers: a plugin that knows about nodes, and optionally can make and remove them
// (docs/plugins/node-providers.md § Node providers). The second door into the fleet, beside probe-then-pair.
//
// **A provider runs on some node, not necessarily the one the person is sitting at, and with no
// client necessarily attached.** Write nothing into a provider that assumes otherwise. The client reads
// this registry by fanning out over every reachable node and unioning the answers, so a provider on a
// headless node in a data centre is exactly as visible as one on the laptop.
//
// Node-side, because a renderer-side provider would put the cloud account credential in the renderer,
// the one place the architecture keeps credentials out of.

/** What `list` answers with. The wire projection (`providedNodeSchema`) is strict and has no
 *  `enrollment` member, so the credential cannot reach a client by forgetting to strip it: it has to
 *  be handed over deliberately, by the adopt route, to the desktop host. */
export type ProvidedNodeRecord = ProvidedNode & {
  // The durable credential for this node, if the provider has one. A control plane learned it at the
  // node's enrollment; a provider without one lists a node nobody can adopt, which is a fair thing to
  // show and not an error.
  enrollment?: { deviceToken: string }
}

/** A node to be created. `options` is opaque to core: a region, a size, an image, whatever the
 *  provider's catalogue calls for. */
export type NodeSpec = { label: string; options: Record<string, string> }

/** Who is asking, so a provider can borrow that user's credential for its own connection through
 *  `ctx.providers.withConnection`. Nothing more: a provider gets no request context, because a loaded
 *  plugin's provider would then hold the node's secrets. */
export type NodeProviderCaller = { userId: string }

export type NodeProviderContribution = {
  /** Unique within the declaring plugin. The host qualifies it as `<pluginId>:<id>`, so a plugin
   *  cannot register under a stranger's name, exactly as with routes, schedules and capabilities. */
  id: string
  label: string
  list(signal: AbortSignal, caller: NodeProviderCaller): Promise<ProvidedNodeRecord[]>
  /** For a provider that holds no device token for its nodes, such as an account that only knows where
   *  they are: a short-lived assertion that its user owns the node. The host hands it to the client, which
   *  pairs by approval with it, so the provider never holds a device token. */
  pairingAssertion?(providerNodeId: string, signal: AbortSignal, caller: NodeProviderCaller): Promise<string>
  /** Declaring `create` makes this a machine provider, and the host then requires `destroy`, as DevPod's
   *  provider model does. Validated at registration: a provider that can make nodes but not remove them
   *  is a load error rather than a support ticket. */
  create?(spec: NodeSpec, signal: AbortSignal): Promise<ProvidedNodeRecord>
  destroy?(providerNodeId: string, signal: AbortSignal): Promise<void>
  start?(providerNodeId: string, signal: AbortSignal): Promise<void>
  stop?(providerNodeId: string, signal: AbortSignal): Promise<void>
}

export type RegisteredNodeProvider = NodeProviderContribution & {
  /** `<pluginId>:<id>`, minted here. What every route, request body and client row names. */
  qualifiedId: string
  pluginId: string
}

const verbsOf = (provider: NodeProviderContribution): NodeLifecycleVerb[] =>
  NODE_LIFECYCLE_VERBS.filter((verb) => typeof provider[verb] === 'function')

// A module singleton, like the route, source, node-action and audit registries beside it, with the
// same lifecycle answer: each registration hands back its own undo, and the plugin host runs it on
// teardown (server/pluginHost/host.ts § clearRegistrations).
const providers = new Map<string, RegisteredNodeProvider>()

/** Register one provider for a plugin. The host binds `pluginId`; a plugin never passes it. */
export function registerNodeProvider(pluginId: string, provider: NodeProviderContribution): Disposable {
  if (!provider.id.trim()) throw new Error(`Plugin '${pluginId}' registered a node provider with an empty id.`)
  if (provider.id.includes(':')) {
    throw new Error(`Node provider id '${provider.id}' must not contain ':': the host qualifies it with the plugin id.`)
  }
  if (typeof provider.list !== 'function') throw new Error(`Node provider '${provider.id}' must implement list().`)
  // DevPod's rule. Checked here rather than at the first click, because the moment an owner needs
  // `destroy` is the moment they have already been billed for something they cannot remove.
  if (provider.create && !provider.destroy) {
    throw new Error(`Node provider '${provider.id}' declares create() and must therefore declare destroy().`)
  }
  const qualifiedId = `${pluginId}:${provider.id}`
  if (providers.has(qualifiedId)) throw new Error(`Duplicate node provider '${qualifiedId}'.`)
  const registered = { ...provider, qualifiedId, pluginId }
  providers.set(qualifiedId, registered)
  return {
    dispose: () => {
      if (providers.get(qualifiedId) === registered) providers.delete(qualifiedId)
    },
  }
}

export function clearNodeProviders(pluginId: string): void {
  for (const [id, provider] of providers) if (provider.pluginId === pluginId) providers.delete(id)
}

export const nodeProviders = (): RegisteredNodeProvider[] =>
  [...providers.values()].sort((a, b) => a.qualifiedId.localeCompare(b.qualifiedId))

export const nodeProvider = (qualifiedId: string): RegisteredNodeProvider | undefined => providers.get(qualifiedId)

/** What the client is told about a provider: its id, its name, and which verbs it declared, so the UI
 *  offers only buttons that exist. */
export const nodeProviderDescriptor = (provider: RegisteredNodeProvider): NodeProviderDescriptor => ({
  id: provider.qualifiedId,
  label: provider.label,
  verbs: verbsOf(provider),
})
