import type { WorkflowStepDef, WorkflowStepRow, WorkflowValueBinding } from '../shared/workflowContracts'
import { parseWorkflowJsonPointer } from './workflowValidation'

const TITLE_LIMIT = 500
const BOUND_TEMPLATE_RE = /\$\{([A-Za-z][A-Za-z0-9_]*)\}/g

export type WorkflowMapRosterEntry = {
  index: number
  itemKey: string
  item: unknown
  inputs: Record<string, string>
  title: string
}

export type WorkflowMapRoster = {
  version: 1
  entries: WorkflowMapRosterEntry[]
}

export function readWorkflowJsonPointer(value: unknown, pointer: string): unknown {
  const segments = parseWorkflowJsonPointer(pointer)
  if (!segments) throw new Error(`Binding pointer '${pointer}' is not a safe JSON Pointer.`)
  let current = value
  for (const segment of segments) {
    if (current == null || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
      throw new Error(`Binding pointer '${pointer}' does not resolve to a value.`)
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function structuredOutput(step: WorkflowStepRow): unknown {
  if (step.status !== 'done' || !step.structuredJson) {
    throw new Error(`Binding source step '${step.name}' has no completed structured output.`)
  }
  try {
    return JSON.parse(step.structuredJson) as unknown
  } catch {
    throw new Error(`Binding source step '${step.name}' has malformed structured output.`)
  }
}

function resolveBindings(
  bindings: Readonly<Record<string, WorkflowValueBinding>>,
  inputs: Readonly<Record<string, string>>,
  steps: readonly WorkflowStepRow[],
  item?: { value: unknown },
): Record<string, string> {
  return Object.fromEntries(Object.entries(bindings).map(([name, binding]) => {
    let value: unknown
    if (binding.from === 'literal') value = binding.value
    else if (binding.from === 'input') value = inputs[binding.name]
    else if (binding.from === 'step') {
      const step = steps.find((candidate) => candidate.name === binding.step && candidate.parentStepId == null)
      if (!step) throw new Error(`Binding source step '${binding.step}' was not found in the parent run.`)
      value = readWorkflowJsonPointer(structuredOutput(step), binding.pointer)
    } else if (binding.from === 'item' && item) {
      value = readWorkflowJsonPointer(item.value, binding.pointer)
    } else {
      throw new Error(`Child input '${name}' uses an item binding outside a workflow-map step.`)
    }
    if (typeof value !== 'string') throw new Error(`Child input '${name}' must resolve to a string.`)
    return [name, value]
  }))
}

/** Evaluates the non-map binding vocabulary against one frozen parent run. */
export function resolveChildWorkflowInputs(
  bindings: Readonly<Record<string, WorkflowValueBinding>>,
  inputs: Readonly<Record<string, string>>,
  steps: readonly WorkflowStepRow[],
): Record<string, string> {
  return resolveBindings(bindings, inputs, steps)
}

function safeTaskTitle(value: string, index: number): string {
  const printable = [...value].map((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127 ? ' ' : character
  }).join('')
  const title = printable.replace(/\s+/g, ' ').trim().slice(0, TITLE_LIMIT).trim()
  if (!title) throw new Error(`Workflow map item ${index + 1} title must resolve to visible text.`)
  return title
}

/** Resolves and validates the complete map before the dispatcher can create its first child task. */
export function resolveWorkflowMapRoster(
  def: WorkflowStepDef,
  inputs: Readonly<Record<string, string>>,
  steps: readonly WorkflowStepRow[],
  defaults: Readonly<Record<string, string>> = {},
): WorkflowMapRoster {
  if (def.kind !== 'workflow-map' || !def.items || !def.itemKey || !def.childWorkflow || !def.title) {
    throw new Error(`Step '${def.name}' is not a complete workflow-map step.`)
  }
  const source = steps.find((candidate) => candidate.name === def.items!.step && candidate.parentStepId == null)
  if (!source) throw new Error(`Map source step '${def.items.step}' was not found in the parent run.`)
  const items = readWorkflowJsonPointer(structuredOutput(source), def.items.pointer)
  if (!Array.isArray(items)) throw new Error(`Workflow map items pointer '${def.items.pointer}' must resolve to an array.`)

  const keys = new Set<string>()
  const entries = items.map((item, index): WorkflowMapRosterEntry => {
    const itemKey = readWorkflowJsonPointer(item, def.itemKey!)
    if (typeof itemKey !== 'string' || !itemKey.trim()) {
      throw new Error(`Workflow map item ${index + 1} key must resolve to a nonempty string.`)
    }
    if (keys.has(itemKey)) throw new Error(`Workflow map item key '${itemKey}' is repeated.`)
    keys.add(itemKey)

    const childInputs = {
      ...defaults,
      ...resolveBindings(def.childWorkflow!.inputs ?? {}, inputs, steps, { value: item }),
    }
    const titleBindings = resolveBindings(def.title!.bindings ?? {}, inputs, steps, { value: item })
    const renderedTitle = def.title!.template.replace(BOUND_TEMPLATE_RE, (_token, name: string) => titleBindings[name] ?? '')
    return {
      index,
      itemKey,
      item: structuredClone(item),
      inputs: childInputs,
      title: safeTaskTitle(renderedTitle, index),
    }
  })
  return { version: 1, entries }
}
