import { z } from 'zod'
import type {
  PluginAgentToolGrant,
  PluginContextSectionGrant,
  PluginHarnessGrant,
  PluginKeyClaimGrant,
  PluginNavigationDestinationGrant,
  PluginScheduleGrant,
  PluginTaskCheckGrant,
  PluginWebviewGrant,
} from '@acorn/protocol/api.ts'
import { pluginPermissionsSchema } from '@acorn/protocol/plugin/contract.ts'
import { cadenceSchema } from '@acorn/protocol/schedules.ts'
import { pluginCustomAgentGrantSchema, pluginExtensionGrantSchema } from './grantSchemas'
import { bundleSourceSchema, type BundleSource } from '@acorn/protocol/plugin/bundles.ts'
import type { RulesLog, TrustStorage } from './storage'

// This device's decisions about which plugin bundles it will run. See docs/plugins.md and
// docs/security.md, "Third-party plugin bundles", for the key, the storage, and what "gained" means
// in the update diff.
//
// Not encrypted, unlike the device tokens next door. A decision record is not a secret, and
// keychain-backed encryption would mean a machine with no keychain forgets every decision the owner made and
// re-prompts for all of them. Where the record lives, and how privately, is the host's storage
// (./storage.ts).

const sourceOf = (source: BundleSource | string): BundleSource =>
  typeof source === 'string' ? { kind: 'node', nodeId: source } : source
// Both sides are parsed JSON, so the order of an object's keys is the only difference to look past.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)))
      : inner,
  )
const sameSource = (left: BundleSource, right: BundleSource): boolean =>
  left.kind === right.kind && (left.kind === 'device' || (right.kind === 'node' && left.nodeId === right.nodeId))

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

const navigationDestinationGrantSchema = z.strictObject({
  surface: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  destination: z.string().min(1).max(64),
  targetKind: z.string().min(1).max(64),
  noticeKind: z.string().min(1).max(64).optional(),
}) as z.ZodType<PluginNavigationDestinationGrant>

// The cadence is the whole grant beside the name, so it is parsed rather than kept as an opaque
// blob. A snapshot that cannot be compared is one the update prompt cannot diff.
const scheduleGrantSchema = z.strictObject({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  cadence: cadenceSchema,
}) as z.ZodType<PluginScheduleGrant>

// `cleansUp` is the whole grant beside the id, and the diff turns on it. A package that used to only
// warn on archive and now offers to change something has grown its reach.
const taskCheckGrantSchema = z.strictObject({
  id: z.string().min(1).max(64),
  cleansUp: z.boolean(),
}) as z.ZodType<PluginTaskCheckGrant>

// The whole spawn is the grant, so all of it is parsed. "This package now runs a different binary"
// is the diff that matters most, and it needs a field-by-field comparison.
const harnessGrantSchema = z.strictObject({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  kind: z.enum(['command', 'entry']),
  run: z.string().min(1).max(512),
  env: z.array(z.string().min(1).max(64)).max(32),
}) as z.ZodType<PluginHarnessGrant>

const agentToolGrantSchema = z.strictObject({
  id: z.string().min(1).max(64),
  description: z.string().min(1).max(500),
  risk: z.enum(['read', 'write', 'execute']),
  requiresSession: z.boolean(),
  maxOutputBytes: z.number().int().positive(),
}) as z.ZodType<PluginAgentToolGrant>

const contextSectionGrantSchema = z.strictObject({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  defaultIncluded: z.boolean(),
  maxBytes: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
}) as z.ZodType<PluginContextSectionGrant>

