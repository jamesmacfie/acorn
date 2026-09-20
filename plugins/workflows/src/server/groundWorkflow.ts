// Reading the answer to the prompt next door (docs/workflows.md § Authoring): strip the fence, find
// the object, parse it, and ground it against the catalog this node really has.
//
// Pure, like ./generateWorkflow.ts and for the same reason: the contract with the model is the
// product, so it has to be table-testable with no provider and no database.
//
// The order is fixed. Strip, extract, parse, ground, and only then validate. Grounding runs before
// the checker so the repair pass sees the problems of the definition we would actually apply.
//
// Grounding touches three things and nothing else: an identifier the catalog can refute, a key
// outside the vocabulary of the four types, and a reference token that cannot resolve. A decide with
// no branches, a widened budget, a duplicate step ID and a cycle are all left where they are. The
// checker already says something better about each of them than this file could invent, and the
// repair pass sends those messages back verbatim (./workflowValidation.ts).
//
// Nothing here deletes a step. An invented kind becomes an agent step rather than a hole, because a
// deletion cascades through every `after` and `branches` target that names it. The one exception
// is an array entry that is not a step at all, which is dropped while parsing, before any name can
// point at it.
//
// One false positive is known and accepted. A contributed kind's `with` is checked against the
// fields its description lists, and `http:request` leaves `auth` and `vars` out of those fields on
// purpose, because neither is a field a form can draw. So a generated step that writes `with.auth`
// loses it and gets a note. The alternative is to check no `with` key at all, and an unknown `with`
// key is the one mistake that passes every validator and every handler in silence, which is the
// class this file exists for.
import type { WorkflowGenerateNote, WorkflowGenerateNoteCode } from '../shared/api'
import type {
  WorkflowCatalog,
  WorkflowDef,
  WorkflowInput,
  WorkflowStepDef,
} from '../shared/workflowContracts'
import { FORBIDDEN_KEYS } from './generateWorkflow'
import { groundWorkflowDispatch } from './groundWorkflowDispatch'
import { workflowEdges } from './workflowValidation'

export type GroundedWorkflow = { def: WorkflowDef; notes: WorkflowGenerateNote[] }

/** A definition to ground, or the reason there is nothing to apply. */
export type ParsedWorkflow = GroundedWorkflow | { error: string }

/** The keys each of the four types has, straight off ../shared/workflowContracts.ts. Anything else a
 *  model writes is a key acorn never reads, so it is dropped rather than carried around looking
 *  meaningful. The forbidden ones stay in these lists and are caught by the set below, so this
 *  reads as the type it mirrors. */
const DEF_KEYS = ['maxDescendants', 'maxConcurrency', 'formatVersion', 'name', 'posture', 'trigger', 'tools', 'budget', 'inputs', 'outputs', 'steps']
const STEP_KEYS = [
  'id', 'name', 'kind', 'after', 'isolation', 'inputs', 'configOptions', 'profileId', 'model', 'prompt',
  'schema', 'policy', 'maxIterations', 'requiresRun', 'childWorkflow', 'items', 'itemKey',
  'title', 'branches', 'with', 'tools', 'budget',
]
const INPUT_KEYS = ['name', 'label', 'schema', 'description', 'required', 'default']

/** The keys the prompt forbids, read from the prompt's own list so the two cannot drift. The nested
 *  ones are split off below, because a key list is checked against the keys of one record. */
const FORBIDDEN_TOP_KEYS = new Set<string>(FORBIDDEN_KEYS.filter((key) => !key.includes('.')))

/** The forbidden keys that sit inside a `tools` ceiling, off the same list. That is `allow` and
 *  nothing else, and reading it from the list rather than writing it out here is what stops a sixth
 *  forbidden key being added in one file and missed in this one. */
const FORBIDDEN_TOOL_KEYS = FORBIDDEN_KEYS.filter((key) => key.startsWith('tools.')).map((key) => key.slice('tools.'.length))

// The same tokens the checker matches, so grounding removes exactly what it would refuse.
const STEP_TOKEN_RE = /\$\{steps\.[^}]*\}/g
const INPUT_TOKEN_RE = /\$\{inputs\.[^}]*\}/g
const STEP_REFERENCE_RE = /^\$\{steps\.([^}]+)\.output\}$/
const INPUT_REFERENCE_RE = /^\$\{inputs\.([^}]+)\}$/

