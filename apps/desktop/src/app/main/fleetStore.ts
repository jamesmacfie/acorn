import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { nodeRecordSchema, type NodeRecord } from '@acorn/protocol/broker.ts'
import { forgetDeviceToken, LOCAL_TOKEN_SCOPE, readDeviceToken, writeDeviceToken } from './deviceTokenStore'

// Fleet membership: which nodes this client knows, where they are, and what certificate to pin.
//
// It lives in main because main holds the two things membership is inseparable from — the device
// tokens and the pinned certificates (docs/vNext/architecture.md § What runs where). The renderer gets
// a token-free projection and asks main to mutate; nothing here is ever handed across contextBridge
// except via `NodeRecord`.
//
// Split across two files on purpose: `fleet.json` holds the non-secret record (0600 anyway, because
// an endpoint list is still information about the owner's machines) and each token is a separate
// safeStorage blob. Putting tokens in the JSON would mean the whole file has to be decryptable to read
// a label, and would lose deviceTokenStore's "no keychain ⇒ simply do not remember" behaviour: a
// keychain-less machine keeps its fleet and re-pairs, rather than losing both.
//
// Follows sessionKeyStore.ts's file discipline: 0700 dir, 0600 files, chmod after write so a looser
// umask on an existing file cannot survive.

const FLEET_FILE = 'fleet.json'

// The stored record: a NodeRecord plus the two fields the renderer must never need.
export const fleetNodeSchema = nodeRecordSchema.extend({
  // The node's self-signed certificate, used as the CA for the pinned agent. Public material, but the
  // renderer has no use for it — main is what performs the TLS.
  certPem: z.string().optional(),
  // Our own row in the node's `devices` table, so "Revoke" can name it. Absent for the local node,
  // which is adopted from the service start handoff rather than paired and cannot be revoked anyway.
  deviceId: z.string().optional(),
})
export type FleetNode = z.infer<typeof fleetNodeSchema>

const fleetFileSchema = z.strictObject({ version: z.literal(1), nodes: z.array(fleetNodeSchema) })

// The renderer's projection. Explicit rather than a spread-and-delete so a field added to FleetNode
// cannot leak by default.
export const toNodeRecord = (node: FleetNode): NodeRecord => ({
  nodeId: node.nodeId,
  label: node.label,
  endpoint: node.endpoint,
  local: node.local,
  ...(node.fingerprint ? { fingerprint: node.fingerprint } : {}),
})

// The bundled local node's token predates its nodeId (deviceTokenStore.ts), so it has its own scope.
const scopeOf = (node: Pick<FleetNode, 'nodeId' | 'local'>): string => (node.local ? LOCAL_TOKEN_SCOPE : node.nodeId)

export class FleetStore {
  #nodes: FleetNode[] | null = null

  constructor(private readonly userDataDir: string) {}

  list(): FleetNode[] {
    if (!this.#nodes) this.#nodes = this.read()
    return [...this.#nodes]
  }

  get(nodeId: string): FleetNode | undefined {
    return this.list().find((node) => node.nodeId === nodeId)
  }

  tokenFor(nodeId: string): string | undefined {
    const node = this.get(nodeId)
    return node ? readDeviceToken(this.userDataDir, scopeOf(node)) : undefined
  }

  // Add or replace a node and its token. Called on every local-node start (the endpoint changes across
  // restarts now that the port is ephemeral) and once per successful pairing.
  remember(node: FleetNode, token: string): FleetNode {
    const nodes = this.list().filter((existing) => existing.nodeId !== node.nodeId)
    nodes.push(node)
    this.write(nodes)
    writeDeviceToken(this.userDataDir, scopeOf(node), token)
    return node
  }

  rename(nodeId: string, label: string): FleetNode | undefined {
    const nodes = this.list()
    const node = nodes.find((candidate) => candidate.nodeId === nodeId)
    if (!node) return undefined
    const renamed = { ...node, label }
    this.write(nodes.map((candidate) => (candidate.nodeId === nodeId ? renamed : candidate)))
    return renamed
  }

  // Forget locally. Dropping the token as well as the row is the point: a row without a token would
  // reconnect as an unauthenticated stranger, and a token without a row is an orphaned credential.
  forget(nodeId: string): void {
    const node = this.get(nodeId)
    if (!node) return
    this.write(this.list().filter((candidate) => candidate.nodeId !== nodeId))
    forgetDeviceToken(this.userDataDir, scopeOf(node))
  }

  private read(): FleetNode[] {
    try {
      const parsed = fleetFileSchema.safeParse(JSON.parse(readFileSync(join(this.userDataDir, FLEET_FILE), 'utf8')))
      if (parsed.success) return parsed.data.nodes
      // A file we cannot parse is not a file we may guess at. Starting from an empty fleet costs the
      // owner a re-pair; half-reading it could point a pinned connection at the wrong fingerprint.
      console.warn('[fleet] fleet.json is unreadable; starting from an empty fleet')
    } catch {
      // No file yet — first launch.
    }
    return []
  }

  private write(nodes: FleetNode[]): void {
    this.#nodes = nodes
    const path = join(this.userDataDir, FLEET_FILE)
    mkdirSync(this.userDataDir, { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify({ version: 1, nodes } satisfies z.input<typeof fleetFileSchema>, null, 2)}\n`, { mode: 0o600 })
    chmodSync(path, 0o600)
  }
}
