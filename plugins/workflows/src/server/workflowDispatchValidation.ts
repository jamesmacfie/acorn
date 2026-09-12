import type {
  ChildWorkflowConfig,
  WorkflowCatalogTarget,
  WorkflowStepDef,
  WorkflowValueBinding,
} from '../shared/workflowContracts'

export const RUNTIME_WORKFLOW_KINDS = new Set(['workflow', 'workflow-map'])

const INPUT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/
const REPO_WORKFLOW_PATH_RE = /^\.acorn\/workflows\/[A-Za-z0-9][A-Za-z0-9_-]*\.toml$/
const BOUND_TEMPLATE_RE = /\$\{([^}]+)\}/g
const BOUND_TEMPLATE_TOKEN_RE = /\$\{[^}]*\}/g
const FORBIDDEN_POINTER_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

/** Parses the RFC 6901 subset accepted by workflow bindings without evaluating the path. */
export function parseWorkflowJsonPointer(pointer: unknown): string[] | null {
  if (typeof pointer !== 'string') return null
  if (pointer === '') return []
  if (!pointer.startsWith('/')) return null
  const segments: string[] = []
  for (const encoded of pointer.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(encoded)) return null
    const segment = encoded.replace(/~1/g, '/').replace(/~0/g, '~')
    if (FORBIDDEN_POINTER_SEGMENTS.has(segment)) return null
    segments.push(segment)
  }
  return segments
}

const unexpectedFields = (value: object, allowed: readonly string[]): string[] =>
  Object.keys(value).filter((key) => !allowed.includes(key))

function bindingProblems(
  label: string,
  binding: WorkflowValueBinding,
  declaredInputs: ReadonlySet<string>,
  indexes: ReadonlyMap<string, number>,
  precedes: (candidate: string, step: string) => boolean,
  structured: (step: string) => boolean,
  stepName: string,
  allowItem: boolean,
): string[] {
  if (!binding || typeof binding !== 'object') return [`${label} must be a binding table`]
  if (binding.from === 'literal') {
    const errors = unexpectedFields(binding, ['from', 'value']).map((field) => `${label} has unsupported field '${field}'`)
    if (typeof binding.value !== 'string') errors.push(`${label}.value must be a string`)
    return errors
  }
  if (binding.from === 'input') {
    const errors = unexpectedFields(binding, ['from', 'name']).map((field) => `${label} has unsupported field '${field}'`)
    if (typeof binding.name !== 'string' || !declaredInputs.has(binding.name)) {
      errors.push(`${label} references undeclared input '${typeof binding.name === 'string' ? binding.name : ''}'`)
    }
    return errors
  }
  if (binding.from === 'step') {
    const errors = unexpectedFields(binding, ['from', 'step', 'pointer']).map((field) => `${label} has unsupported field '${field}'`)
    if (typeof binding.step !== 'string' || !indexes.has(binding.step)) {
      errors.push(`${label} references unknown step '${typeof binding.step === 'string' ? binding.step : ''}'`)
    } else if (!precedes(binding.step, stepName)) {
      errors.push(`${label} references '${binding.step}', which is not one of its predecessors`)
    } else if (!structured(binding.step)) {
      errors.push(`${label} references '${binding.step}', which does not declare structured output`)
    }
    if (typeof binding.pointer !== 'string' || parseWorkflowJsonPointer(binding.pointer) === null) {
      errors.push(`${label}.pointer is not a safe JSON Pointer`)
    }
    return errors
  }
  if (binding.from === 'item') {
    const errors = unexpectedFields(binding, ['from', 'pointer']).map((field) => `${label} has unsupported field '${field}'`)
    if (!allowItem) errors.push(`${label} can use an item only in a workflow-map step`)
    if (typeof binding.pointer !== 'string' || parseWorkflowJsonPointer(binding.pointer) === null) {
      errors.push(`${label}.pointer is not a safe JSON Pointer`)
    }
    return errors
  }
  return [`${label}.from must be literal, input, step, or item`]
}

function childWorkflowProblems(
  label: string,
  step: WorkflowStepDef,
  child: ChildWorkflowConfig | undefined,
  declaredInputs: ReadonlySet<string>,
  indexes: ReadonlyMap<string, number>,
  precedes: (candidate: string, step: string) => boolean,
  structured: (step: string) => boolean,
): string[] {
  if (!child) return [`${label} needs child_workflow`]
  const errors = unexpectedFields(child, ['ref', 'inputs']).map((field) => `${label} child_workflow has unsupported field '${field}'`)
  const ref = child.ref
  if (!ref || typeof ref !== 'object') errors.push(`${label} child_workflow.ref must be a reference table`)
  else if (ref.source === 'database' || ref.source === 'user') {
    errors.push(...unexpectedFields(ref, ['source', 'id']).map((field) => `${label} child_workflow.ref has unsupported field '${field}'`))
    if (typeof ref.id !== 'string' || !ref.id.trim()) errors.push(`${label} child_workflow.ref.id must be a nonempty string`)
  } else if (ref.source === 'repo') {
    errors.push(...unexpectedFields(ref, ['source', 'path']).map((field) => `${label} child_workflow.ref has unsupported field '${field}'`))
    if (typeof ref.path !== 'string' || !REPO_WORKFLOW_PATH_RE.test(ref.path)) {
      errors.push(`${label} child_workflow.ref.path must name a file under .acorn/workflows`)
    }
  } else errors.push(`${label} child_workflow.ref.source must be database, repo, or user`)

  for (const [name, binding] of Object.entries(child.inputs ?? {})) {
    if (!INPUT_NAME_RE.test(name)) errors.push(`${label} child_workflow.inputs has invalid name '${name}'`)
    errors.push(...bindingProblems(`${label} child_workflow.inputs.${name}`, binding, declaredInputs, indexes, precedes, structured, step.name, step.kind === 'workflow-map'))
  }
  return errors
}