/** How many objects to try before giving up on a reply. A preamble mentioning `${inputs.issue}`
 *  holds a balanced pair of braces, so the first object a brace count finds is not always the
 *  definition. */
const MAX_OBJECT_CANDIDATES = 8

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const without = <T extends object>(record: T, key: string): T =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key)) as T

// --- strip ---

/** The fenced block a model writes when it was told not to.
 *
 *  Anchored at the start of the reply rather than matched anywhere in it, because a prompt inside
 *  the definition may well hold three backticks of its own, and a greedy match would cut the answer
 *  in half. Prose around a fence is left for the brace count below. */
export function stripJsonFences(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return text
  const firstBreak = trimmed.indexOf('\n')
  if (firstBreak < 0) return text
  const body = trimmed.slice(firstBreak + 1)
  const closing = body.lastIndexOf('```')
  return closing < 0 ? body : body.slice(0, closing)
}

// --- extract ---

/** The first balanced JSON object in a reply, or nothing.
 *
 *  It counts braces while skipping string literals and their escapes, which is the whole point:
 *  every prompt in a definition is a long string, and `${steps.x.output}` puts a closing brace in
 *  most of them. A count that does not know it is inside a string ends the object at the first
 *  prompt. */
export function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let at = start; at < text.length; at += 1) {
    const char = text[at]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, at + 1)
    }
  }
  return undefined
}

// --- parse ---

/** The whole reply if it is already JSON, otherwise the first object in it that parses. */
function readJson(text: string): unknown {
  try {
    return JSON.parse(text.trim())
  } catch {
    // The usual case: the model wrote a sentence in front of the object, or a fence around it.
  }
  let rest = text
  for (let attempt = 0; attempt < MAX_OBJECT_CANDIDATES; attempt += 1) {
    const candidate = extractJsonObject(rest)
    if (candidate === undefined) return undefined
    try {
      return JSON.parse(candidate)
    } catch {
      rest = rest.slice(rest.indexOf('{') + 1)
    }
  }
  return undefined
}

/**
 * The definition the model wrote, or the reason there is none.
 *
 * Four things are errors, because none of them leaves anything to apply: a reply that is not JSON,
 * one that is not an object, a workflow with no name, and a workflow with no steps. Everything else
 * is a note, including an array entry that is not a step, which is dropped here rather than in
 * grounding: no reference can name it, so nothing cascades.
 */
export function parseGeneratedWorkflow(text: string): ParsedWorkflow {
  const parsed = readJson(stripJsonFences(text))
  if (parsed === undefined) return { error: 'The model did not answer with JSON.' }
  if (!isRecord(parsed)) return { error: "The model's answer is not a JSON object." }
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) return { error: 'The workflow the model wrote has no name.' }
  const written = parsed.steps
  if (!Array.isArray(written) || !written.length) return { error: 'The workflow the model wrote has no steps.' }

  const notes: WorkflowGenerateNote[] = []
  const steps = written.filter((step, index) => {
    if (!isRecord(step)) {
      notes.push({ code: 'dropped-step', message: `Step ${index + 1} is not a step, so it was dropped.` })
      return false
    }
    if (typeof step.name !== 'string' || !step.name.trim()) {
      notes.push({ code: 'dropped-step', message: `Step ${index + 1} has no name, so it was dropped.` })
      return false
    }
    return true
  })
  if (!steps.length) return { error: 'The workflow the model wrote has no steps.' }
  const def = (steps.length === written.length ? parsed : { ...parsed, steps }) as WorkflowDef
  return { def, notes }
}

// --- ground ---

type Notes = WorkflowGenerateNote[]

const add = (notes: Notes, code: WorkflowGenerateNoteCode, message: string, step?: string): void => {
  notes.push({ code, message, ...(step ? { step } : {}) })
}

/** Keep the keys a type has, and never a forbidden one. Returns the record untouched when every key
 *  belongs, so a clean definition comes out of grounding byte for byte the way it went in. */
