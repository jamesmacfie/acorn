import type { NodeIdentity } from '@acorn/protocol/node.ts'
import { identityPathOf, readIdentity, updateIdentity } from './dataRoot.ts'

/** The relay this Node dials and the account that registered it there, read straight off disk like the
 *  reach above: the route that asks runs long after this process opened its root. */
export function readNodeRelay(dir: string): Pick<NodeIdentity, 'relay' | 'owner' | 'previews'> {
  const identity = readIdentity(identityPathOf(dir))
  return {
    ...(identity?.relay ? { relay: identity.relay } : {}),
    ...(identity?.owner ? { owner: identity.owner } : {}),
    ...(identity?.previews ? { previews: identity.previews } : {}),
  }
}

/** Record the relay and owner account that turning on remote access produced, or drop both when it's
 *  turned off, and the owner's previews switch. The tunnel reads them at the next boot, and the account
 *  plugin applies them at once. */
export function recordNodeRelay(dir: string, patch: Partial<Pick<NodeIdentity, 'relay' | 'owner' | 'previews'>>): void {
  updateIdentity(identityPathOf(dir), patch)
}
