import type { WorkflowGenerateNote } from '../shared/api'
import type {
  WorkflowCatalog,
  WorkflowDef,
  WorkflowDefinitionRef,
  WorkflowValueBinding,
} from '../shared/workflowContracts'
import { sameWorkflowRef } from '../shared/workflowRefs'
import { parseWorkflowJsonPointer, workflowEdges } from './workflowValidation'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const without = <T extends object>(record: T, key: string): T =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key)) as T

const add = (notes: WorkflowGenerateNote[], code: WorkflowGenerateNote['code'], message: string, step?: string): void => {
  notes.push({ code, message, ...(step ? { step } : {}) })
}

const bindingShape = (
  binding: unknown,
  allowItem: boolean,
  parentInputs: ReadonlySet<string>,
  names: ReadonlySet<string>,
  precedes: (candidate: string, target: string) => boolean,
  structured: (step: string) => boolean,
  owner: string,
): string | undefined => {
  if (!isRecord(binding) || typeof binding.from !== 'string') return 'is not a binding object'
  if (binding.from === 'literal') {
    return Object.keys(binding).every((key) => key === 'from' || key === 'value') && typeof binding.value === 'string'
      ? undefined : 'is not a literal string binding'
  }
  if (binding.from === 'input') {
    return Object.keys(binding).every((key) => key === 'from' || key === 'name')
      && typeof binding.name === 'string' && parentInputs.has(binding.name)
      ? undefined : 'is not a parent input binding'
  }
  if (binding.from === 'item') {
    return allowItem && Object.keys(binding).every((key) => key === 'from' || key === 'pointer')
      && parseWorkflowJsonPointer(binding.pointer) !== null
      ? undefined : 'is not an item binding for this step'
  }
  if (binding.from === 'step') {
    const supported = Object.keys(binding).every((key) => key === 'from' || key === 'step' || key === 'pointer')
      && typeof binding.step === 'string'
      && names.has(binding.step)
      && precedes(binding.step, owner)
      && structured(binding.step)
      && parseWorkflowJsonPointer(binding.pointer) !== null
    return supported ? undefined : 'does not name a structured predecessor binding'
  }
  return `uses the unsupported source '${binding.from}'`
}

/** Grounds runtime references and bindings against the same bounded target catalog the prompt saw. */
export function groundWorkflowDispatch(
  def: WorkflowDef,
  catalog: WorkflowCatalog,
  notes: WorkflowGenerateNote[],
): WorkflowDef {
  const targets = catalog.workflows ?? []
  const parentInputs = new Set((def.inputs ?? []).map((input) => input.name))
  const names = new Set(def.steps.map((step) => step.name))
  const graph = workflowEdges(def.steps)
  const precedes = (candidate: string, owner: string): boolean => {
    const seen = new Set<string>()
    const pending = [...(graph.get(owner) ?? [])]
    while (pending.length) {
      const name = pending.pop()!
      if (name === candidate) return true
      if (seen.has(name)) continue
      seen.add(name)
      pending.push(...(graph.get(name) ?? []))
    }
    return false
  }
  const structured = (name: string): boolean => {
    const source = def.steps.find((step) => step.name === name)
    if (!source) return false
    if (source.schema && typeof source.schema === 'object' && !Array.isArray(source.schema)) return true
    return !!catalog.kinds.find((kind) => kind.id === (source.kind ?? 'agent'))?.describe?.output?.schema
  }

  const steps = def.steps.map((step) => {
    if (step.kind !== 'workflow' && step.kind !== 'workflow-map') return step
    let next = step
    const ref = isRecord(next.childWorkflow) && isRecord(next.childWorkflow.ref)
      ? next.childWorkflow.ref as WorkflowDefinitionRef
      : undefined
    const target = ref ? targets.find((entry) => sameWorkflowRef(entry.ref, ref)) : undefined
    if (ref && !target) {
      add(notes, 'unknown-workflow', `Step '${step.name}' named a child workflow that is not available to this project, so the target was dropped.`, step.name)
      next = without(next, 'childWorkflow')
    } else if (target && next.childWorkflow) {
      const declared = new Set(target.inputs.map((input) => input.name))
      const kept = Object.entries(isRecord(next.childWorkflow.inputs) ? next.childWorkflow.inputs : {}).filter(([name, binding]) => {
        const problem = !declared.has(name)
          ? `binds the undeclared child input '${name}'`
          : bindingShape(binding, step.kind === 'workflow-map', parentInputs, names, precedes, structured, step.name)
        if (!problem) return true
        add(notes, 'unsupported-binding', `Step '${step.name}' ${problem}, so that binding was dropped.`, step.name)
        return false
      })
      next = {
        ...next,
        childWorkflow: {
          ref: target.ref,
          ...(kept.length ? { inputs: Object.fromEntries(kept) as Record<string, WorkflowValueBinding> } : {}),
        },
      }
    }

    if (step.kind === 'workflow-map' && next.items) {
      const valid = typeof next.items.step === 'string' && names.has(next.items.step)
        && precedes(next.items.step, step.name) && structured(next.items.step)
        && parseWorkflowJsonPointer(next.items.pointer) !== null
      if (!valid) {
        add(notes, 'unknown-step-reference', `Step '${step.name}' has an invalid map source, so the source was dropped.`, step.name)
        next = without(next, 'items')
      }
    }
    if (step.kind === 'workflow-map' && next.title?.bindings) {
      const kept = Object.entries(next.title.bindings).filter(([name, binding]) => {
        const problem = bindingShape(binding, true, parentInputs, names, precedes, structured, step.name)
        if (!problem) return true
        add(notes, 'unsupported-binding', `Step '${step.name}' title binding '${name}' ${problem}, so that binding was dropped.`, step.name)
        return false
      })
      next = { ...next, title: { ...next.title, ...(kept.length ? { bindings: Object.fromEntries(kept) } : { bindings: undefined }) } }
    }
    return next
  })
  return steps.some((step, index) => step !== def.steps[index]) ? { ...def, steps } : def
}
