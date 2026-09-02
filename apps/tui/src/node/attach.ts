import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lockedBy } from '@acorn/node-core/server/storage/dataRoot.ts'
import { certificateFingerprint } from '@acorn/node-core/server/transport/tls.ts'
import { nodeIdentitySchema } from '@acorn/protocol/node.ts'

// Reading a running node off its data root, without opening it.
//
// The node takes an exclusive lock at boot and records where it bound, so the root holds everything a
// client needs to reach it: who it is (node.json), where it is (the port it last bound), and what
// certificate to pin (tls/cert.pem). The one thing it does not hold is a device token, which is
// custody and belongs to whoever is attaching.

/** What a running node's data root says about it, or null when nothing live holds the root. */
export type RunningNode = { pid: number; nodeId: string; endpoint: string; fingerprint: string; certPem: string }

/** Who this data root's node is, whether or not anything is running it, or null before the root has
 *  ever been opened.
 *
 *  A node's id is minted once per root and written to `node.json` (node-core § openDataRoot), so it
 *  survives every restart. That is what lets `acorn` pick the query cache's partition and draw from
 *  it while a node it just spawned is still booting: the id is known, the port is not
 *  (docs/tui.md § Attach or start). */
export function knownNodeId(dataDir: string): string | null {
  try {
    const identity = nodeIdentitySchema.safeParse(JSON.parse(readFileSync(join(dataDir, 'node.json'), 'utf8')))
    return identity.success ? identity.data.nodeId : null
  } catch {
    return null
  }
}

export function runningNode(dataDir: string): RunningNode | null {
  const pid = lockedBy(dataDir)
  if (pid === null) return null
  const identity = nodeIdentitySchema.safeParse(JSON.parse(readFileSync(join(dataDir, 'node.json'), 'utf8')))
  // A locked root whose identity or certificate cannot be read is not a node to guess at. Saying so
  // beats starting a second node that would fail on the lock a moment later.
  if (!identity.success || !identity.data.port) throw new Error(`A node holds ${dataDir} (pid ${pid}) but its node.json names no port. Stop it and try again.`)
  const certPem = readFileSync(join(dataDir, 'tls', 'cert.pem'), 'utf8')
  return {
    pid,
    nodeId: identity.data.nodeId,
    // Loopback, because that is where the node binds and the certificate's SAN is IP:127.0.0.1. A node
    // reached over the network is a `--node` endpoint and goes through pairing instead.
    endpoint: `https://127.0.0.1:${identity.data.port}`,
    fingerprint: certificateFingerprint(certPem),
    certPem,
  }
}
