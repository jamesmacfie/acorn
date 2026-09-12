import type { AgentConfigOption, AgentSkillDescriptor } from '@acorn/protocol/managedAgents.ts'
import { asObject } from './codexNormalizer'

const stringValue = (value: unknown): string | null => typeof value === 'string' ? value : null

export type CodexCollaborationModePreset = {
  name: string
  mode: 'default' | 'plan'
  model: string | null
  reasoningEffort: string | null
}

export type CodexCollaborationModes = {
  option: AgentConfigOption | null
  presets: ReadonlyMap<string, CodexCollaborationModePreset>
}

export type CodexThreadSettings = {
  mode: 'default' | 'plan'
  model: string
  reasoningEffort: string | null
}

const modeValue = (value: unknown): CodexCollaborationModePreset['mode'] | null =>
  value === 'default' || value === 'plan' ? value : null

/**
 * Keep the provider's preset mask behind the generic string option. The renderer and defaults store
 * only need the stable mode value; the driver needs the nullable model and effort overrides when it
 * expands that value back into Codex's full turn payload.
 */
export function codexCollaborationModes(response: unknown, currentMode: string | null): CodexCollaborationModes {
  const root = asObject(response)
  const presets = new Map<string, CodexCollaborationModePreset>()
  if (Array.isArray(root?.data)) {
    for (const value of root.data) {
      const row = asObject(value)
      const name = stringValue(row?.name)?.trim()
      const mode = modeValue(row?.mode)
      const model = row?.model == null ? null : stringValue(row.model)
      const reasoningEffort = row?.reasoning_effort == null ? null : stringValue(row.reasoning_effort)
      if (!name || !mode || (row?.model != null && model == null) || (row?.reasoning_effort != null && reasoningEffort == null)) {
        continue
      }
      presets.set(mode, { name, mode, model, reasoningEffort })
    }
  }
  const values = (['default', 'plan'] as const).flatMap((mode) => {
    const preset = presets.get(mode)
    return preset ? [{ value: mode, label: preset.name }] : []
  })
  return {
    option: values.length
      ? {
          id: 'mode',
          label: 'Mode',
          category: 'mode',
          currentValue: currentMode && presets.has(currentMode) ? currentMode : null,
          values,
        }
      : null,
    presets,
  }
}

export function codexThreadSettings(value: unknown): CodexThreadSettings | null {
  const settings = asObject(value)
  const collaborationMode = asObject(settings?.collaborationMode)
  const mode = modeValue(collaborationMode?.mode)
  const model = stringValue(settings?.model)
  const effort = settings?.effort
  if (!mode || !model || (effort != null && typeof effort !== 'string')) return null
  return { mode, model, reasoningEffort: effort ?? null }
}

export function codexCollaborationModeForTurn(
  modes: CodexCollaborationModes,
  selectedMode: unknown,
  selectedModel: unknown,
  selectedEffort: unknown,
): Record<string, unknown> | null {
  const mode = stringValue(selectedMode)
  const preset = mode ? modes.presets.get(mode) : undefined
  const model = preset?.model ?? stringValue(selectedModel)
  if (!preset || !model) return null
  return {
    mode: preset.mode,
    settings: {
      model,
      reasoning_effort: preset.reasoningEffort ?? stringValue(selectedEffort),
      developer_instructions: null,
    },
  }
}

export function codexOptionsWithThreadSettings(
  options: readonly AgentConfigOption[],
  settings: CodexThreadSettings,
): AgentConfigOption[] {
  const values = new Map<string, string | null>([
    ['mode', settings.mode],
    ['model', settings.model],
    ['reasoning', settings.reasoningEffort],
  ])
  return options.map((option) => values.has(option.id)
    ? { ...option, currentValue: values.get(option.id) ?? null }
    : option)
}

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
