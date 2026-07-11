import type { z } from 'zod'
import type { AnyEndpoint, CommandContribution, EventContribution, HttpMethod, PluginApiContribution } from './defineEndpoint'

// The AutomationApiRegistry (docs/public-api.md). Contributions register during
// composition; freeze() returns an immutable snapshot that the app + OpenAPI + conformance tests
// read. Invalid contributions cannot freeze — the invariants in plugin-api.md §3 are enforced here,
// not per-route.

const CORE = 'core'
const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{0,63}$/
const OPERATION_ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/

export type RegistrySnapshot = {
  endpoints: readonly AnyEndpoint[]
  events: readonly EventContribution[]
  commands: readonly CommandContribution[]
  byOperationId: ReadonlyMap<string, AnyEndpoint>
  byCommandId: ReadonlyMap<string, CommandContribution>
}

// Best-effort strictness probe: a public object schema must reject unknown keys. Zod 4 marks a
// strictObject by setting its object `catchall` to a ZodNever. Non-object schemas (unions,
// primitives, arrays) are accepted here — discriminated unions of strict objects are validated by
// convention. ponytail: top-level object strictness only; covered by a registry test so an internal
// Zod change surfaces loudly.
function isStrictOrNonObject(schema: z.ZodTypeAny): boolean {
  const def = (schema as unknown as { _zod?: { def?: { type?: string; catchall?: unknown } } })._zod?.def
  if (!def || def.type !== 'object') return true
  const catchall = def.catchall as { _zod?: { def?: { type?: string } } } | undefined
  return catchall?._zod?.def?.type === 'never'
}

function fullPath(pluginId: string, path: string): string {
  return pluginId === CORE ? path : `/plugins/${pluginId}${path}`
}

export class AutomationApiRegistry {
  private endpoints: AnyEndpoint[] = []
  private events: EventContribution[] = []
  private commands: CommandContribution[] = []
  private frozen: RegistrySnapshot | null = null

  private assertMutable() {
    if (this.frozen) throw new Error('AutomationApiRegistry is frozen; register before freeze()')
  }

  // Register one plugin/core contribution bundle. `expectedOwner` is the id the composition root is
  // activating; a contribution claiming a different pluginId is rejected (no cross-namespace mount).
  registerContribution(contribution: PluginApiContribution, expectedOwner: string): void {
    this.assertMutable()
    const { pluginId } = contribution
    if (pluginId !== expectedOwner) {
      throw new Error(`Contribution pluginId "${pluginId}" does not match activation owner "${expectedOwner}"`)
    }
    if (pluginId !== CORE && !PLUGIN_ID_RE.test(pluginId)) {
      throw new Error(`Invalid pluginId "${pluginId}" (must match ${PLUGIN_ID_RE})`)
    }
    for (const endpoint of contribution.endpoints ?? []) this.addEndpoint(endpoint, pluginId)
    for (const event of contribution.events ?? []) this.addEvent(event, pluginId)
    for (const command of contribution.commands ?? []) this.addCommand(command, pluginId)
  }

  private addCommand(command: CommandContribution, owner: string): void {
    if (command.pluginId !== owner) throw new Error(`Command ${command.id}: pluginId mismatch`)
    const prefix = owner === CORE ? '' : `${owner}.`
    if (owner !== CORE && !command.id.startsWith(prefix)) throw new Error(`Command ${command.id}: must be namespaced "${prefix}*"`)
    if (this.commands.some((c) => c.id === command.id)) throw new Error(`Duplicate command id "${command.id}"`)
    this.commands.push(command)
  }

  registerEndpoint(endpoint: AnyEndpoint): void {
    this.assertMutable()
    this.addEndpoint(endpoint, endpoint.pluginId)
  }

  registerEvent(event: EventContribution): void {
    this.assertMutable()
    this.addEvent(event, event.pluginId)
  }

