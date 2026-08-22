import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { PluginExtensionGrant, PluginKeyClaimGrant, PluginScheduleGrant, PluginTaskCheckGrant, PluginWebviewGrant } from '@acorn/protocol/api.ts'
import { pluginPermissionsSchema } from '@acorn/protocol/pluginContract.ts'
import { cadenceSchema } from '@acorn/protocol/schedules.ts'

// This device's decisions about which plugin bundles it will run. Why the key and storage mirror
// repo-config trust, and what "gained" means for the update diff: docs/plugins.md, docs/security.md
// § Third-party plugin bundles.
//
// Not encrypted, unlike the device tokens next door. A decision record is not a secret, and
// safeStorage would mean a machine with no keychain silently forgets every decision the owner made
// and re-prompts for all of them. Same file discipline as fleet.json otherwise: 0700 dir, 0600 file,
// chmod after write.

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

const extensionGrantSchema = z.strictObject({
  kind: z.enum(['hosts', 'extends', 'replaces']),
  // A `<pluginId>:<pointId>` reference or a designated core slot id, both bounded by the manifest.
  target: z.string().min(1).max(130),
  label: z.string().min(1).max(80),
}) as z.ZodType<PluginExtensionGrant>

// The cadence is the whole grant beside the name, so it is parsed rather than kept as an opaque blob: a
// snapshot that cannot be compared is a snapshot the update prompt cannot diff.
const scheduleGrantSchema = z.strictObject({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  cadence: cadenceSchema,
}) as z.ZodType<PluginScheduleGrant>

// `cleansUp` is the whole grant beside the id, and it is what the diff turns on: a package that used
// to only warn on archive and now offers to change something has grown its reach.
const taskCheckGrantSchema = z.strictObject({
  id: z.string().min(1).max(64),
  cleansUp: z.boolean(),
}) as z.ZodType<PluginTaskCheckGrant>

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
  // Default keeps acknowledgements written before the cooperative cross-plugin seam readable. An old
  // acknowledgement says the previously accepted bundle reached into nothing outside itself, which is
  // exactly what was true of it.
  extensions: z.array(extensionGrantSchema).max(32).default([]),
  // Default keeps acknowledgements written before schedules existed readable. An old acknowledgement
  // says the previously accepted bundle ran nothing on its own, which is what was true of it.
  schedules: z.array(scheduleGrantSchema).max(4).default([]),
  // Default keeps acknowledgements written before archive checks existed readable. An old
  // acknowledgement says the previously accepted bundle had nothing to say on archive.
  taskChecks: z.array(taskCheckGrantSchema).max(4).default([]),
  decision: z.enum(['accepted', 'rejected']),
  decidedAt: z.number().int(),
  // Set when the disclosure that came with the decision could not be fully parsed, because a node ran
  // a newer manifest schema than this shell (main/pluginIpc.ts). The decision itself is exact; what is
  // incomplete is the snapshot, so this row must never become the baseline of a "what changed" diff.
  // Optional, because no file written before this field existed carries it, and its absence means
  // "complete", which is what those rows were.
  partial: z.literal(true).optional(),
  // This row was not written by a human answering a prompt. It was written by the dev grant below, on
  // this device's behalf, when a bundle of a plugin the owner put into development mode arrived.
  //
  // Marked so revocation can find it. Ending dev mode has to drop these acknowledgements as well as the
  // grant, or "revoke" would leave every auto-trusted hash still accepted and the control would be a
  // lie. It is also why a dev row is always `partial`: nobody read a disclosure, so it must never become
  // the baseline of a later "what changed" diff.
  dev: z.literal(true).optional(),
})
export type PluginAck = z.infer<typeof ackSchema>

// The dev trust grant: docs/security.md § The dev grant, docs/plugins.md § Development mode.
const devGrantSchema = z.strictObject({
  pluginId: z.string().min(1),
  nodeId: z.string().min(1),
  // Where the agent iterates, when the install was a local-path one. Display only: it is the node's
  // filesystem, not this device's, and nothing here resolves it.
  path: z.string().min(1).max(1024).optional(),
  grantedAt: z.number().int(),
})
export type PluginDevGrant = z.infer<typeof devGrantSchema>

// Read loosely: the rows are validated one at a time below, so a single unreadable acknowledgement
// cannot condemn the ones beside it. `devGrants` defaults, so a file written before dev mode existed
// reads as "nothing is in development", which is what it was.
const fileSchema = z.strictObject({ version: z.literal(1), acks: z.array(z.unknown()), devGrants: z.array(z.unknown()).default([]) })

export class PluginTrustStore {
  #acks: PluginAck[] | null = null
  #grants: PluginDevGrant[] | null = null

  constructor(private readonly userDataDir: string) {}