const ackSchema = z.strictObject({
  pluginId: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  // The node that served these bytes, so the prompt can name it and a later audit can answer "where
  // did this come from". Not part of the key, because the same bundle from a second node is the same
  // code. Defaulted for an acknowledgement written before the field. Mixed-version path until 2026-12-26.
  nodeId: z.string().default(''),
  source: bundleSourceSchema.optional(),
  version: z.string().min(1),
  // Older records lack this binding and must be reviewed again before selection. The string is
  // produced by the shared protocol projection, not accepted from the Node as an authority claim.
  // Mixed-version path until 2026-12-27.
  declaration: z.string().min(1).max(1_000_000).optional(),
  // Parsed, not cast. This is the disclosure the owner consents to, so it has to be provably the
  // same shape the node parsed off disk. See @acorn/protocol/plugin/contract.ts.
  permissions: pluginPermissionsSchema,
  webviews: z.array(webviewGrantSchema).max(32),
  keyClaims: z.array(keyClaimGrantSchema).max(32),
  navigationDestinations: z.array(navigationDestinationGrantSchema).max(64),
  extensions: z.array(pluginExtensionGrantSchema).max(32),
  schedules: z.array(scheduleGrantSchema).max(4),
  taskChecks: z.array(taskCheckGrantSchema).max(4),
  harnesses: z.array(harnessGrantSchema).max(4),
  agentTools: z.array(agentToolGrantSchema).max(16),
  contextSections: z.array(contextSectionGrantSchema).max(8),
  // Default keeps acknowledgements written before custom agents existed readable. An old
  // acknowledgement says the accepted bundle added no agent, which was true.
  // Mixed-version path until 2026-12-28.
  customAgents: z.array(pluginCustomAgentGrantSchema).max(8).default([]),
  decision: z.enum(['accepted', 'rejected']),
  decidedAt: z.number().int(),
  // Set when the disclosure behind the decision could not be fully parsed, because a node ran a newer
  // manifest schema than this shell. The decision is exact and the snapshot is not, so this row must
  // never become the baseline of a "what changed" diff. Optional, because its absence means complete.
  partial: z.literal(true).optional(),
  // The dev grant below wrote this row when a bundle arrived for a plugin the owner put into
  // development mode. No human answered a prompt.
  //
  // Marked so revocation can find it. Ending dev mode has to drop these acknowledgements as well as
  // the grant, or every auto-trusted hash stays accepted and the control is a lie. It is also why a
  // dev row is always `partial`: nobody read a disclosure, so it must never become the baseline of a
  // later "what changed" diff.
  dev: z.literal(true).optional(),
})
export type PluginAck = z.infer<typeof ackSchema>
type PluginAckResult = { ack: PluginAck } | { ack: PluginAck; error: unknown }

// The dev trust grant. See docs/security.md, "The dev grant", and docs/plugins.md, "Development
// mode".
const devGrantSchema = z.strictObject({
  pluginId: z.string().min(1),
  nodeId: z.string().default(''),
  source: bundleSourceSchema.optional(),
  // Where the agent iterates, when the install was a local-path one. Display only, because it is the
  // node's filesystem and nothing here resolves it.
  path: z.string().min(1).max(1024).optional(),
  grantedAt: z.number().int(),
})
export type PluginDevGrant = z.infer<typeof devGrantSchema>

// Read loosely. The rows are validated one at a time below, so a single unreadable acknowledgement
// cannot condemn the ones beside it.
const fileSchema = z.strictObject({
  version: z.literal(1),
  acks: z.array(z.unknown()),
  devGrants: z.array(z.unknown()),
})

export class TrustStore {
  #acks: PluginAck[] | null = null
  #grants: PluginDevGrant[] | null = null

  constructor(
    private readonly storage: TrustStorage,
    private readonly log: RulesLog,
  ) {}