  private addEndpoint(endpoint: AnyEndpoint, owner: string): void {
    const where = `${endpoint.method} ${endpoint.operationId}`
    if (endpoint.pluginId !== owner) throw new Error(`${where}: endpoint pluginId mismatch`)
    if (!OPERATION_ID_RE.test(endpoint.operationId)) throw new Error(`${where}: invalid operationId`)
    if (owner !== CORE && !endpoint.operationId.startsWith(`${owner}.`)) {
      throw new Error(`${where}: operationId must be namespaced "${owner}.*"`)
    }
    this.assertPath(endpoint, owner)
    if (!endpoint.scope) throw new Error(`${where}: missing scope`)
    if (!endpoint.risk) throw new Error(`${where}: missing risk`)
    if (!endpoint.response) throw new Error(`${where}: missing response schema`)

    // A mutating/execute operation must require write. A read endpoint that can change state or run
    // code is a scope hole (authentication.md §2, §8).
    if (endpoint.risk !== 'read' && endpoint.scope !== 'write') {
      throw new Error(`${where}: ${endpoint.risk}-risk endpoint must declare scope "write"`)
    }

    const bodyBearing = endpoint.method === 'POST' || endpoint.method === 'PUT' || endpoint.method === 'PATCH'
    if (!bodyBearing && endpoint.body) throw new Error(`${where}: ${endpoint.method} must not declare a body schema`)
    if (bodyBearing && !endpoint.body) {
      throw new Error(`${where}: ${endpoint.method} must declare a body schema (use z.undefined() for no body)`)
    }

    for (const [label, schema] of [
      ['params', endpoint.params],
      ['query', endpoint.query],
      ['body', endpoint.body],
      ['response', endpoint.response],
    ] as const) {
      if (schema && !isStrictOrNonObject(schema)) {
        throw new Error(`${where}: ${label} object schema must be strict (no passthrough/unknown keys)`)
      }
    }

    const path = fullPath(owner, endpoint.path)
    const methodPath = `${endpoint.method} ${path}`
    if (this.endpoints.some((e) => e.operationId === endpoint.operationId)) {
      throw new Error(`Duplicate operationId "${endpoint.operationId}"`)
    }
    if (this.endpoints.some((e) => e.method === endpoint.method && fullPath(e.pluginId, e.path) === path)) {
      throw new Error(`Duplicate route "${methodPath}"`)
    }
    this.endpoints.push(endpoint)
  }

  private assertPath(endpoint: AnyEndpoint, owner: string): void {
    const { path } = endpoint
    const where = `${endpoint.method} ${endpoint.operationId}`
    if (!path.startsWith('/')) throw new Error(`${where}: path must start with "/"`)
    if (path.includes('..') || path.includes('//')) throw new Error(`${where}: path must not contain ".." or "//"`)
    if (path.includes('*')) throw new Error(`${where}: path must not contain wildcards`)
    if (/\/v\d+(?:\/|$)/.test(path)) throw new Error(`${where}: path must not contain a version segment`)
    if (owner !== CORE && path.startsWith('/plugins/')) {
      throw new Error(`${where}: plugin path is relative to its namespace; drop the /plugins/<id> prefix`)
    }
  }

  private addEvent(event: EventContribution, owner: string): void {
    if (event.pluginId !== owner) throw new Error(`Event ${event.channel}: pluginId mismatch`)
    const prefix = owner === CORE ? 'core.' : `${owner}.`
    if (!event.channel.startsWith(prefix)) {
      throw new Error(`Event ${event.channel}: channel must be namespaced "${prefix}*"`)
    }
    if (this.events.some((e) => e.channel === event.channel)) {
      throw new Error(`Duplicate event channel "${event.channel}"`)
    }
    this.events.push(event)
  }

  freeze(): RegistrySnapshot {
    if (this.frozen) return this.frozen
    const byOperationId = new Map(this.endpoints.map((e) => [e.operationId, e]))
    const byCommandId = new Map(this.commands.map((c) => [c.id, c]))
    this.frozen = {
      endpoints: Object.freeze([...this.endpoints]),
      events: Object.freeze([...this.events]),
      commands: Object.freeze([...this.commands]),
      byOperationId,
      byCommandId,
    }
    return this.frozen
  }

  get isFrozen(): boolean {
    return this.frozen !== null
  }
}