function pruneKeys<T extends object>(
  record: T,
  allowed: readonly string[],
  report: (key: string, code: 'unknown-key' | 'forbidden-key') => void,
): T {
  const drop = Object.keys(record).filter((key) => FORBIDDEN_TOP_KEYS.has(key) || !allowed.includes(key))
  if (!drop.length) return record
  for (const key of drop) report(key, FORBIDDEN_TOP_KEYS.has(key) ? 'forbidden-key' : 'unknown-key')
  return Object.fromEntries(Object.entries(record).filter(([key]) => !drop.includes(key))) as T
}

/** A tool ceiling with nothing forbidden left in it, or nothing when that was all it held. */
function pruneCeiling<T extends object>(tools: T | undefined, report: (key: string) => void): T | undefined {
  if (!isRecord(tools)) return tools
  const drop = FORBIDDEN_TOOL_KEYS.filter((key) => key in tools)
  if (!drop.length) return tools
  for (const key of drop) report(key)
  const rest = Object.fromEntries(Object.entries(tools).filter(([key]) => !drop.includes(key))) as T
  return Object.keys(rest).length ? rest : undefined
}

/** A string `with.prompt` moved onto the step, for a step that is about to lose its `with`. */
function hoistPrompt(step: WorkflowStepDef): { step: WorkflowStepDef; hoisted: boolean } {
  const candidate = step.with?.prompt
  const wanted = typeof candidate === 'string' && candidate.trim() && !step.prompt?.trim()
  return wanted ? { step: { ...step, prompt: candidate as string }, hoisted: true } : { step, hoisted: false }
}

type KindEntry = WorkflowCatalog['kinds'][number]

/** The identifiers on one step, against what this node can run. */
function groundStep(step: WorkflowStepDef, catalog: WorkflowCatalog, kinds: Map<string, KindEntry>, notes: Notes): WorkflowStepDef {
  let next = step
  const label = step.name
  const kindId = next.kind == null ? 'agent' : String(next.kind)
  const described = next.kind == null ? kinds.get('agent') : kinds.get(kindId)

  if (next.kind != null && !described) {
    const hoist = hoistPrompt(next)
    next = without(without(hoist.step, 'kind'), 'with')
    const ending = hoist.hoisted ? ' with the prompt from its `with` table' : ''
    add(notes, 'unknown-kind', `Step '${label}' asked for the kind '${kindId}', which this node cannot run, so it is now an ordinary agent step${ending}.`, label)
  } else if (described && described.pluginId === null && next.with !== undefined) {
    // Only a kind that runs an agent has a prompt to hoist into. A `with.prompt` on a gate is text
    // for nobody, and moving it onto the step would leave a key the gate never reads.
    const hoist = described.describe?.runsAgent ? hoistPrompt(next) : { step: next, hoisted: false }
    next = without(hoist.step, 'with')
    const ending = hoist.hoisted ? ', so its prompt moved onto the step and the rest was dropped' : ', so it was dropped'
    add(notes, 'with-on-builtin', `Step '${label}' carried a \`with\` table, which the built-in '${kindId}' kind does not read${ending}.`, label)
  } else if (described && described.pluginId !== null && isRecord(next.with)) {
    const fields = new Set((described.describe?.fields ?? []).map((field) => field.id))
    const drop = fields.size ? Object.keys(next.with).filter((key) => !fields.has(key)) : []
    for (const key of drop) {
      add(notes, 'unknown-with-key', `Step '${label}' set '${key}' inside \`with\`, which the '${kindId}' kind does not take, so it was dropped.`, label)
    }
    if (drop.length) {
      const table = Object.fromEntries(Object.entries(next.with).filter(([key]) => !drop.includes(key)))
      next = Object.keys(table).length ? { ...next, with: table } : without(next, 'with')
    }
  }

  if (typeof next.policy === 'string' && !catalog.policies.some((policy) => policy.id === next.policy)) {
    const offered = catalog.policies.length
      ? `This node has: ${catalog.policies.map((policy) => policy.id).join(', ')}.`
      : 'This node has no policies at all.'
    add(notes, 'unknown-policy', `Step '${label}' named the policy '${next.policy}', which this node does not have, so the step has no policy. ${offered}`, label)
    next = without(next, 'policy')
  }

  const knownProfile = (id: unknown): boolean => catalog.profiles.some((profile) => profile.id === id)
  if (typeof next.profileId === 'string' && !knownProfile(next.profileId)) {
    add(notes, 'unknown-profile', `Step '${label}' named the profile '${next.profileId}', which this node does not have, so the step runs on the default.`, label)
    next = without(next, 'profileId')
  }
  if (next.schema !== undefined && !isRecord(next.schema)) {
    add(notes, 'dropped-schema', `Step '${label}' set a schema that is not a JSON object, so it was dropped.`, label)
    next = without(next, 'schema')
  }
  return next
}

