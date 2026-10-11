// What an agent may read of a definition, and what it may not write back
// (docs/agent-tools/workflow-tools.md § Projections).
//
// Two kinds of value stay on the Node. Protected configuration is the execution target and credential
// set AI authoring hides too (../authoring/edit.ts): a trigger, a tool allowlist, a run target, and a
// contributed kind's `headers` and `auth`. Provider choices are not on that list here, because a
// harness, model, or reasoning setting is ordinary draft content the owner reviews before
// publication. The second kind is private: a root input's default value, which list results already
// hide, any string under a credential-like key such as `token` or `password`, and any other string the
// shared secret detector flags. An agent may write its own private values, but not protected ones.
//
// Withheld values are omitted rather than replaced with a marker, so no marker can come back as an
// executable value. A draft based on a source gets them back by stable step ID and kind.
import { scanSecretText } from '@acorn/plugin-api/node'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { SCRUBBED_WITH_KEYS } from '../authoring/edit'

export type WithheldField = { path: string; reason: 'protected' | 'input-default' | 'likely-secret' }

type Json = Record<string, unknown>
// A key within an object, or an item within a named list, found by its `id` or `name`. Positions in
// a list are never addresses, because a draft that reorders steps would restore a value onto the
// wrong one.
type Segment = { key: string } | { item: string; kind?: string }
type Located = { segments: Segment[]; reason: WithheldField['reason'] }

const ROOT_PROTECTED = [['trigger'], ['tools', 'allow']]
const STEP_PROTECTED = [['requiresRun'], ['tools', 'allow'], ...SCRUBBED_WITH_KEYS.map((key) => ['with', key])]

// A key whose string value is a credential whether or not the detector recognises its shape. Matched at
// the end of the key, so `maxInputTokens` and other counts stay readable.
const CREDENTIAL_KEY = /(secret|token|passw(or)?d|api[-_]?key|private[-_]?key|authorization|cookie|credentials?)$/i

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value)

// Steps carry their kind in the identity, as the AI authoring restore does: changing a step's kind
// is a structural edit, and the old kind's configuration must not ride onto the new one.
const itemIdentity = (value: unknown, steps: boolean): Segment | null => {
  if (!isObject(value)) return null
  const name = typeof value.id === 'string' ? value.id : typeof value.name === 'string' ? value.name : null
  if (!name) return null
  return steps ? { item: name, kind: typeof value.kind === 'string' ? value.kind : 'agent' } : { item: name }
}

// Only a step's segment carries a kind, so the segment says which identity rule to compare with.
const sameItem = (segment: Extract<Segment, { item: string }>, value: unknown): boolean => {
  const identity = itemIdentity(value, segment.kind !== undefined)
  return !!identity && 'item' in identity && identity.item === segment.item && identity.kind === segment.kind
}

const label = (segments: readonly Segment[]): string =>
  segments
    .map((segment, index) => ('key' in segment ? `${index ? '.' : ''}${segment.key}` : `[${segment.item}]`))
    .join('')

function child(current: unknown, segment: Segment): unknown {
  if ('key' in segment) return isObject(current) ? current[segment.key] : undefined
  if (!Array.isArray(current)) return undefined
  const matches = current.filter((value) => sameItem(segment, value))
  // Duplicate identities are an invalid draft, not two places to restore a value into.
  return matches.length === 1 ? matches[0] : undefined
}

const read = (root: unknown, segments: readonly Segment[]): unknown => segments.reduce<unknown>(child, root)

/** Sets a value the draft does not already have. A missing table on the way is created, so a `with`
 *  emptied by protection gets its `auth` back, but a missing list item is never invented. */
function restore(root: Json, segments: readonly Segment[], value: unknown): void {
  let current: unknown = root
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index]!
    let next = child(current, segment)
    if (next === undefined && 'key' in segment && isObject(current) && 'key' in segments[index + 1]!) {
      next = current[segment.key] = {}
    }
    current = next
  }
  const last = segments.at(-1)!
  if (isObject(current) && 'key' in last && current[last.key] === undefined) current[last.key] = structuredClone(value)
}

