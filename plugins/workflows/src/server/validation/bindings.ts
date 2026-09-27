import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { WorkflowStepDef, WorkflowStepRow, WorkflowValueBinding } from '../../shared/workflowContracts'
import { parseWorkflowJsonPointer } from './definition'
import { readDataBinding } from '@acorn/protocol/dataQueryResolution.ts'
import { dataBindingSchema } from '@acorn/protocol/dataBindings.ts'
import { MISSING, parseDataValue } from '@acorn/protocol/dataValues.ts'
import { workflowText, WORKFLOW_VALUE_BYTES } from './values'
import { workflowRecordIdentity } from '../processing/rules'

const TITLE_LIMIT = 500
const BOUND_TEMPLATE_RE = /\$\{([A-Za-z][A-Za-z0-9_]*)\}/g

export type WorkflowMapRosterEntry = {
  index: number
  itemKey: string
  item: unknown
  inputs: Record<string, DataValue>
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
  if (!['done', 'completed-with-failures'].includes(step.status) || !step.structuredJson) {
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
  inputs: Readonly<Record<string, DataValue>>,
  steps: readonly WorkflowStepRow[],
  item?: { value: unknown },
  admitted?: Readonly<Record<string, DataValue>>,
): Record<string, DataValue> {
  const completed = admitted ?? Object.fromEntries(steps.filter(step => step.parentStepId == null && ['done', 'completed-with-failures'].includes(step.status) && step.structuredJson)
    .map(step => [step.name, parseDataValue(structuredOutput(step), WORKFLOW_VALUE_BYTES)]))
  return Object.fromEntries(Object.entries(bindings).flatMap(([name, binding]) => {
    const typed = dataBindingSchema.parse(binding)
    if (typed.address.from === 'item' && !item) throw new Error(`Child input '${name}' uses an item binding outside a workflow-map step.`)
    const value = readDataBinding(typed, { inputs: { ...inputs }, steps: { ...completed }, ...(item ? { item: parseDataValue(item.value, WORKFLOW_VALUE_BYTES) } : {}) })
    if (value === MISSING) {
      return [] // The child's input schema decides whether omission is legal.
    }
    return [[name, value]]
  }))
}

/** Evaluates the non-map binding vocabulary against one frozen parent run. */
export function resolveChildWorkflowInputs(
  bindings: Readonly<Record<string, WorkflowValueBinding>>,
  inputs: Readonly<Record<string, DataValue>>,
  steps: readonly WorkflowStepRow[],
  admitted?: Readonly<Record<string, DataValue>>,
): Record<string, DataValue> {
  return resolveBindings(bindings, inputs, steps, undefined, admitted)
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
  inputs: Readonly<Record<string, DataValue>>,
  steps: readonly WorkflowStepRow[],
  defaults: Readonly<Record<string, DataValue>> = {},
  admitted?: Readonly<Record<string, DataValue>>,
  childName = 'Workflow',
): WorkflowMapRoster {
  if (def.kind !== 'workflow-map' || !def.items || !def.childWorkflow) {
    throw new Error(`Step '${def.name}' is not a complete workflow-map step.`)
  }
  const source = steps.find((candidate) => candidate.name === def.items!.step && candidate.parentStepId == null)
  if (!source && !admitted?.[def.items.step]) throw new Error(`Map source step '${def.items.step}' was not found in the parent run.`)
  const items = readWorkflowJsonPointer(admitted ? admitted[def.items.step] : structuredOutput(source!), def.items.pointer)
  if (!Array.isArray(items)) throw new Error(`Workflow map items pointer '${def.items.pointer}' must resolve to an array.`)

  const keys = new Set<string>()
  const entries = items.map((item, index): WorkflowMapRosterEntry => {
    const sourceIdentity = workflowRecordIdentity(item)
    if (!sourceIdentity && def.itemKey === undefined) throw new Error('Select a stable item key for an ordinary array')
    const rawKey = sourceIdentity ?? readWorkflowJsonPointer(item, def.itemKey!)
    if (!((typeof rawKey === 'string' && rawKey.trim()) || (typeof rawKey === 'number' && Number.isFinite(rawKey)))) {
      throw new Error(`Workflow map item ${index + 1} key must resolve to a nonempty string.`)
    }
    const itemKey = sourceIdentity ?? (def.id ? JSON.stringify([typeof rawKey, rawKey]) : String(rawKey))
    if (keys.has(itemKey)) throw new Error(`Workflow map item key '${itemKey}' is repeated.`)
    keys.add(itemKey)

    const childInputs = {
      ...defaults,
      ...resolveBindings(def.childWorkflow!.inputs ?? {}, inputs, steps, { value: item }, admitted),
    }
    const titleBindings = resolveBindings(def.title?.bindings ?? {}, inputs, steps, { value: item }, admitted)
    const defaultLabel = sourceIdentity ? item.display?.title ?? item.ref.recordId : String(rawKey)
    const renderedTitle = def.title ? def.title.template.replace(BOUND_TEMPLATE_RE, (_token, name: string) => {
      if (!Object.hasOwn(titleBindings, name)) throw new Error(`Title binding '${name}' is missing`)
      return workflowText(titleBindings[name])
    }) : `${childName}: ${defaultLabel}`
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
