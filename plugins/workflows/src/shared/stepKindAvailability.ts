import type { StepKindContribution, StepKindDescription, WorkflowCatalog } from './workflowContracts'

const CONTRIBUTED_FIELD_TYPES = new Set(['text', 'textarea', 'number', 'boolean', 'select', 'prompt'])

/** A qualified kind names its contributor even when that contributor is no longer loaded. */
export const stepKindPluginId = (kind: string): string | undefined => {
  const separator = kind.indexOf(':')
  return separator > 0 ? kind.slice(0, separator) : undefined
}

export const unavailableCatalogKind = (kind: string, catalog: WorkflowCatalog | undefined): boolean =>
  !!catalog && !catalog.kinds.some((entry) => entry.id === kind)

export const unavailableStepKindMessage = (kind: string): string => {
  const pluginId = stepKindPluginId(kind)
  return pluginId
    ? `Plugin '${pluginId}' does not provide workflow step '${kind}' on this node. Install, enable, or update the plugin to use this step.`
    : `Workflow step kind '${kind}' is unavailable on this node.`
}

/** Check the authoring contract at the workflow boundary, including JavaScript plugins without types. */
export function stepKindContributionProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['contribution must be an object']
  const contribution = value as Partial<StepKindContribution>
  const description = contribution.describe as Partial<StepKindDescription> | undefined
  const problems: string[] = []
  if (typeof contribution.handler !== 'function') problems.push('handler must be a function')
  if (contribution.validate !== undefined && typeof contribution.validate !== 'function') problems.push('validate must be a function')
  if (!description || typeof description !== 'object') return [...problems, 'describe is required']
  for (const field of ['label', 'icon', 'description'] as const) {
    if (typeof description[field] !== 'string' || !description[field].trim()) problems.push(`describe.${field} is required`)
  }
  if (!Array.isArray(description.fields)) problems.push('describe.fields must be an array')
  else {
    const ids = new Set<string>()
    description.fields.forEach((field, index) => {
      if (!field || typeof field !== 'object' || typeof field.id !== 'string' || !field.id.trim()
        || typeof field.label !== 'string' || !field.label.trim() || !CONTRIBUTED_FIELD_TYPES.has(field.type)) {
        problems.push(`describe.fields[${index}] needs an id, label, and supported type`)
      } else if (ids.has(field.id)) problems.push(`describe.fields has duplicate id '${field.id}'`)
      else ids.add(field.id)
    })
  }
  if (!description.output || typeof description.output.description !== 'string' || !description.output.description.trim()) {
    problems.push('describe.output.description is required')
  }
  return problems
}