  list(): PluginAck[] {
    if (!this.#acks) this.read()
    return [...this.#acks!]
  }

  listDevGrants(): PluginDevGrant[] {
    if (!this.#grants) this.read()
    return [...this.#grants!]
  }

  devGrantFor(pluginId: string, source: BundleSource | string): PluginDevGrant | undefined {
    return this.listDevGrants().find(
      (grant) =>
        grant.pluginId === pluginId &&
        sameSource(grant.source ?? { kind: 'node', nodeId: grant.nodeId }, sourceOf(source)),
    )
  }

  /** Put a plugin into development mode on this device. Upsert, so re-approving does not stack rows. */
  grantDev(grant: PluginDevGrant): void {
    const parsed = devGrantSchema.parse(grant)
    this.write(this.list(), [
      ...this.listDevGrants().filter(
        (existing) =>
          !(
            existing.pluginId === parsed.pluginId &&
            sameSource(
              existing.source ?? { kind: 'node', nodeId: existing.nodeId },
              parsed.source ?? { kind: 'node', nodeId: parsed.nodeId },
            )
          ),
      ),
      { ...parsed, source: parsed.source ?? { kind: 'node', nodeId: parsed.nodeId } },
    ])
  }

  /** End development mode. See docs/security.md, "The dev grant". */
  revokeDev(pluginId: string, source: BundleSource | string): void {
    const provenance = sourceOf(source)
    this.write(
      this.list().filter(
        (ack) =>
          !(
            ack.dev &&
            ack.pluginId === pluginId &&
            sameSource(ack.source ?? { kind: 'node', nodeId: ack.nodeId }, provenance)
          ),
      ),
      this.listDevGrants().filter(
        (grant) =>
          !(
            grant.pluginId === pluginId &&
            sameSource(grant.source ?? { kind: 'node', nodeId: grant.nodeId }, provenance)
          ),
      ),
    )
  }

  /** Uninstall ends future automatic trust, but does not erase decisions already made for bytes. */
  forgetDevGrant(pluginId: string, source: BundleSource | string): void {
    const provenance = sourceOf(source)
    this.write(
      this.list(),
      this.listDevGrants().filter(
        (grant) =>
          !(
            grant.pluginId === pluginId &&
            sameSource(grant.source ?? { kind: 'node', nodeId: grant.nodeId }, provenance)
          ),
      ),
    )
  }

  // Undefined means "never seen these bytes", which is the prompt condition. A rejection is a real
  // answer and is remembered, so a plugin the owner turned away does not ask again every boot.
  decisionFor(pluginId: string, hash: string): PluginAck | undefined {
    return this.list().find((ack) => ack.pluginId === pluginId && ack.hash === hash)
  }

  /** Withdraw one exact decision. The caller controls whether the now-undecided offer is prompted
   * immediately or deferred for this session. Other versions keep their independent decisions. */
  forgetDecision(pluginId: string, hash: string): void {
    if (!this.decisionFor(pluginId, hash)) return
    this.write(
      this.list().filter((ack) => !(ack.pluginId === pluginId && ack.hash === hash)),
      this.listDevGrants(),
    )
  }

  // The most recent bundle of this plugin the owner accepted, when it is not the one being asked
  // about. It turns a bare "do you trust this?" into "this plugin has been updated, and here is what
  // its permissions gained".
  //
  // A `partial` row is not a candidate. Its snapshot is known incomplete, so a diff against it would
  // report grants as newly requested that the owner had already seen.
  previousFor(pluginId: string, hash: string): PluginAck | undefined {
    return this.list()
      .filter((ack) => ack.pluginId === pluginId && ack.hash !== hash && ack.decision === 'accepted' && !ack.partial)
      .sort((a, b) => b.decidedAt - a.decidedAt)[0]
  }

  // Upsert on (pluginId, hash). Re-deciding the same bundle replaces the row rather than appending,
  // so the file cannot grow a history of one plugin being toggled.
  record(ack: PluginAck): void {
    const result = this.recordBatch([ack])[0]!
    if ('error' in result) throw result.error
  }

  /** Validate each disclosure independently and commit successful decisions once. Unchanged
   * decisions retain their first timestamp. A failed commit leaves the remembered state intact. */
  recordBatch(input: Iterable<PluginAck>): PluginAckResult[] {
    let acks = this.list()
    const results: PluginAckResult[] = []
    let changed = false
    for (const ack of input) {
      try {
        const parsed = ackSchema.parse(ack)
        parsed.source ??= { kind: 'node', nodeId: parsed.nodeId }
        const stored = acks.find((existing) => existing.pluginId === parsed.pluginId && existing.hash === parsed.hash)
        if (stored && canonical({ ...stored, decidedAt: 0 }) === canonical({ ...parsed, decidedAt: 0 })) {
          results.push({ ack: stored })
          continue
        }
        acks = [
          ...acks.filter((existing) => !(existing.pluginId === parsed.pluginId && existing.hash === parsed.hash)),
          parsed,
        ]
        changed = true
        results.push({ ack: parsed })
      } catch (error) {
        results.push({ ack, error })
      }
    }
    if (changed) this.write(acks, this.listDevGrants())
    return results
  }

  /**
   * Accepts a bundle because the plugin is in development mode on this device, not because anyone
   * read a prompt. Returns false and stores nothing when there is no grant for (pluginId, nodeId),
   * which keeps this from being a second, quieter way to trust a bundle.
   *
   * Always `partial`, because there is no disclosure behind it. See docs/security.md, "The dev
   * grant".
   */
  recordDevAccept(input: {
    pluginId: string
    hash: string
    nodeId: string
    source?: BundleSource
    version: string
  }): boolean {
    const source = input.source ?? { kind: 'node', nodeId: input.nodeId }
    if (!this.devGrantFor(input.pluginId, source)) return false
    // A per-source development grant cannot overwrite a later manual decision on the globally
    // keyed bundle. This matters when another node offers the same bytes and the owner reviews it.
    const existing = this.decisionFor(input.pluginId, input.hash)
    if (existing && !existing.dev) return false
    this.record({
      ...input,
      source,
      permissions: {
        api: [],
        events: [],
        node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false },
      },
      webviews: [],
      keyClaims: [],
      navigationDestinations: [],
      extensions: [],
      schedules: [],
      taskChecks: [],
      harnesses: [],
      agentTools: [],
      contextSections: [],
      customAgents: [],
      decision: 'accepted',
      decidedAt: Date.now(),
      partial: true,
      dev: true,
    })
    return true
  }

  // Forgetting a node does not drop its acknowledgements. The decision was about bytes, those bytes
  // are still in the cache, and another node may still offer them, so re-pairing must not re-prompt
  // for code the owner already approved. The cache sweep drops the last accepted row for a plugin no
  // node offers any more, on its own clock.
  forgetPlugin(pluginId: string): void {
    this.write(
      this.list().filter((ack) => ack.pluginId !== pluginId),
      this.listDevGrants().filter((grant) => grant.pluginId !== pluginId),
    )
  }

  // One row at a time, and that granularity is the point. Parsing the file as a unit would mean one
  // acknowledgement this shell could not read fails all of them, and the damage would not stop at
  // re-prompting: the empty list would become the cache and the next record() or forgetPlugin() would
  // write it back. One unreadable row would erase every decision on the device, including the
  // rejections that keep unwanted plugins quiet.
  //
  // Still fails closed per row. A row this code cannot read is one it asks about again, because
  // guessing could mean running code on the strength of a half-parsed record.
  private read(): void {
    this.#acks = []
    this.#grants = []
    const text = this.storage.read()
    // Nothing stored, so nothing has ever been trusted on this device. The one case with nothing to
    // preserve, which is why it is separate from the unreadable-bytes case below.
    if (text === null) return
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = null
    }
    const file = fileSchema.safeParse(raw)
    if (!file.success) {
      // An unrecognised shape says nothing about what it held. Moved aside rather than left for the
      // next write to overwrite. This is the only copy of every decision the owner has made, and "we
      // could not read it" must not become "it is gone".
      this.log.warn('the plugin trust record is unreadable; every plugin will ask again')
      this.quarantine()
      return
    }
    const acks: PluginAck[] = []
    let dropped = 0
    for (const entry of file.data.acks) {
      const parsed = ackSchema.safeParse(entry)
      if (parsed.success)
        acks.push({ ...parsed.data, source: parsed.data.source ?? { kind: 'node', nodeId: parsed.data.nodeId } })
      else dropped++
    }
    if (dropped) {
      this.log.warn(`${dropped} plugin trust record(s) could not be read; those bundles will ask again`, { dropped })
    }
    // Same per-row stance, same direction of failure. A grant this code cannot read does not exist,
    // so the plugin it covered goes back to prompting per hash.
    const grants: PluginDevGrant[] = []
    for (const entry of file.data.devGrants) {
      const parsed = devGrantSchema.safeParse(entry)
      if (parsed.success)
        grants.push({ ...parsed.data, source: parsed.data.source ?? { kind: 'node', nodeId: parsed.data.nodeId } })
    }
    this.#acks = acks
    this.#grants = grants
  }

  private quarantine(): void {
    try {
      this.log.warn(`the previous record was kept as ${this.storage.setAside()}`)
    } catch (error) {
      // Best effort. A read-only or vanished directory is not a reason to fail the boot.
      this.log.warn(
        `could not set the unreadable trust record aside: ${error instanceof Error ? error.message : error}`,
      )
    }
  }

  private write(acks: PluginAck[], devGrants: PluginDevGrant[]): void {
    const file = { version: 1, acks, devGrants } satisfies {
      version: 1
      acks: PluginAck[]
      devGrants: PluginDevGrant[]
    }
    this.storage.write(`${JSON.stringify(file, null, 2)}\n`)
    this.#acks = acks
    this.#grants = devGrants
  }
}
