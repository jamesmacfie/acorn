import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { PluginKeyClaimGrant, PluginWebviewGrant } from '@acorn/protocol/api.ts'
import { pluginPermissionsSchema } from '@acorn/protocol/pluginContract.ts'

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

const webviewGrantSchema = z.strictObject({
  surface: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  hosts: z.array(z.string().min(1).max(253)).min(1).max(32),
}) as z.ZodType<PluginWebviewGrant>

const keyClaimGrantSchema = z.strictObject({
  surface: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  chords: z.array(z.string().min(1).max(64)).min(1).max(32),
}) as z.ZodType<PluginKeyClaimGrant>

const ackSchema = z.strictObject({
  pluginId: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  // The node that served these bytes, so the prompt can name it and a later audit can answer "where
  // did this come from". Not part of the key: the same bundle from a second node is the same code.
  nodeId: z.string().min(1),
  version: z.string().min(1),
  // Parsed, not cast. This is the disclosure the owner consents to, so it has to be provably the
  // same shape the node parsed off disk (@acorn/protocol/pluginContract.ts).
  permissions: pluginPermissionsSchema,
  // Default keeps version-1 trust files written before webviews readable. An old acknowledgement
  // simply says the previously accepted bundle had no recorded webview grant.
  webviews: z.array(webviewGrantSchema).max(32).default([]),
  // Default keeps acknowledgements written before frame key claims readable.
  keyClaims: z.array(keyClaimGrantSchema).max(32).default([]),
  decision: z.enum(['accepted', 'rejected']),
  decidedAt: z.number().int(),
  // Set when the disclosure that came with the decision could not be fully parsed — a node running a
  // newer manifest schema than this shell (main/pluginIpc.ts). The decision itself is exact; what is
  // incomplete is the SNAPSHOT, so this row must never become the baseline of a "what changed" diff.
  // Optional, because no file written before this field existed carries it and its absence means
  // "complete", which is what those rows were.
  partial: z.literal(true).optional(),
})
export type PluginAck = z.infer<typeof ackSchema>

// Read loosely on purpose: the ROWS are validated one at a time below, so a single unreadable
// acknowledgement cannot condemn the ones beside it.
const fileSchema = z.strictObject({ version: z.literal(1), acks: z.array(z.unknown()) })

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
  // A `partial` row is not a candidate: its snapshot is known-incomplete, so diffing against it would
  // report grants as newly requested that the owner had in fact already seen — the alarming direction,
  // which is the one thing a trust prompt must never drift in.
  previousFor(pluginId: string, hash: string): PluginAck | undefined {
    return this.list()
      .filter((ack) => ack.pluginId === pluginId && ack.hash !== hash && ack.decision === 'accepted' && !ack.partial)
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

  // One row at a time, and that granularity is the whole point. Parsing the file as a unit meant a
  // single acknowledgement this shell could not read — one written by a newer build, one hand-edited —
  // failed ALL of them; and the damage did not stop at re-prompting, because the empty list became the
  // cache and the next `record()` or `forgetPlugin()` wrote it back. One unreadable row permanently
  // erased every decision on the device, including the rejections that keep unwanted plugins quiet.
  //
  // Still fail closed per row: a row we cannot read is a row we will ask about again, because guessing
  // at it could mean running code on the strength of a half-parsed record.
  private read(): PluginAck[] {
    let text: string
    try {
      text = readFileSync(join(this.userDataDir, TRUST_FILE), 'utf8')
    } catch {
      // No file — nothing has ever been trusted on this device. The one case with nothing to preserve,
      // which is why it is separated from the unreadable-bytes case below.
      return []
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = null
    }
    const file = fileSchema.safeParse(raw)
    if (!file.success) {
      // Not a shape we recognise at all, so we know nothing about what it held. Moved aside rather
      // than left to be silently overwritten by the next write: this is the only copy of every
      // decision the owner has ever made, and "we could not read it" must not become "it is gone".
      console.warn('[plugins] plugin-trust.json is unreadable; every plugin will ask again')
      this.quarantine()
      return []
    }
    const acks: PluginAck[] = []
    let dropped = 0
    for (const entry of file.data.acks) {
      const parsed = ackSchema.safeParse(entry)
      if (parsed.success) acks.push(parsed.data)
      else dropped++
    }
    if (dropped) {
      console.warn(`[plugins] ${dropped} plugin trust record(s) could not be read; those bundles will ask again`)
    }
    return acks
  }

  private quarantine(): void {
    const path = join(this.userDataDir, TRUST_FILE)
    try {
      renameSync(path, `${path}.corrupt`)
      console.warn(`[plugins] the previous file was kept as ${TRUST_FILE}.corrupt`)
    } catch (error) {
      // Best effort. A read-only or vanished directory is not a reason to fail the boot.
      console.warn('[plugins] could not set the unreadable trust file aside:', error)
    }
  }

  private write(acks: PluginAck[]): void {
    this.#acks = acks
    const path = join(this.userDataDir, TRUST_FILE)
    mkdirSync(this.userDataDir, { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify({ version: 1, acks } satisfies { version: 1; acks: PluginAck[] }, null, 2)}\n`, { mode: 0o600 })
    chmodSync(path, 0o600)
  }
}
