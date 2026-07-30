import type { AgentConfigOption, AgentSkillDescriptor } from '../../../../core/shared/managedAgents'
import { asObject } from './codexNormalizer'

const stringValue = (value: unknown): string | null => typeof value === 'string' ? value : null

export function codexModelOptions(response: unknown, currentModel: string | null): AgentConfigOption[] {
  const root = asObject(response)
  const models = Array.isArray(root?.data) ? root.data.flatMap((value) => {
    const row = asObject(value)
    const id = stringValue(row?.id) ?? stringValue(row?.model)
    if (!id) return []
    return [{
      value: id,
      label: stringValue(row?.displayName) ?? id,
      description: stringValue(row?.description) ?? undefined,
    }]
  }) : []
  return models.length
    ? [{ id: 'model', label: 'Model', category: 'model', currentValue: currentModel, values: models }]
    : []
}

export function codexReasoningOptions(
  response: unknown,
  currentModel: string | null,
  currentEffort: string | null,
): AgentConfigOption[] {
  const root = asObject(response)
  const rows = Array.isArray(root?.data) ? root.data.map(asObject).filter((row) => row != null) : []
  const model = rows.find((row) =>
    stringValue(row?.id) === currentModel || stringValue(row?.model) === currentModel)
    ?? rows.find((row) => row?.isDefault === true)
    ?? rows[0]
  if (!model || !Array.isArray(model.supportedReasoningEfforts)) return []
  const values = model.supportedReasoningEfforts.flatMap((value) => {
    const option = asObject(value)
    const effort = stringValue(option?.reasoningEffort)
    if (!effort) return []
    return [{
      value: effort,
      label: effort,
      description: stringValue(option?.description) ?? undefined,
    }]
  })
  if (!values.length) return []
  return [{
    id: 'reasoning',
    label: 'Effort',
    category: 'reasoning',
    currentValue: currentEffort ?? stringValue(model.defaultReasoningEffort),
    values,
  }]
}

export function codexPermissionOptions(response: unknown, current: string | null): AgentConfigOption[] {
  const root = asObject(response)
  const profiles = Array.isArray(root?.data) ? root.data.flatMap((value) => {
    const row = asObject(value)
    const id = stringValue(row?.id)
    if (!id || row?.allowed === false) return []
    return [{ value: id, label: id, description: stringValue(row?.description) ?? undefined }]
  }) : []
  return profiles.length
    ? [{ id: 'permissions', label: 'Permissions', category: 'permission', currentValue: current, values: profiles }]
    : []
}

export function codexSkillsFromResponse(response: unknown): AgentSkillDescriptor[] {
  const root = asObject(response)
  if (!Array.isArray(root?.data)) return []
  return root.data.flatMap((entry) => {
    const row = asObject(entry)
    if (!Array.isArray(row?.skills)) return []
    return row.skills.flatMap((value) => {
      const skill = asObject(value)
      const name = stringValue(skill?.name)
      if (!name || skill?.enabled === false) return []
      return [{
        name,
        description: stringValue(skill?.description) ?? undefined,
        path: stringValue(skill?.path) ?? undefined,
      }]
    })
  })
}
