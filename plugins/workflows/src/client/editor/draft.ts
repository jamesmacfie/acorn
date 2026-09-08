// The editor's draft: a definition, a selection, and the operations that change them
// (docs/workflows.md § Authoring).
//
// Pure, and deliberately so. Every rule that makes the editor pleasant — a rename that rewrites its
// own references, a delete that never bridges, a connect that refuses a cycle — is a function from a
// draft to a draft, testable without a component. The store beside this one owns the undo window, the
// server calls and the reactivity (./draftStore.ts).
//
// Drafts are immutable. An operation returns a new object or the one it was given, which is what makes
// undo an array of drafts and lets the kit's `Rows` reconcile instead of remounting.
import type {
  StepField,
  WorkflowDef,
  WorkflowInput,
  WorkflowStepDef,
} from '../../shared/workflowContracts'
import { fieldHome, readStepField } from '../../shared/stepFields'

/** What the inspector is showing. "Definition" and "Inputs" are rows in the list too, so the
 *  selection is not always a node. */
export type DraftSelection =
  | { kind: 'definition' }
  | { kind: 'inputs' }
  | { kind: 'node'; name: string }

export type WorkflowDraft = {
  def: WorkflowDef
  selection: DraftSelection
}

export const DEFINITION_ROW = 'definition'
export const INPUTS_ROW = 'inputs'

/** A step name is slug-shaped and unique. The `:` a sub-workflow expansion carries is not typed here,
 *  so the editor's rule is the narrower one. */
export const STEP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
export const INPUT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/

export const newDraft = (def: WorkflowDef): WorkflowDraft => ({ def, selection: { kind: 'definition' } })

export const emptyDefinition = (name = 'Untitled workflow'): WorkflowDef => ({ name, steps: [] })

const stepAt = (def: WorkflowDef, name: string): WorkflowStepDef | undefined =>
  def.steps.find((step) => step.name === name)

/** The steps one waits on, with the "absent means the step declared before it" rule applied. The
 *  runner reads `after` the same way (../../server/workflowValidation.ts), so the picture the editor
 *  draws is the graph that runs. */
export function effectiveAfter(def: WorkflowDef, index: number): readonly string[] {
  const step = def.steps[index]
  if (!step) return []
  if (step.after) return step.after
  const previous = def.steps[index - 1]
  return previous ? [previous.name] : []
}

/** Every step's incoming edges, by name. */
export function edges(def: WorkflowDef): Map<string, readonly string[]> {
  return new Map(def.steps.map((step, index) => [step.name, effectiveAfter(def, index)]))
}

/** Is `candidate` on some path back from `step`? The cycle check and the reference check both ask it. */
export function precedes(def: WorkflowDef, candidate: string, step: string): boolean {
  const graph = edges(def)
  const seen = new Set<string>()
  const walk = (name: string): boolean => {
    for (const parent of graph.get(name) ?? []) {
      if (parent === candidate) return true
      if (seen.has(parent)) continue
      seen.add(parent)
      if (walk(parent)) return true
    }
    return false
  }
  return walk(step)
}

/** One row of the list column: the graph in reading order, indented by rank.
 *
 *  Roots come first in declaration order and every other node lands after the last of its
 *  predecessors, which is what puts a chain under the step that starts it rather than at the bottom.
 *  A node waiting on more than one step carries `parents` so the row can say so. */
export type GraphRow = { name: string; depth: number; parents: readonly string[] }

const MAX_DEPTH = 4

