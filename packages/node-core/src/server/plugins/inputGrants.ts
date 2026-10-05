import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writePrivateAtomic } from '../storage/dataRoot'

// The person's approval of the sources a loaded plugin's derived sources read. Compiled plugins need
// none, because their code ships with Acorn. A grant covers inputs one by one, so a version that adds
// or changes an input keeps reading the ones the old grant still matches.
// See docs/data-sources/derived-sources.md § Approve inputs for loaded plugins.

export type GrantedInput = { source: string; optional: boolean }
export type InputGrant = {
  pluginId: string
  /** Source id, then input name, exactly as the approved version declared them. */
  sources: Record<string, Record<string, GrantedInput>>
  grantedAt: number
  grantedBy: string
}

export type InputGrantsStore = {
  get(pluginId: string): InputGrant | undefined
  set(grant: InputGrant): void
}

const FILE_NAME = 'input-grants.json'

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const parseGrant = (value: unknown): InputGrant | undefined => {
  if (!record(value) || typeof value.pluginId !== 'string' || !value.pluginId || !record(value.sources)
    || typeof value.grantedAt !== 'number' || typeof value.grantedBy !== 'string') return undefined
  const sources: InputGrant['sources'] = {}
  for (const [sourceId, inputs] of Object.entries(value.sources)) {
    if (!record(inputs)) return undefined
    sources[sourceId] = {}
    for (const [name, input] of Object.entries(inputs)) {
      if (!record(input) || typeof input.source !== 'string' || typeof input.optional !== 'boolean') return undefined
      sources[sourceId][name] = { source: input.source, optional: input.optional }
    }
  }
  return { pluginId: value.pluginId, sources, grantedAt: value.grantedAt, grantedBy: value.grantedBy }
}

// Anything unparseable reads as "no grants", as disabled.ts does. Here that fails closed as well as
// open: the node still boots, and a derived source reads nothing until the person approves again.
const parse = (raw: string): Map<string, InputGrant> => {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return new Map()
    const grants = new Map<string, InputGrant>()
    for (const entry of value) {
      const grant = parseGrant(entry)
      if (grant) grants.set(grant.pluginId, grant)
    }
    return grants
  } catch {
    return new Map()
  }
}

export function inputGrantsStore(dataDir: string): InputGrantsStore {
  const file = join(dataDir, FILE_NAME)
  let current = new Map<string, InputGrant>()
  try {
    current = parse(readFileSync(file, 'utf8'))
    chmodSync(file, 0o600)
  } catch {
    current = new Map()
  }
  return {
    get: (pluginId) => current.get(pluginId),
    set(grant) {
      const next = new Map(current).set(grant.pluginId, grant)
      mkdirSync(dataDir, { recursive: true, mode: 0o700 })
      writePrivateAtomic(file, `${JSON.stringify([...next.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId)))}\n`)
      current = next
    },
  }
}

/** True when the grant approved this input with the same source and the same optional flag. */
export function grantCoversInput(grant: InputGrant | undefined, sourceId: string, name: string, input: { source: string; optional?: boolean }): boolean {
  const granted = grant?.sources[sourceId]?.[name]
  return !!granted && granted.source === input.source && granted.optional === !!input.optional
}