/** Every key acorn does not read, on all four types, plus the five the prompt forbids.
 *
 *  Two of the checks here are about the shape of a value rather than the name of a key, and both are
 *  there because the checker walks the value and would throw: a non-list `inputs` and a non-list
 *  `after` are as unreadable as a key that does not belong. */
function groundKeys(def: WorkflowDef, notes: Notes): WorkflowDef {
  let next = pruneKeys(def, DEF_KEYS, (key, code) => {
    const why = code === 'forbidden-key' ? 'which a generated workflow cannot set' : 'which is not part of a workflow'
    add(notes, code, `The workflow set '${key}', ${why}, so it was dropped.`)
  })

  const ceiling = pruneCeiling(next.tools, (key) => {
    add(notes, 'forbidden-key', `The workflow set \`tools.${key}\`, which a generated workflow cannot set, so it was dropped.`)
  })
  if (ceiling !== next.tools) next = ceiling ? { ...next, tools: ceiling } : without(next, 'tools')

  if (next.inputs !== undefined && !Array.isArray(next.inputs)) {
    add(notes, 'unknown-key', 'The workflow set `inputs` to something that is not a list, so it was dropped.')
    next = without(next, 'inputs')
  } else if (next.inputs?.length) {
    const inputs = next.inputs.map((input) => (isRecord(input)
      ? pruneKeys(input as WorkflowInput, INPUT_KEYS, (key, code) => {
        const why = code === 'forbidden-key' ? 'which a generated workflow cannot set' : 'which is not part of an input'
        add(notes, code, `Input '${String(input.name ?? '')}' set '${key}', ${why}, so it was dropped.`)
      })
      : input))
    if (inputs.some((input, index) => input !== next.inputs?.[index])) next = { ...next, inputs }
  }

  const steps = next.steps.map((step) => {
    let ahead = pruneKeys(step, STEP_KEYS, (key, code) => {
      const why = code === 'forbidden-key' ? 'which a generated workflow cannot set' : 'which is not part of a step'
      add(notes, code, `Step '${step.name}' set '${key}', ${why}, so it was dropped.`, step.name)
    })
    if (ahead.after !== undefined && !Array.isArray(ahead.after)) {
      add(notes, 'unknown-key', `Step '${step.name}' set \`after\` to something that is not a list, so it was dropped.`, step.name)
      ahead = without(ahead, 'after')
    }
    const stepCeiling = pruneCeiling(ahead.tools, (key) => {
      add(notes, 'forbidden-key', `Step '${step.name}' set \`tools.${key}\`, which a generated workflow cannot set, so it was dropped.`, step.name)
    })
    if (stepCeiling !== ahead.tools) ahead = stepCeiling ? { ...ahead, tools: stepCeiling } : without(ahead, 'tools')

    return ahead
  })
  return steps.some((step, index) => step !== next.steps[index]) ? { ...next, steps } : next
}

/** Every reference that cannot resolve, in the three places a reference works.
 *
 *  The two halves are deliberately asymmetric. A reference to a real step this one does not wait for
 *  adds the edge, because that is what the model meant and what the checker would demand. A
 *  reference to a step that does not exist loses the token, because a step cannot be conjured from a
 *  sentence, while an input declaration is recoverable from a reference in full. */
