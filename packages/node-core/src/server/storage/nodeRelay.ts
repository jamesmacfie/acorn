import { readFileSync } from 'node:fs'
import { nodeIdentitySchema, type NodeIdentity } from '@acorn/protocol/node.ts'
import { identityPathOf, readIdentity, relayPathOf, updateIdentity, writePrivateAtomic } from './dataRoot.ts'

type NodeRelay = Pick<NodeIdentity, 'relay' | 'owner' | 'previews'>

const recordedRelaySchema = nodeIdentitySchema.pick({ relay: true, owner: true })

function readRecordedRelay(dir: string): Pick<NodeIdentity, 'relay' | 'owner'> {
  try {
    return recordedRelaySchema.parse(JSON.parse(readFileSync(relayPathOf(dir), 'utf8')))
  } catch {
    return {}
  }
}

/** The relay this Node dials and the account that registered it there, read straight off disk because
 *  the route that asks runs long after this process opened its root. Remote access's relay
 *  and owner live in relay.json. A relay in node.json was written by hand, and wins over Remote access's. */
export function readNodeRelay(dir: string): NodeRelay {
  const identity = readIdentity(identityPathOf(dir))
  const recorded = readRecordedRelay(dir)
  const relay = identity?.relay ?? recorded.relay
  return {
    ...(relay ? { relay } : {}),
    ...(recorded.owner ? { owner: recorded.owner } : {}),
    ...(identity?.previews ? { previews: identity.previews } : {}),
  }
}

/** Record the relay and owner account that turning on remote access produced, or drop both when it's
 *  turned off, and the owner's previews switch. The tunnel reads them at the next boot, and the account
 *  plugin applies them at once. The relay and owner go to relay.json, private to this user and out of a
 *  read-blocked agent's reach, and `previews` to node.json. */
export function recordNodeRelay(dir: string, patch: Partial<NodeRelay>): void {
  const { previews, ...recorded } = patch
  if ('previews' in patch) updateIdentity(identityPathOf(dir), { previews })
  if (Object.keys(recorded).length === 0) return
  writePrivateAtomic(relayPathOf(dir), `${JSON.stringify({ ...readRecordedRelay(dir), ...recorded }, null, 2)}\n`)
}