export function graphOrder(def: WorkflowDef): GraphRow[] {
  const graph = edges(def)
  const declared = new Map(def.steps.map((step, index) => [step.name, index]))
  const waiting = new Set(def.steps.map((step) => step.name))
  const placedAt = new Map<string, number>()
  const rank = new Map<string, number>()
  const rows: GraphRow[] = []

  const row = (name: string): GraphRow => {
    const parents = (graph.get(name) ?? []).filter((parent) => declared.has(parent))
    const depth = parents.length ? Math.min(MAX_DEPTH, 1 + Math.max(...parents.map((parent) => rank.get(parent) ?? 0))) : 0
    rank.set(name, depth)
    placedAt.set(name, rows.length)
    waiting.delete(name)
    return { name, depth, parents }
  }

  while (waiting.size) {
    const ready = [...waiting].filter((name) => (graph.get(name) ?? []).every((parent) => !waiting.has(parent)))
    // Nothing ready means a cycle. The footer names it; the list still has to draw every node, so the
    // rest go out in declaration order rather than vanishing.
    if (!ready.length) {
      for (const name of [...waiting].sort((a, b) => (declared.get(a) ?? 0) - (declared.get(b) ?? 0))) rows.push(row(name))
      break
    }
    const key = (name: string): [number, number] => {
      const parents = (graph.get(name) ?? []).filter((parent) => placedAt.has(parent))
      return [parents.length ? Math.max(...parents.map((parent) => placedAt.get(parent) ?? -1)) : -1, declared.get(name) ?? 0]
    }
    const next = ready.sort((a, b) => {
      const [aLast, aDecl] = key(a)
      const [bLast, bDecl] = key(b)
      return bLast - aLast || aDecl - bDecl
    })[0]
    rows.push(row(next))
  }
  return rows
}

/** A name nothing else has yet, from a base a person did not type. */
export function uniqueStepName(def: WorkflowDef, base: string): string {
  const taken = new Set(def.steps.map((step) => step.name))
  const root = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'step'
  if (!taken.has(root)) return root
  for (let n = 2; ; n += 1) if (!taken.has(`${root}-${n}`)) return `${root}-${n}`
}

const withSteps = (draft: WorkflowDraft, steps: WorkflowStepDef[]): WorkflowDraft =>
  ({ ...draft, def: { ...draft.def, steps } })

const patchStep = (draft: WorkflowDraft, name: string, patch: (step: WorkflowStepDef) => WorkflowStepDef): WorkflowDraft =>
  withSteps(draft, draft.def.steps.map((step) => (step.name === name ? patch(step) : step)))

export const select = (draft: WorkflowDraft, selection: DraftSelection): WorkflowDraft =>
  ({ ...draft, selection })

/**
 * A new node, after the selection or as a root.
 *
 * Never inserted between two nodes: a node the editor added takes one edge from the node that was
 * selected and nothing downstream moves. That is proliferate's rule and it is why adding a step never
 * changes what an existing step waits on.
 */
export function addNode(draft: WorkflowDraft, kind: string, base?: string): WorkflowDraft {
  const name = uniqueStepName(draft.def, base ?? kind.replace(/^.*:/, ''))
  const parent = draft.selection.kind === 'node' ? draft.selection.name : undefined
  // Every step the editor writes carries an explicit `after`, so a node added at the end of a list
  // written by hand does not silently inherit the step above it.
  const explicit = draft.def.steps.map((step, index) => (step.after ? step : { ...step, after: [...effectiveAfter(draft.def, index)] }))
  const step: WorkflowStepDef = { name, ...(kind === 'agent' ? {} : { kind }), after: parent ? [parent] : [] }
  return { def: { ...draft.def, steps: [...explicit, step] }, selection: { kind: 'node', name } }
}

/** Delete, detaching every edge that touched it. The predecessor is never bridged to the successor:
 *  a chain that loses its middle becomes two roots, which is visible, rather than a new edge nobody
 *  drew. */
export function removeNode(draft: WorkflowDraft, name: string): WorkflowDraft {
  if (!stepAt(draft.def, name)) return draft
  const explicit = draft.def.steps.map((step, index) => ({ ...step, after: [...effectiveAfter(draft.def, index)] }))
  const steps = explicit
    .filter((step) => step.name !== name)
    .map((step) => ({ ...step, after: step.after.filter((parent) => parent !== name) }))
  const selection: DraftSelection = draft.selection.kind === 'node' && draft.selection.name === name
    ? { kind: 'definition' }
    : draft.selection
  return { def: { ...draft.def, steps }, selection }
}

const RENAME_LIMIT = 200

/** Rewrite `${steps.<old>.output}` wherever a reference may appear. One level into `with`, which is
 *  as deep as the runner renders. */