function remove(root: Json, path: readonly string[]): boolean {
  let parent: unknown = root
  for (const key of path.slice(0, -1)) parent = isObject(parent) ? parent[key] : undefined
  const last = path.at(-1)!
  if (!isObject(parent) || !Object.hasOwn(parent, last)) return false
  // The file loader writes absent fields as undefined. That is not a value anybody withheld.
  const present = parent[last] !== undefined
  delete parent[last]
  if (!present) return false
  // An emptied `tools` or `with` would read as "configured with nothing", which is a different value.
  if (path.length > 1 && !Object.keys(parent).length) remove(root, path.slice(0, -1))
  return true
}

const flagged = (text: string): boolean => scanSecretText(text, 'workflow').length > 0

/** Drops every object property whose value contains a flagged string. A list is withheld whole unless
 *  its items are named, because a position is not an address a restore can trust. */
function scrub(value: unknown, segments: Segment[], found: Located[]): unknown {
  if (Array.isArray(value)) {
    const steps = segments.length === 1 && 'key' in segments[0]! && segments[0].key === 'steps'
    return value.map((item) => {
      const identity = itemIdentity(item, steps)
      return identity ? scrub(item, [...segments, identity], found) : item
    })
  }
  if (!isObject(value)) return value
  const out: Json = {}
  for (const [key, item] of Object.entries(value)) {
    const path = [...segments, { key }]
    const unnamedList = Array.isArray(item) && item.some((entry) => !itemIdentity(entry, false))
    if (typeof item === 'string' || unnamedList) {
      if (typeof item === 'string' ? CREDENTIAL_KEY.test(key) || flagged(item) : flagged(JSON.stringify(item))) {
        found.push({ segments: path, reason: 'likely-secret' })
        continue
      }
      out[key] = item
      continue
    }
    out[key] = scrub(item, path, found)
  }
  return out
}

function protectedFields(def: Json, found: Located[]): Json {
  for (const path of ROOT_PROTECTED) {
    if (remove(def, path)) found.push({ segments: path.map((key) => ({ key })), reason: 'protected' })
  }
  const steps = Array.isArray(def.steps) ? def.steps : []
  for (const step of steps) {
    const identity = itemIdentity(step, true)
    if (!identity || !isObject(step)) continue
    for (const path of STEP_PROTECTED) {
      if (remove(step, path))
        found.push({ segments: [{ key: 'steps' }, identity, ...path.map((key) => ({ key }))], reason: 'protected' })
    }
  }
  return def
}

// The loader's own bookkeeping on a file definition. Neither is part of the definition.
const withoutLoaderKeys = (def: WorkflowDef): Json => {
  const { id: _id, source: _source, ...rest } = def as WorkflowDef & { id?: unknown; source?: unknown }
  return structuredClone(rest) as Json
}

/** Drops each root input's default value. The input's contract stays readable. */
function inputDefaults(def: Json, found: Located[]): Json {
  for (const input of Array.isArray(def.inputs) ? def.inputs : []) {
    const identity = itemIdentity(input, false)
    if (!identity || !isObject(input) || input.default === undefined) continue
    delete input.default
    found.push({ segments: [{ key: 'inputs' }, identity, { key: 'default' }], reason: 'input-default' })
  }
  return def
}

function located(def: WorkflowDef): { definition: Json; found: Located[] } {
  const found: Located[] = []
  const definition = scrub(inputDefaults(protectedFields(withoutLoaderKeys(def), found), found), [], found) as Json
  return { definition, found }
}

/** A definition as an agent tool returns it, with the paths of everything left out. */
export function agentDefinitionView(def: WorkflowDef): { definition: WorkflowDef; withheld: WithheldField[] } {
  const { definition, found } = located(def)
  return {
    definition: definition as unknown as WorkflowDef,
    withheld: found.map(({ segments, reason }) => ({ path: label(segments), reason })),
  }
}

/** An agent's definition made safe to save. Protected fields it sent are dropped, because an agent may
 *  not author them. When the draft has a source, every value the agent could not read and did not
 *  replace is copied back from the source by step ID and kind. A step the source does not have gets
 *  nothing, so a new step that needs owner configuration stays incomplete until the owner adds it. */
export function agentDraftDefinition(incoming: WorkflowDef, source: WorkflowDef | null): WorkflowDef {
  const next = protectedFields(withoutLoaderKeys(incoming), [])
  if (!source) return next as unknown as WorkflowDef
  const original = withoutLoaderKeys(source)
  for (const { segments } of located(source).found) restore(next, segments, read(original, segments))
  return next as unknown as WorkflowDef
}
