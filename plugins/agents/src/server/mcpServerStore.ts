// The user's MCP servers, as the settings page edits them and as sessions receive them
// (docs/mcp.md § Your own servers).
//
// One row per server, keyed by name. A secret value is sealed on the way in and revealed only by
// `resolve()`, which runs when a provider starts. Nothing that reads the list, the settings page
// included, ever sees one.
import { and, asc, eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { PluginDatabase, SecretService } from '@acorn/plugin-api/node'
import * as schema from '../node/schema'
import type { AgentDriverMcpServer } from './drivers/types'
import type { AgentMcpManagedPackage, AgentMcpPair, AgentMcpServer, AgentMcpServerInput, AgentMcpTransport } from '../shared/mcpServers'
import type { McpInstalledPackage } from './mcpPackageInstall'

// Exactly one of `value` and `sealed` is set: `sealed` when the pair is a secret.
type StoredPair = { name: string; secret: boolean; value?: string; sealed?: string }
type StoredConfig = {
  transport: AgentMcpTransport
  command: string | null
  args: string[]
  url: string | null
  values: StoredPair[]
  managed?: AgentMcpManagedPackage
  consentRevision?: string
  reviewTools?: boolean
  approvedCatalogue?: { revision: string; digest: string; version: number; tools: Record<string, unknown>[] }
}

type Row = typeof schema.agentMcpServers.$inferSelect

// A row this version cannot read is left out rather than thrown on, so one bad row cannot take every
// session's servers with it.
function storedConfig(row: Row): StoredConfig | null {
  try {
    const parsed = JSON.parse(row.configJson) as Partial<StoredConfig>
    if (parsed.transport !== 'stdio' && parsed.transport !== 'http') return null
    return {
      transport: parsed.transport,
      command: typeof parsed.command === 'string' ? parsed.command : null,
      args: Array.isArray(parsed.args) ? parsed.args.filter((arg): arg is string => typeof arg === 'string') : [],
      url: typeof parsed.url === 'string' ? parsed.url : null,
      values: Array.isArray(parsed.values)
        ? parsed.values.filter((pair): pair is StoredPair => !!pair && typeof pair.name === 'string')
        : [],
      managed: parsed.managed && typeof parsed.managed.lockDigest === 'string' ? parsed.managed : undefined,
      consentRevision: typeof parsed.consentRevision === 'string' ? parsed.consentRevision : undefined,
      reviewTools: parsed.reviewTools === true,
      approvedCatalogue: parsed.approvedCatalogue && typeof parsed.approvedCatalogue.digest === 'string' ? parsed.approvedCatalogue : undefined,
    }
  } catch {
    return null
  }
}

function configRevision(config: StoredConfig, enabled: boolean): string {
  const { consentRevision: _consent, approvedCatalogue: _approval, ...content } = config
  return createHash('sha256').update(JSON.stringify({ content, enabled })).digest('hex')
}

function publicServer(row: Row, config: StoredConfig): AgentMcpServer {
  const revision = configRevision(config, row.enabled)
  return {
    name: row.name,
    transport: config.transport,
    command: config.command,
    args: config.args,
    url: config.url,
    values: config.values.map((pair): AgentMcpPair => ({
      name: pair.name,
      secret: pair.secret,
      value: pair.secret ? null : pair.value ?? '',
    })),
    enabled: row.enabled,
    updatedAt: row.updatedAt,
    managed: config.managed ?? null,
    revision,
    consented: config.consentRevision === revision,
    reviewTools: config.reviewTools === true,
    approvedCatalogueDigest: config.approvedCatalogue?.revision === revision ? config.approvedCatalogue.digest : null,
  }
}

export class AgentMcpServerStore {
  readonly #db: PluginDatabase
  readonly #secrets: SecretService
  readonly #managedRoot: string | undefined
  readonly #activeManagedRoots = new Set<ReadonlySet<string>>()

  holdManagedRoots(roots: readonly string[]): () => void {
    const held = new Set(roots)
    this.#activeManagedRoots.add(held)
    return () => { this.#activeManagedRoots.delete(held) }
  }

  activeManagedRoots(): ReadonlySet<string> {
    return new Set([...this.#activeManagedRoots].flatMap((roots) => [...roots]))
  }

  constructor(db: PluginDatabase, secrets: SecretService, managedRoot?: string) {
    this.#db = db
    this.#secrets = secrets
    this.#managedRoot = managedRoot
  }

  async list(): Promise<AgentMcpServer[]> {
    const rows = await this.#db.select().from(schema.agentMcpServers).orderBy(asc(schema.agentMcpServers.name))
    return rows.flatMap((row) => {
      const config = storedConfig(row)
      return config ? [publicServer(row, config)] : []
    })
  }

  async get(name: string): Promise<AgentMcpServer | null> {
    const row = await this.#row(name)
    const config = row && storedConfig(row)
    return row && config ? publicServer(row, config) : null
  }

  /** The servers a new session starts with. */
  async enabledNames(): Promise<string[]> {
    return (await this.list()).filter((server) => server.enabled).map((server) => server.name)
  }

  /**
   * Creates or replaces one server. A secret sent without a value keeps the one already stored under
   * that name, which is how the form edits a server without ever holding its secrets.
   */
  async save(name: string, input: AgentMcpServerInput): Promise<AgentMcpServer> {
    const before = await this.#row(name)
    const priorConfig = before && storedConfig(before)
    if (priorConfig?.managed && (input.transport !== 'stdio' || input.command !== priorConfig.command || JSON.stringify(input.args ?? []) !== JSON.stringify(priorConfig.args))) {
      throw new Error('Remove the managed server before changing its installed command.')
    }
    const previous = new Map((before && storedConfig(before)?.values || []).map((pair) => [pair.name, pair]))
    const values: StoredPair[] = []
    for (const pair of input.values ?? []) {
      if (!pair.secret) {
        values.push({ name: pair.name, secret: false, value: pair.value ?? '' })
      } else if (pair.value !== undefined) {
        values.push({ name: pair.name, secret: true, sealed: await this.#secrets.seal(pair.value) })
      } else {
        const kept = previous.get(pair.name)
        if (!kept?.secret || !kept.sealed) throw new Error(`${pair.name} needs a value.`)
        values.push(kept)
      }
    }
    const config: StoredConfig = {
      transport: input.transport,
      command: input.transport === 'stdio' ? input.command ?? null : null,
      args: input.transport === 'stdio' ? input.args ?? [] : [],
      url: input.transport === 'http' ? input.url ?? null : null,
      values,
      managed: priorConfig?.managed,
      reviewTools: input.reviewTools === true,
    }
    const revision = configRevision(config, input.enabled)
    if (priorConfig?.consentRevision === revision) config.consentRevision = revision
    config.approvedCatalogue = priorConfig?.approvedCatalogue
    const now = Date.now()
    await this.#db
      .insert(schema.agentMcpServers)
      .values({ name, configJson: JSON.stringify(config), enabled: input.enabled, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.agentMcpServers.name,
        set: { configJson: JSON.stringify(config), enabled: input.enabled, updatedAt: now },
      })
    const saved = await this.get(name)
    if (!saved) throw new Error('The MCP server was not saved.')
    return saved
  }

  async consent(name: string, expectedRevision: string): Promise<AgentMcpServer | null> {
    const row = await this.#row(name)
    const config = row && storedConfig(row)
    if (!row || !config) return null
    if (configRevision(config, row.enabled) !== expectedRevision) throw new Error('The MCP server changed. Review its configuration again.')
    config.consentRevision = expectedRevision
    const changed = await this.#db.update(schema.agentMcpServers).set({ configJson: JSON.stringify(config) })
      .where(and(eq(schema.agentMcpServers.name, name), eq(schema.agentMcpServers.configJson, row.configJson)))
      .returning({ name: schema.agentMcpServers.name })
    if (!changed.length) throw new Error('The MCP server changed. Review its configuration again.')
    return publicServer(row, config)
  }

  async approvedCatalogue(name: string, revision: string): Promise<NonNullable<StoredConfig['approvedCatalogue']> | null> {
    const row = await this.#row(name)
    const config = row && storedConfig(row)
    return row && config && configRevision(config, row.enabled) === revision && config.approvedCatalogue?.revision === revision
      ? config.approvedCatalogue ?? null : null
  }

  async previousCatalogue(name: string): Promise<StoredConfig['approvedCatalogue'] | null> {
    const row = await this.#row(name)
    return row ? storedConfig(row)?.approvedCatalogue ?? null : null
  }

  async approveCatalogue(name: string, revision: string, catalogue: { digest: string; version: number; tools: Record<string, unknown>[] }): Promise<AgentMcpServer> {
    const row = await this.#row(name)
    const config = row && storedConfig(row)
    if (!row || !config || configRevision(config, row.enabled) !== revision || !config.reviewTools || config.consentRevision !== revision) {
      throw new Error('The MCP server configuration changed before approval.')
    }
    config.approvedCatalogue = { revision, ...catalogue }
    const changed = await this.#db.update(schema.agentMcpServers).set({ configJson: JSON.stringify(config) })
      .where(and(eq(schema.agentMcpServers.name, name), eq(schema.agentMcpServers.configJson, row.configJson)))
      .returning({ name: schema.agentMcpServers.name })
    if (!changed.length) throw new Error('The MCP server configuration changed before approval.')
    return publicServer(row, config)
  }

  async revokeCatalogue(name: string, revision: string, digest: string): Promise<void> {
    const row = await this.#row(name)
    const config = row && storedConfig(row)
    if (!row || !config || config.approvedCatalogue?.revision !== revision || config.approvedCatalogue.digest !== digest) return
    delete config.approvedCatalogue
    await this.#db.update(schema.agentMcpServers).set({ configJson: JSON.stringify(config) })
      .where(and(eq(schema.agentMcpServers.name, name), eq(schema.agentMcpServers.configJson, row.configJson)))
  }

  /** The package was fully installed and checked before this row is changed. A failed save leaves the
   *  previous row selected; the unreferenced package is removed by the bounded orphan sweep. */
  async saveManaged(name: string, installed: McpInstalledPackage, values: AgentMcpServerInput['values'], enabled: boolean, expectedRevision: string | null, signal?: AbortSignal): Promise<AgentMcpServer> {
    signal?.throwIfAborted()
    const before = await this.#row(name)
    const beforeConfig = before && storedConfig(before)
    if ((before && (!beforeConfig || configRevision(beforeConfig, before.enabled) !== expectedRevision)) || (!before && expectedRevision !== null)) {
      throw new Error('The managed server changed before activation.')
    }
    const previous = new Map((before && storedConfig(before)?.values || []).map((pair) => [pair.name, pair]))
    const stored: StoredPair[] = []
    for (const pair of values ?? []) {
      if (!pair.secret) stored.push({ name: pair.name, secret: false, value: pair.value ?? '' })
      else if (pair.value !== undefined) stored.push({ name: pair.name, secret: true, sealed: await this.#secrets.seal(pair.value) })
      else {
        const kept = previous.get(pair.name)
        if (!kept?.secret || !kept.sealed) throw new Error(`${pair.name} needs a value.`)
        stored.push(kept)
      }
    }
    const managed: AgentMcpManagedPackage = {
      package: installed.coordinate.name, version: installed.coordinate.version, bin: installed.bin,
      lockDigest: installed.lockDigest, registry: installed.registry, graph: installed.graph,
      treeDigest: installed.treeDigest,
      installationId: installed.installationId,
      entryDigest: installed.entryDigest,
      runtime: installed.runtime, policyVersion: installed.policyVersion,
      installer: installed.installer,
      exceptions: installed.exceptions,
    }
    const config: StoredConfig = {
      transport: 'stdio', command: process.execPath, args: [installed.entry], url: null, values: stored, managed,
      reviewTools: before ? storedConfig(before)?.reviewTools === true : false,
      approvedCatalogue: before ? storedConfig(before)?.approvedCatalogue : undefined,
    }
    // The activation route is the device's explicit consent to this exact staged graph and binary.
    config.consentRevision = configRevision(config, enabled)
    signal?.throwIfAborted()
    const now = Date.now()
    const changed = before
      ? await this.#db.update(schema.agentMcpServers).set({ configJson: JSON.stringify(config), enabled, updatedAt: now })
        .where(and(eq(schema.agentMcpServers.name, name), eq(schema.agentMcpServers.configJson, before.configJson), eq(schema.agentMcpServers.enabled, before.enabled)))
        .returning({ name: schema.agentMcpServers.name })
      : await this.#db.insert(schema.agentMcpServers)
        .values({ name, configJson: JSON.stringify(config), enabled, createdAt: now, updatedAt: now })
        .onConflictDoNothing().returning({ name: schema.agentMcpServers.name })
    if (!changed.length) throw new Error('The managed server changed before activation.')
    const saved = await this.get(name)
    if (!saved) throw new Error('The managed MCP package was installed but its server was not saved.')
    return saved
  }

  async remove(name: string): Promise<boolean> {
    const before = await this.#row(name)
    if (!before) return false
    await this.#db.delete(schema.agentMcpServers).where(eq(schema.agentMcpServers.name, name))
    return true
  }

  /**
   * The named servers with their secrets revealed, for a provider that is about to start. A name with
   * no server behind it is dropped: it was removed in Settings after the session switched it on.
   * `secrets` is every value it revealed, so the runtime can redact them from what it records.
   * `unavailable` names a server whose secret would not open, such as after the node's key changed,
   * so the session starts without that one server instead of not at all.
   */
  async resolve(
    names: readonly string[],
    purpose: string,
    signal?: AbortSignal,
  ): Promise<{ servers: AgentDriverMcpServer[]; secrets: string[]; unavailable: string[]; managedRoots: string[]; revisions: Record<string, { revision: string; reviewTools: boolean }> }> {
    const servers: AgentDriverMcpServer[] = []
    const secrets: string[] = []
    const unavailable: string[] = []
    const managedRoots: string[] = []
    const revisions: Record<string, { revision: string; reviewTools: boolean }> = {}
    for (const name of names) {
      signal?.throwIfAborted()
      const row = await this.#row(name)
      signal?.throwIfAborted()
      const config = row && storedConfig(row)
      if (!config) continue
      if (config.consentRevision !== configRevision(config, row!.enabled)) { unavailable.push(name); continue }
      let managedRoot: string | null = null
      if (config.managed) {
        try {
          if (!this.#managedRoot || config.command !== process.execPath || config.args.length !== 1) throw new Error('Invalid managed launch.')
          if (!/^[0-9a-f-]{36}$/.test(config.managed.installationId)) throw new Error('Invalid managed installation identity.')
          const root = await realpath(join(this.#managedRoot, `${config.managed.lockDigest}-${config.managed.installationId}`))
          const packageChecks = await import('./mcpPackageInstall')
          if (await packageChecks.mcpTreeDigest(root, signal) !== config.managed.treeDigest) throw new Error('Managed package files changed after installation.')
          if (await packageChecks.mcpRuntimeIdentity(signal) !== config.managed.runtime) throw new Error('Managed Node runtime changed after installation.')
          const entry = await realpath(config.args[0]!)
          const rel = relative(root, entry)
          if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Managed executable escapes its installation.')
          const digest = (await packageChecks.mcpFileDigest(entry, 64 * 1024 * 1024, signal)).digest
          if (digest !== config.managed.entryDigest) throw new Error('Managed executable changed after installation.')
          managedRoot = root
        } catch { unavailable.push(name); continue }
      }
      const values: Record<string, string> = {}
      const revealed: string[] = []
      try {
        for (const pair of config.values) {
          signal?.throwIfAborted()
          if (pair.secret && pair.sealed) {
            values[pair.name] = await this.#secrets.reveal(pair.sealed, purpose)
            signal?.throwIfAborted()
            revealed.push(values[pair.name]!)
          } else {
            values[pair.name] = pair.value ?? ''
          }
        }
      } catch {
        signal?.throwIfAborted()
        unavailable.push(name)
        continue
      }
      secrets.push(...revealed)
      if (managedRoot) managedRoots.push(managedRoot)
      revisions[name] = { revision: configRevision(config, row!.enabled), reviewTools: config.reviewTools === true }
      if (config.transport === 'stdio' && config.command) {
        servers.push({ transport: 'stdio', name, command: config.command, args: config.args, env: values })
      } else if (config.transport === 'http' && config.url) {
        servers.push({ transport: 'http', name, url: config.url, headers: values })
      }
    }
    return { servers, secrets, unavailable, managedRoots, revisions }
  }

  async #row(name: string): Promise<Row | null> {
    const [row] = await this.#db.select().from(schema.agentMcpServers).where(eq(schema.agentMcpServers.name, name))
    return row ?? null
  }
}