export function workflowDispatchProblems(args: {
  label: string
  step: WorkflowStepDef
  targets?: readonly WorkflowCatalogTarget[]
  declaredInputs: ReadonlySet<string>
  indexes: ReadonlyMap<string, number>
  precedes: (candidate: string, step: string) => boolean
  structured: (step: string) => boolean
}): string[] {
  const { label, step, targets, declaredInputs, indexes, precedes, structured } = args
  const kind = step.kind ?? 'agent'
  if (!RUNTIME_WORKFLOW_KINDS.has(kind)) {
    const errors: string[] = []
    if (step.childWorkflow != null) errors.push(`${label} is a '${kind}' step, which cannot take childWorkflow`)
    if (step.items != null) errors.push(`${label} is a '${kind}' step, which cannot take items`)
    if (step.itemKey != null) errors.push(`${label} is a '${kind}' step, which cannot take itemKey`)
    if (step.title != null) errors.push(`${label} is a '${kind}' step, which cannot take title`)
    return errors
  }

  const errors = childWorkflowProblems(label, step, step.childWorkflow, declaredInputs, indexes, precedes, structured)
  if (step.childWorkflow && targets) {
    const ref = step.childWorkflow.ref
    const target = ref && targets.find((entry) => {
      if (entry.ref.source !== ref.source) return false
      if (entry.ref.source === 'repo' && ref.source === 'repo') return entry.ref.path === ref.path
      return entry.ref.source !== 'repo' && ref.source !== 'repo' && entry.ref.id === ref.id
    })
    if (!target) errors.push(`${label} child workflow is not available to this project`)
    else {
      const bindings = step.childWorkflow.inputs ?? {}
      const declared = new Set(target.inputs.map((input) => input.name))
      for (const name of Object.keys(bindings)) {
        if (!declared.has(name)) errors.push(`${label} binds undeclared child input '${name}'`)
      }
      for (const input of target.inputs) {
        if (input.required && !input.hasDefault && !bindings[input.name]) {
          errors.push(`${label} needs a binding for child input '${input.name}'`)
        }
      }
    }
  }

  if (kind === 'workflow-map') {
    if (!step.items) errors.push(`${label} needs items`)
    else {
      errors.push(...unexpectedFields(step.items, ['step', 'pointer']).map((field) => `${label} items has unsupported field '${field}'`))
      if (!indexes.has(step.items.step)) errors.push(`${label} items references unknown step '${step.items.step}'`)
      else if (!precedes(step.items.step, step.name)) {
        errors.push(`${label} items references '${step.items.step}', which is not one of its predecessors`)
      } else if (!structured(step.items.step)) {
        errors.push(`${label} items references '${step.items.step}', which does not declare structured output`)
      }
      if (parseWorkflowJsonPointer(step.items.pointer) === null) errors.push(`${label} items.pointer is not a safe JSON Pointer`)
    }
    if (typeof step.itemKey !== 'string' || parseWorkflowJsonPointer(step.itemKey) === null) {
      errors.push(`${label} item_key is not a safe JSON Pointer`)
    }
    if (typeof step.title?.template !== 'string' || !step.title.template.trim()) errors.push(`${label} needs a title template`)
    else {
      errors.push(...unexpectedFields(step.title, ['template', 'bindings']).map((field) => `${label} title has unsupported field '${field}'`))
      const names = new Set(Object.keys(step.title.bindings ?? {}))
      for (const token of step.title.template.match(BOUND_TEMPLATE_TOKEN_RE) ?? []) {
        if (!/^\$\{[A-Za-z][A-Za-z0-9_]*\}$/.test(token)) errors.push(`${label} title has invalid binding expression '${token}'`)
      }
      if (step.title.template.replace(BOUND_TEMPLATE_TOKEN_RE, '').includes('${')) {
        errors.push(`${label} title has an unterminated binding expression`)
      }
      for (const match of step.title.template.matchAll(BOUND_TEMPLATE_RE)) {
        if (!names.has(match[1])) errors.push(`${label} title references undeclared binding '${match[1]}'`)
      }
      for (const [name, binding] of Object.entries(step.title.bindings ?? {})) {
        if (!INPUT_NAME_RE.test(name)) errors.push(`${label} title.bindings has invalid name '${name}'`)
        errors.push(...bindingProblems(`${label} title.bindings.${name}`, binding, declaredInputs, indexes, precedes, structured, step.name, true))
      }
    }
  } else {
    if (step.items != null) errors.push(`${label} is a 'workflow' step, which cannot take items`)
    if (step.itemKey != null) errors.push(`${label} is a 'workflow' step, which cannot take itemKey`)
    if (step.title != null) errors.push(`${label} is a 'workflow' step, which cannot take title`)
  }
  return errors
}
