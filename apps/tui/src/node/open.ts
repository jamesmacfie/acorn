import { FleetStore, type FleetNode } from '@acorn/custody/broker/fleetStore.ts'
import { deviceTokens, LOCAL_TOKEN_SCOPE, type DeviceTokens, type TokenCipher } from '@acorn/custody/custody/deviceTokenStore.ts'
import { configDir, dataRootDir } from './paths'
import { runningNode } from './attach'
import { startNode } from './supervise'
import { pairInteractively } from './pair'

// The `acorn` command's one decision: which node this run talks to, and whether it owns that node's
// lifetime (docs/future/terminal/03-process-model.md § Attach or start).
//
// Everything here is custody and process work. Nothing in it imports client-core, and nothing in
// client-core imports it: the seam between them is `platform.ts`, which is handed the fleet store this
// module built.

// The TUI has no keychain to hand a token to, so it writes the bytes and leans on the file mode. That
// is the third column in docs/security.md's summary table as 06-isolation.md designs it: exposure is
// "a process on this machine with the user's uid", mitigation is 0600, which is exactly what the node
// beside it gives its own TLS private key and session key. Encrypting under a key stored in the same
// directory would look like more and be the same.
const fileModeOnly: TokenCipher = {
  available: () => true,
  encrypt: (value) => Buffer.from(value, 'utf8'),
  decrypt: (blob) => blob.toString('utf8'),
}

export type Custody = { tokens: DeviceTokens; fleet: FleetStore }

export const custody = (dir: string = configDir()): Custody => {
  const tokens = deviceTokens(dir, fileModeOnly)
  return { tokens, fleet: new FleetStore(dir, tokens) }
}

export type OpenedNode = {
  nodeId: string
  fleet: FleetStore
  /** Whether this TUI started the node. The one that started it owns its lifetime, which is the
   *  desktop's rule too: a second `acorn` in a second terminal attaches and leaves it running. */
  supervised: boolean
  stop(): Promise<void>
}

/** Open the node this run talks to. With no target that is the node for this machine's data root,
 *  attached if one is running and started if not; with one it is a remembered node or a new endpoint
 *  to pair with. */
export async function openNode(target: string | undefined, at: Custody = custody()): Promise<OpenedNode> {
  const { tokens, fleet } = at
  const done = (nodeId: string, supervised = false, stop: () => Promise<void> = async () => {}): OpenedNode => ({ nodeId, fleet, supervised, stop })

  if (target) return done((await remoteNode(target, fleet)).nodeId)

  const dataDir = dataRootDir()
  // The label survives a rename, the same way the desktop's local adoption keeps the owner's.
  const label = (nodeId: string): string => fleet.get(nodeId)?.label ?? 'This computer'

  const running = runningNode(dataDir)
  if (running) {
    const token = tokens.read(LOCAL_TOKEN_SCOPE)
    if (!token) {
      // A node this TUI has never met, running under a launcher that is not us — the desktop app,
      // usually. Its token is that launcher's, so the way in is the same one a stranger gets: a
      // pairing code the owner asks the node for. A loopback route that minted a token for anyone who
      // can read the data root would be new trust, and it is recorded as a door rather than taken.
      console.log(`\n  A node is already running here (pid ${running.pid}), and acorn holds no token for it.`)
      console.log(`  Ask it for a pairing code with:  kill -USR1 ${running.pid}`)
      const paired = await pairInteractively(running.endpoint, fleet, { label: label(running.nodeId), local: true })
      return done(paired.nodeId)
    }
    fleet.remember({ ...running, label: label(running.nodeId), local: true }, token)
    return done(running.nodeId)
  }

  const node = await startNode(dataDir, tokens.read(LOCAL_TOKEN_SCOPE))
  const { handshake } = node
  fleet.remember(
    {
      nodeId: handshake.nodeId,
      label: label(handshake.nodeId),
      endpoint: handshake.endpoint,
      local: true,
      ...(handshake.fingerprint ? { fingerprint: handshake.fingerprint } : {}),
      ...(handshake.certPem ? { certPem: handshake.certPem } : {}),
    },
    handshake.deviceToken,
  )
  return done(handshake.nodeId, true, node.stop)
}

// `--node` names either a node this device has already paired with, by label or by id, or an endpoint
// to pair with now. Remembered first, so the second time is `acorn --node <name>` and never a code.
async function remoteNode(target: string, fleet: FleetStore): Promise<FleetNode> {
  const known = fleet.list().find((node) => node.label === target || node.nodeId === target || node.endpoint === target)
  if (known) return known
  if (!/^https:\/\//.test(target)) {
    const names = fleet.list().map((node) => node.label)
    throw new Error(`acorn knows no node called "${target}". Pair one with an https:// endpoint${names.length ? `, or name one of: ${names.join(', ')}` : ''}.`)
  }
  return pairInteractively(target, fleet, { label: new URL(target).host, local: false })
}