function groundReferences(def: WorkflowDef, notes: Notes): WorkflowDef {
  if (def.formatVersion === 2) return def // Keep invalid references visible for the validation/repair pass.
  const steps = [...def.steps]
  const names = new Set(steps.map((step) => step.name))
  const declared = new Set((def.inputs ?? []).map((input) => input?.name).filter((name): name is string => typeof name === 'string'))
  const fresh: WorkflowInput[] = []

  const precedes = (candidate: string, target: string): boolean => {
    const edges = workflowEdges(steps)
    const seen = new Set<string>()
    const stack = [...(edges.get(target) ?? [])]
    while (stack.length) {
      const current = stack.pop()!
      if (current === candidate) return true
      if (seen.has(current)) continue
      seen.add(current)
      stack.push(...(edges.get(current) ?? []))
    }
    return false
  }

  const addEdge = (target: string, parent: string): void => {
    const index = steps.findIndex((step) => step.name === target)
    if (index < 0) return
    const after = [...(workflowEdges(steps).get(target) ?? [])]
    steps[index] = { ...steps[index]!, after: [...after, parent] }
  }

  const rewrite = (owner: string, text: string): string => {
    let out = text
    for (const token of new Set(text.match(STEP_TOKEN_RE) ?? [])) {
      const reference = STEP_REFERENCE_RE.exec(token)?.[1]
      if (reference === undefined) {
        add(notes, 'malformed-reference', `Step '${owner}' wrote '${token}', which is not a reference acorn reads, so it was removed.`, owner)
      } else if (!names.has(reference)) {
        add(notes, 'unknown-step-reference', `Step '${owner}' referenced the step '${reference}', which is not in this workflow, so the reference was removed.`, owner)
      } else if (precedes(reference, owner)) continue
      else if (reference !== owner && !precedes(owner, reference)) {
        addEdge(owner, reference)
        add(notes, 'added-edge', `Step '${owner}' referenced '${reference}' without waiting for it, so it now waits for '${reference}'.`, owner)
        continue
      } else {
        add(notes, 'cyclic-reference', `Step '${owner}' referenced '${reference}', which cannot run before it, so the reference was removed.`, owner)
      }
      out = out.split(token).join('')
    }
    for (const token of new Set(out.match(INPUT_TOKEN_RE) ?? [])) {
      const reference = INPUT_REFERENCE_RE.exec(token)?.[1]
      if (reference === undefined) {
        add(notes, 'malformed-reference', `Step '${owner}' wrote '${token}', which is not a reference acorn reads, so it was removed.`, owner)
        out = out.split(token).join('')
        continue
      }
      if (declared.has(reference)) continue
      declared.add(reference)
      fresh.push({ name: reference })
      add(notes, 'declared-input', `Step '${owner}' referenced the input '${reference}', which nothing declared, so the workflow now asks for it.`, owner)
    }
    return out
  }

  for (let index = 0; index < steps.length; index += 1) {
    const before = steps[index]!
    const owner = before.name
    const prompt = typeof before.prompt === 'string' ? rewrite(owner, before.prompt) : undefined
    const table = isRecord(before.with)
      ? Object.fromEntries(Object.entries(before.with).map(([key, value]) => [key, typeof value === 'string' ? rewrite(owner, value) : value]))
      : undefined
    // Read the step back: rewriting may have given it an edge to a step one of its own references
    // named, and that write must not be lost under the rewritten strings.
    let next = steps[index]!
    if (prompt !== undefined && prompt !== next.prompt) next = { ...next, prompt }
    if (table && Object.entries(table).some(([key, value]) => value !== next.with?.[key])) next = { ...next, with: table }
    steps[index] = next
  }

  const changed = steps.some((step, index) => step !== def.steps[index])
  if (!changed && !fresh.length) return def
  return {
    ...def,
    ...(fresh.length ? { inputs: [...(def.inputs ?? []), ...fresh] } : {}),
    steps,
  }
}

/**
 * The definition as this node can run it, and everything that had to change to get there.
 *
 * Idempotent by construction, which matters because the repair pass grounds a second answer through
 * the same path: grounding a grounded definition produces no second note.
 */
export function groundWorkflow(def: WorkflowDef, catalog: WorkflowCatalog): GroundedWorkflow {
  const notes: Notes = []
  const kinds = new Map(catalog.kinds.map((kind) => [kind.id, kind]))
  // Names first, so every note below names a step by the name the reader will see in the editor,
  // and so the reference pass reads tokens the rename has already rewritten.
  let next = def
  next = groundKeys(next, notes)
  const steps = next.steps.map((step) => groundStep(step, catalog, kinds, notes))
  if (steps.some((step, index) => step !== next.steps[index])) next = { ...next, steps }
  next = groundReferences(next, notes)
  next = groundWorkflowDispatch(next, catalog, notes)
  return { def: next, notes }
}
