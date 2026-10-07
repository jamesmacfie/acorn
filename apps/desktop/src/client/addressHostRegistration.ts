import { preparePluginContributionsForNode } from '@acorn/client-core/host/plugins/reload.ts'
import { registerAddressHost, type AddressHost } from '@acorn/client-core/host/registries/commands'

/** A linked route can be checked only after this Node's loaded contributions have registered.
 * Disposal also stops an old Node's delayed pass from replacing the new Node's host. */
export function registerAddressHostWhenReady(
  host: AddressHost & { nodeId: string },
  onFailure: (error: unknown) => void,
): () => void {
  let disposed = false
  let unregister = () => {}
  void preparePluginContributionsForNode(host.nodeId).then(() => {
    if (!disposed) unregister = registerAddressHost(host)
  }, onFailure)
  return () => { disposed = true; unregister() }
}
