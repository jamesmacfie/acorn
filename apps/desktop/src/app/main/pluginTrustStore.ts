import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { NodePluginPermissions } from '@acorn/protocol/api.ts'

// This device's decisions about which plugin bundles it will run
// (docs/plugins.md).
//
// The shape is repo-config trust's, moved out one level. There, `config_acks` binds
// `(project_id, hash)` and lives on the node, because the thing being approved is a config the node
// will execute. Here the key is `(pluginId, hash)` and the file lives on the device, because the
// thing being approved is code THIS machine is about to run — which is also why acknowledgements are
// deliberately per-device: pairing a new laptop re-prompts, exactly as it re-pairs.
//
// Not encrypted, unlike the device tokens next door. A decision record is not a secret, and
// safeStorage would mean a machine with no keychain silently forgets every decision the owner made
// and re-prompts for all of them. Same file discipline as fleet.json otherwise: 0700 dir, 0600 file,
// chmod after write.
//
// `permissions` and `version` are stored alongside for one reason: an update arrives as a new hash,
// and the only way to show the owner what CHANGED is to still have what they last agreed to. This is
// `config_acks.snapshot` serving the same purpose.

const TRUST_FILE = 'plugin-trust.json'

const ackSchema = z.strictObject({
  pluginId: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  // The node that served these bytes, so the prompt can name it and a later audit can answer "where
  // did this come from". Not part of the key: the same bundle from a second node is the same code.
  nodeId: z.string().min(1),
  version: z.string().min(1),
  permissions: z.custom<NodePluginPermissions>(),
  decision: z.enum(['accepted', 'rejected']),
  decidedAt: z.number().int(),
})
export type PluginAck = z.infer<typeof ackSchema>

const fileSchema = z.strictObject({ version: z.literal(1), acks: z.array(ackSchema) })

export class PluginTrustStore {
  #acks: PluginAck[] | null = null

  constructor(private readonly userDataDir: string) {}

  list(): PluginAck[] {
    if (!this.#acks) this.#acks = this.read()
    return [...this.#acks]
  }

  // Undefined means "never seen these bytes" — which is the prompt condition. A rejection is a real
  // answer and is remembered, so a plugin the owner turned away does not ask again every boot.
  decisionFor(pluginId: string, hash: string): PluginAck | undefined {
    return this.list().find((ack) => ack.pluginId === pluginId && ack.hash === hash)
  }

  // The most recent bundle of this plugin the owner accepted, when it is not the one being asked
  // about. This is what turns a bare "do you trust this?" into "this plugin has been updated, and
  // here is what its permissions gained".
  previousFor(pluginId: string, hash: string): PluginAck | undefined {
    return this.list()
      .filter((ack) => ack.pluginId === pluginId && ack.hash !== hash && ack.decision === 'accepted')
      .sort((a, b) => b.decidedAt - a.decidedAt)[0]
  }

  // Upsert on (pluginId, hash). Re-deciding the same bundle replaces the row rather than appending,
  // so the file cannot grow a history of one plugin being toggled.
  record(ack: PluginAck): void {
    const parsed = ackSchema.parse(ack)
    this.write([...this.list().filter((existing) => !(existing.pluginId === parsed.pluginId && existing.hash === parsed.hash)), parsed])
  }

  // Forgetting a node does NOT drop its acknowledgements. The decision was about bytes, and those
  // bytes are still in the cache and may still be offered by another node; re-pairing the same node
  // should not re-prompt for code the owner already approved.
  //
  // What it does drop is the last accepted row for a plugin no node offers any more, once the cache
  // has evicted the bundle — which the cache sweep handles on its own clock.
  forgetPlugin(pluginId: string): void {
    this.write(this.list().filter((ack) => ack.pluginId !== pluginId))
  }

  private read(): PluginAck[] {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(join(this.userDataDir, TRUST_FILE), 'utf8')))
      if (parsed.success) return parsed.data.acks
      // Fail closed: an unreadable decision file means every plugin re-prompts, which is an annoyance.
      // Guessing at it could mean running code on the strength of a half-parsed row.
      console.warn('[plugins] plugin-trust.json is unreadable; every plugin will ask again')
    } catch {
      // No file yet — nothing has ever been trusted on this device.
    }
    return []
  }

  private write(acks: PluginAck[]): void {
    this.#acks = acks
    const path = join(this.userDataDir, TRUST_FILE)
    mkdirSync(this.userDataDir, { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify({ version: 1, acks } satisfies z.input<typeof fileSchema>, null, 2)}\n`, { mode: 0o600 })
    chmodSync(path, 0o600)
  }
}