function rewriteReferences(value: unknown, from: string, to: string, depth = 0): unknown {
  if (typeof value === 'string') return value.split(`\${steps.${from}.output}`).join(`\${steps.${to}.output}`)
  if (depth > 1 || !value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((entry) => rewriteReferences(entry, from, to, depth + 1))
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, rewriteReferences(entry, from, to, depth + 1)]))
}

/** Why this rename cannot happen, or nothing. */
export function renameProblem(def: WorkflowDef, from: string, to: string): string | undefined {
  if (to === from) return undefined
  if (!STEP_NAME_RE.test(to)) return 'A step name is letters, numbers, dashes and underscores.'
  if (to.length > RENAME_LIMIT) return 'That name is too long.'
  if (def.steps.some((step) => step.name === to)) return `Another step is already called '${to}'.`
  return undefined
}

/** The identity stays the name, so a rename is a rewrite: every `after` entry, every branch target,
 *  every `joins`, and every `${steps.old.output}` in a prompt or a `with` value
 *  (docs/workflows.md § Authoring). Draft-only until the draft is saved. */
export function renameNode(draft: WorkflowDraft, from: string, to: string): WorkflowDraft {
  if (to === from || renameProblem(draft.def, from, to)) return draft
  const steps = draft.def.steps.map((step, index) => {
    const after = [...effectiveAfter(draft.def, index)].map((parent) => (parent === from ? to : parent))
    const next: WorkflowStepDef = { ...step, after, name: step.name === from ? to : step.name }
    if (next.prompt) next.prompt = rewriteReferences(next.prompt, from, to) as string
    if (next.with) next.with = rewriteReferences(next.with, from, to) as Record<string, unknown>
    if (next.joins === from) next.joins = to
    if (next.childStep?.prompt) next.childStep = { ...next.childStep, prompt: rewriteReferences(next.childStep.prompt, from, to) as string }
    if (next.branches) {
      next.branches = Object.fromEntries(Object.entries(next.branches).map(([verdict, target]) => [verdict, target === from ? to : target]))
    }
    return next
  })
  const selection: DraftSelection = draft.selection.kind === 'node' && draft.selection.name === from
    ? { kind: 'node', name: to }
    : draft.selection
  return { def: { ...draft.def, steps }, selection }
}

/** Would this edge be accepted? The `Waits on` picker asks it of every node, so a node it cannot
 *  offer is a node it never draws. */
export function canConnect(def: WorkflowDef, from: string, to: string): boolean {
  if (from === to) return false
  if (!stepAt(def, from) || !stepAt(def, to)) return false
  const index = def.steps.findIndex((step) => step.name === to)
  if (effectiveAfter(def, index).includes(from)) return false
  // A cycle: `to` already runs before `from`, so making `from` a predecessor closes the loop.
  return !precedes(def, to, from)
}

/** `to` waits on `from`. */
export function connect(draft: WorkflowDraft, from: string, to: string): WorkflowDraft {
  if (!canConnect(draft.def, from, to)) return draft
  const index = draft.def.steps.findIndex((step) => step.name === to)
  const after = [...effectiveAfter(draft.def, index), from]
  return patchStep(draft, to, (step) => ({ ...step, after }))
}

export function disconnect(draft: WorkflowDraft, from: string, to: string): WorkflowDraft {
  const index = draft.def.steps.findIndex((step) => step.name === to)
  if (index < 0) return draft
  const after = effectiveAfter(draft.def, index).filter((parent) => parent !== from)
  return patchStep(draft, to, (step) => ({ ...step, after: [...after] }))
}

/** One field's value, on the step or in `with`, as ../../shared/stepFields.ts says. An empty value
 *  removes the key: "not set" and "set to nothing" are the same state in a definition. */
export function setField(draft: WorkflowDraft, name: string, kind: string, fieldId: string, value: unknown): WorkflowDraft {
  const empty = value === '' || value === undefined || value === null
  if (fieldHome(kind, fieldId) === 'with') {
    return patchStep(draft, name, (step) => {
      const table = { ...(step.with ?? {}) }
      if (empty) delete table[fieldId]
      else table[fieldId] = value
      const next: WorkflowStepDef = { ...step, with: table }
      if (!Object.keys(table).length) delete (next as Record<string, unknown>).with
      return next
    })
  }
  const path = fieldId.split('.')
  return patchStep(draft, name, (step) => {
    if (path.length === 1) {
      const next = { ...step, [path[0]]: value } as WorkflowStepDef
      if (empty) delete (next as Record<string, unknown>)[path[0]]
      return next
    }
    const [head, tail] = path
    const nested = { ...((step as unknown as Record<string, Record<string, unknown>>)[head] ?? {}) }
    if (empty) delete nested[tail]
    else nested[tail] = value
    const next = { ...step, [head]: nested } as WorkflowStepDef
    if (!Object.keys(nested).length) delete (next as Record<string, unknown>)[head]
    return next
  })
}

