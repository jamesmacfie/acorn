import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { nodeRecordSchema, type NodeRecord } from '@acorn/protocol/broker.ts'
import { LOCAL_TOKEN_SCOPE, type DeviceTokens } from '../custody/deviceTokenStore'
import { createLogger } from '@acorn/node-core/server/telemetry/logger.ts'

const log = createLogger('fleet')

// Fleet membership, its storage split, and the local-node singleton invariant. See docs/shell.md,
// "Fleet membership".
//
// File discipline: 0700 dir, 0600 files, chmod after write so a looser umask on an existing file
// cannot survive.

const FLEET_FILE = 'fleet.json'

// The stored record: a NodeRecord plus the two fields the renderer must never need.
export const fleetNodeSchema = nodeRecordSchema.extend({
  // The node's self-signed certificate, used as the CA for the pinned agent. Public material, but
  // main performs the TLS, so the renderer has no use for it.
  certPem: z.string().optional(),
  // This device's row in the node's `devices` table, so "Revoke" can name it. Absent for the local
  // node, which is adopted from the service start handoff rather than paired.
  deviceId: z.string().optional(),
})
export type FleetNode = z.infer<typeof fleetNodeSchema>

const fleetFileSchema = z.strictObject({ version: z.literal(1), nodes: z.array(fleetNodeSchema) })

// The renderer's projection. See docs/shell.md, "Fleet membership".
export const toNodeRecord = (node: FleetNode): NodeRecord => ({
  nodeId: node.nodeId,
  label: node.label,
  endpoint: node.endpoint,
  local: node.local,
  ...(node.fingerprint ? { fingerprint: node.fingerprint } : {}),
  // Provenance travels to the renderer; the certificate and the device row still do not. A fleet
  // surface has to be able to say which rows came from a provider and which plugin vouched for them.
  ...(node.provider ? { provider: node.provider } : {}),
})

// The bundled local node's token predates its nodeId. See docs/shell.md, "Fleet membership".
const scopeOf = (node: Pick<FleetNode, 'nodeId' | 'local'>): string => (node.local ? LOCAL_TOKEN_SCOPE : node.nodeId)

export class FleetStore {
  #nodes: FleetNode[] | null = null

  constructor(
    private readonly userDataDir: string,
    private readonly tokens: DeviceTokens,
  ) {}

  list(): FleetNode[] {
    if (!this.#nodes) this.#nodes = this.read()
    return [...this.#nodes]
  }

  get(nodeId: string): FleetNode | undefined {
    return this.list().find((node) => node.nodeId === nodeId)
  }

  tokenFor(nodeId: string): string | undefined {
    const node = this.get(nodeId)
    return node ? this.tokens.read(scopeOf(node)) : undefined
  }

  // Add or replace a node and its token. Called on every local-node start, because the ephemeral port
  // changes the endpoint across restarts, and once per successful pairing.
  //
  // See docs/shell.md, "Fleet membership", for why a local node replaces any other local row as well
  // as its own.
  remember(node: FleetNode, token: string): FleetNode {
    const nodes = this.list().filter((existing) => existing.nodeId !== node.nodeId && !(node.local && existing.local))
    nodes.push(node)
    this.write(nodes)
    this.tokens.write(scopeOf(node), token)
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

  // Forget locally. Dropping the token as well as the row is the point. A row without a token would
  // reconnect as an unauthenticated stranger, and a token without a row is an orphaned credential.
  forget(nodeId: string): void {
    const node = this.get(nodeId)
    if (!node) return
    this.write(this.list().filter((candidate) => candidate.nodeId !== nodeId))
    this.tokens.forget(scopeOf(node))
  }

  private read(): FleetNode[] {
    try {
      const parsed = fleetFileSchema.safeParse(JSON.parse(readFileSync(join(this.userDataDir, FLEET_FILE), 'utf8')))
      if (parsed.success) return parsed.data.nodes
      // An unparseable file is not one to guess at. Starting from an empty fleet costs the owner a
      // re-pair, where half-reading it could point a pinned connection at the wrong fingerprint.
      log.warn('fleet.json is unreadable; starting from an empty fleet')
    } catch {
      // No file yet, so this is a first launch.
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
