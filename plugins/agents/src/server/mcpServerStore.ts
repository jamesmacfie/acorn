// The user's MCP servers, as the settings page edits them and as sessions receive them
// (docs/mcp.md § Your own servers).
//
// One row per server, keyed by name. A secret value is sealed on the way in and revealed only by
// `resolve()`, which runs when a provider starts. Nothing that reads the list, the settings page
// included, ever sees one.
import { asc, eq } from 'drizzle-orm'
import type { PluginDatabase, SecretService } from '@acorn/plugin-api/node'
import * as schema from '../node/schema'
import type { AgentDriverMcpServer } from './drivers/types'
import type { AgentMcpPair, AgentMcpServer, AgentMcpServerInput, AgentMcpTransport } from '../shared/mcpServers'

// Exactly one of `value` and `sealed` is set: `sealed` when the pair is a secret.
type StoredPair = { name: string; secret: boolean; value?: string; sealed?: string }
type StoredConfig = {
  transport: AgentMcpTransport
  command: string | null
  args: string[]
  url: string | null
  values: StoredPair[]
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
    }
  } catch {
    return null
  }
}

function publicServer(row: Row, config: StoredConfig): AgentMcpServer {
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
  }
}

export class AgentMcpServerStore {
  readonly #db: PluginDatabase
  readonly #secrets: SecretService

  constructor(db: PluginDatabase, secrets: SecretService) {
    this.#db = db
    this.#secrets = secrets
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
    }
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
  ): Promise<{ servers: AgentDriverMcpServer[]; secrets: string[]; unavailable: string[] }> {
    const servers: AgentDriverMcpServer[] = []
    const secrets: string[] = []
    const unavailable: string[] = []
    for (const name of names) {
      const row = await this.#row(name)
      const config = row && storedConfig(row)
      if (!config) continue
      const values: Record<string, string> = {}
      const revealed: string[] = []
      try {
        for (const pair of config.values) {
          if (pair.secret && pair.sealed) {
            values[pair.name] = await this.#secrets.reveal(pair.sealed, purpose)
            revealed.push(values[pair.name]!)
          } else {
            values[pair.name] = pair.value ?? ''
          }
        }
      } catch {
        unavailable.push(name)
        continue
      }
      secrets.push(...revealed)
      if (config.transport === 'stdio' && config.command) {
        servers.push({ transport: 'stdio', name, command: config.command, args: config.args, env: values })
      } else if (config.transport === 'http' && config.url) {
        servers.push({ transport: 'http', name, url: config.url, headers: values })
      }
    }
    return { servers, secrets, unavailable }
  }

  async #row(name: string): Promise<Row | null> {
    const [row] = await this.#db.select().from(schema.agentMcpServers).where(eq(schema.agentMcpServers.name, name))
    return row ?? null
  }
}