  list(): PluginAck[] {
    if (!this.#acks) this.read()
    return [...this.#acks!]
  }

  listDevGrants(): PluginDevGrant[] {
    if (!this.#grants) this.read()
    return [...this.#grants!]
  }

  devGrantFor(pluginId: string, nodeId: string): PluginDevGrant | undefined {
    return this.listDevGrants().find((grant) => grant.pluginId === pluginId && grant.nodeId === nodeId)
  }

  /** Put a plugin into development mode on this device. Upsert, so re-approving does not stack rows. */
  grantDev(grant: PluginDevGrant): void {
    const parsed = devGrantSchema.parse(grant)
    this.write(
      this.list(),
      [...this.listDevGrants().filter((existing) => !(existing.pluginId === parsed.pluginId && existing.nodeId === parsed.nodeId)), parsed],
    )
  }

  /**
  /**
   * End development mode: docs/security.md § The dev grant.
   */
  revokeDev(pluginId: string, nodeId: string): void {
    this.write(
      this.list().filter((ack) => !(ack.dev && ack.pluginId === pluginId && ack.nodeId === nodeId)),
      this.listDevGrants().filter((grant) => !(grant.pluginId === pluginId && grant.nodeId === nodeId)),
    )
  }

  // Undefined means "never seen these bytes", which is the prompt condition. A rejection is a real
  // answer and is remembered, so a plugin the owner turned away does not ask again every boot.
  decisionFor(pluginId: string, hash: string): PluginAck | undefined {
    return this.list().find((ack) => ack.pluginId === pluginId && ack.hash === hash)
  }

  // The most recent bundle of this plugin the owner accepted, when it is not the one being asked
  // about. This is what turns a bare "do you trust this?" into "this plugin has been updated, and
  // here is what its permissions gained".
  // A `partial` row is not a candidate: its snapshot is known incomplete, so diffing against it would
  // report grants as newly requested that the owner had in fact already seen, the one direction a
  // trust prompt must never drift in.
  previousFor(pluginId: string, hash: string): PluginAck | undefined {
    return this.list()
      .filter((ack) => ack.pluginId === pluginId && ack.hash !== hash && ack.decision === 'accepted' && !ack.partial)
      .sort((a, b) => b.decidedAt - a.decidedAt)[0]
  }

  // Upsert on (pluginId, hash). Re-deciding the same bundle replaces the row rather than appending,
  // so the file cannot grow a history of one plugin being toggled.
  record(ack: PluginAck): void {
    const parsed = ackSchema.parse(ack)
    this.write([...this.list().filter((existing) => !(existing.pluginId === parsed.pluginId && existing.hash === parsed.hash)), parsed], this.listDevGrants())
  }

  /**
  /**
   * Accepts a bundle because the plugin is in development mode on this device, not because anyone
   * read a prompt. Returns false and stores nothing when there is no grant for (pluginId, nodeId),
   * which is what keeps this from being a second, quieter way to trust a bundle.
   *
   * Always `partial`, because there is no disclosure behind it: docs/security.md § The dev grant.
   */
  recordDevAccept(input: { pluginId: string; hash: string; nodeId: string; version: string }): boolean {
    if (!this.devGrantFor(input.pluginId, input.nodeId)) return false
    this.record({
      ...input,
      permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } },
      webviews: [],
      keyClaims: [],
      extensions: [],
      schedules: [],
      taskChecks: [],
      decision: 'accepted',
      decidedAt: Date.now(),
      partial: true,
      dev: true,
    })
    return true
  }

  // Forgetting a node does not drop its acknowledgements. The decision was about bytes, and those
  // bytes are still in the cache and may still be offered by another node, so re-pairing the same
  // node should not re-prompt for code the owner already approved.
  //
  // What it does drop is the last accepted row for a plugin no node offers any more, once the cache
  // has evicted the bundle, which the cache sweep handles on its own clock.
  forgetPlugin(pluginId: string): void {
    this.write(
      this.list().filter((ack) => ack.pluginId !== pluginId),
      this.listDevGrants().filter((grant) => grant.pluginId !== pluginId),
    )
  }

  // One row at a time, and that granularity is the whole point. Parsing the file as a unit meant a
  // single acknowledgement this shell could not read, one written by a newer build, one hand-edited,
  // failed all of them, and the damage did not stop at re-prompting: the empty list became the cache
  // and the next record() or forgetPlugin() wrote it back. One unreadable row permanently erased
  // every decision on the device, including the rejections that keep unwanted plugins quiet.
  //
  // Still fails closed per row: a row this code cannot read is a row it will ask about again,
  // because guessing at it could mean running code on the strength of a half-parsed record.
  private read(): void {
    this.#acks = []
    this.#grants = []
    let text: string
    try {
      text = readFileSync(join(this.userDataDir, TRUST_FILE), 'utf8')
    } catch {
      // No file: nothing has ever been trusted on this device. The one case with nothing to
      // preserve, which is why it is separated from the unreadable-bytes case below.
      return
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
      return
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
    // Same per-row stance, same direction of failure: a grant we cannot read is a grant that does not
    // exist, so the plugin it covered goes back to prompting per hash.
    const grants: PluginDevGrant[] = []
    for (const entry of file.data.devGrants) {
      const parsed = devGrantSchema.safeParse(entry)
      if (parsed.success) grants.push(parsed.data)
    }
    this.#acks = acks
    this.#grants = grants
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

  private write(acks: PluginAck[], devGrants: PluginDevGrant[]): void {
    this.#acks = acks
    this.#grants = devGrants
    const path = join(this.userDataDir, TRUST_FILE)
    mkdirSync(this.userDataDir, { recursive: true, mode: 0o700 })
    const file = { version: 1, acks, devGrants } satisfies { version: 1; acks: PluginAck[]; devGrants: PluginDevGrant[] }
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
    chmodSync(path, 0o600)
  }
}
