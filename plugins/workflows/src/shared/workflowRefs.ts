import type { WorkflowDefinitionRef } from './workflowContracts'

export function workflowRefKey(ref: WorkflowDefinitionRef): string {
  if (ref.source === 'repo') return `repo:${ref.path}`
  return `${ref.source}:${ref.id}`
}

export function sameWorkflowRef(left: WorkflowDefinitionRef, right: WorkflowDefinitionRef): boolean {
  return workflowRefKey(left) === workflowRefKey(right)
}