/** Anything on a step that is not one of its kind's declared fields: the agent common fields, the
 *  ceiling, the budget. */
export function setStep(draft: WorkflowDraft, name: string, patch: Partial<WorkflowStepDef>): WorkflowDraft {
  return patchStep(draft, name, (step) => {
    const next = { ...step, ...patch } as Record<string, unknown>
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') delete next[key]
    }
    return next as WorkflowStepDef
  })
}

export function setDefinition(draft: WorkflowDraft, patch: Partial<WorkflowDef>): WorkflowDraft {
  const next = { ...draft.def, ...patch } as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) if (value === undefined || value === '') delete next[key]
  return { ...draft, def: next as unknown as WorkflowDef }
}

export function setInputs(draft: WorkflowDraft, inputs: WorkflowInput[]): WorkflowDraft {
  const def: WorkflowDef = { ...draft.def, inputs }
  if (!inputs.length) delete (def as Record<string, unknown>).inputs
  return { ...draft, def }
}

/** The JSON tab's Apply, and it is atomic: a document that does not parse, or that is not a
 *  definition, leaves the draft exactly as it was and the caller keeps the text for correction. */
export function applyJson(draft: WorkflowDraft, text: string): { draft: WorkflowDraft } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'That is not JSON.' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'A workflow is a JSON object.' }
  const def = parsed as Partial<WorkflowDef>
  if (typeof def.name !== 'string' || !def.name.trim()) return { error: 'A workflow needs a name.' }
  if (!Array.isArray(def.steps)) return { error: 'A workflow needs a list of steps.' }
  if (def.steps.some((step) => !step || typeof (step as WorkflowStepDef).name !== 'string')) {
    return { error: 'Every step needs a name.' }
  }
  const names = def.steps.map((step) => (step as WorkflowStepDef).name)
  const selection: DraftSelection = draft.selection.kind === 'node' && names.includes(draft.selection.name)
    ? draft.selection
    : { kind: 'definition' }
  return { draft: { def: parsed as WorkflowDef, selection } }
}

export const toJson = (def: WorkflowDef): string => `${JSON.stringify(def, null, 2)}\n`

/**
 * Which required fields are still empty, in the editor's own words.
 *
 * The node applies `required` too, before it calls a kind's validator, and the footer shows what it
 * says. This is the same question asked here so Save goes grey as the box is emptied rather than four
 * hundred milliseconds later, and so the answer exists before a node has ever been asked.
 */
export function missingRequiredFields(
  def: WorkflowDef,
  describeFor: (kind: string) => { fields: readonly StepField[] } | undefined,
): string[] {
  const problems: string[] = []
  for (const step of def.steps) {
    const kind = step.kind ?? 'agent'
    for (const field of describeFor(kind)?.fields ?? []) {
      if (!field.required) continue
      const value = readStepField(step as never, kind, field.id)
      const empty = value === undefined || value === null || (typeof value === 'string' && !value.trim())
      if (empty) problems.push(`step '${step.name}' needs ${field.label}`)
    }
  }
  return problems
}

/** How deep undo goes. Sixty drafts of a definition somebody is typing is a few hundred kilobytes at
 *  worst and about as far back as anyone reaches. */
export const UNDO_DEPTH = 60

/** Push a draft onto a bounded history. Pure, so the depth cap has a test and the store has one
 *  fewer thing to get wrong. */
export function pushUndo(stack: readonly WorkflowDraft[], draft: WorkflowDraft, depth = UNDO_DEPTH): WorkflowDraft[] {
  const next = [...stack, draft]
  return next.length > depth ? next.slice(next.length - depth) : next
}
