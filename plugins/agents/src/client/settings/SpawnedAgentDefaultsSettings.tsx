import { For, Show } from 'solid-js'
import { createSettingSave } from '@acorn/plugin-api/client'
import { Select, SettingRow, SettingsSection, Text } from '@acorn/plugin-api/ui'
import type { AgentConfigOption, AgentProviderDescriptor } from '../../contract/wire.ts'
import type { SpawnedAgentDefaults } from '../../shared/sessionDefaults'

export default function SpawnedAgentDefaultsSettings(props: {
  value: SpawnedAgentDefaults
  providers: readonly AgentProviderDescriptor[]
  advertised: Record<string, AgentConfigOption[]>
  onSave: (value: SpawnedAgentDefaults) => Promise<unknown>
}) {
  const modeSave = createSettingSave()
  const harnessSave = createSettingSave()
  const selected = () => props.providers.find((provider) => provider.profileId === props.value.profileId)
  const harnessOptions = () => {
    const options = props.providers.filter((provider) => provider.installed)
      .map((provider) => ({ value: provider.profileId, label: provider.label }))
    const saved = props.value.profileId
    if (saved && !options.some((option) => option.value === saved)) {
      options.push({ value: saved, label: `${selected()?.label ?? saved} (unavailable)` })
    }
    return [{ value: '', label: 'Parent harness' }, ...options]
  }
  const options = () => (props.advertised[selected()?.id ?? ''] ?? [])
    .filter((option) => option.category === 'model' || option.category === 'reasoning')
  const chooseOption = (providerId: string, optionId: string, value: string) => {
    const pinned = { ...props.value.pinned[providerId] }
    if (value) pinned[optionId] = value
    else delete pinned[optionId]
    return props.onSave({ ...props.value, pinned: { ...props.value.pinned, [providerId]: pinned } })
  }

  return (
    <SettingsSection id="spawned" label="Spawned agents"
      help="Defaults for agents started by another agent, including agents in subtasks. A spawn can override the harness, model, and effort. Changes apply to future spawns.">
      <SettingRow label="Spawn settings" error={modeSave.error()}>
        <Select label="Spawn settings" value={props.value.mode}
          options={[
            { value: 'inherit', label: 'Inherit from parent' },
            { value: 'explicit', label: 'Use explicit defaults' },
          ]}
          onChange={(mode) => void modeSave.run(() => props.onSave({
            ...props.value, mode: mode as SpawnedAgentDefaults['mode'],
          }))} />
      </SettingRow>
      <Show when={props.value.mode === 'inherit'} fallback={
        <>
          <SettingRow label="Spawned agent harness" error={harnessSave.error()}>
            <Select label="Spawned agent harness" value={props.value.profileId ?? ''}
              options={harnessOptions()}
              onChange={(profileId) => void harnessSave.run(() => props.onSave({
                ...props.value, profileId: profileId || null,
              }))} />
          </SettingRow>
          <Show when={selected()} fallback={<Text emphasis="muted" wrap>Choose a harness to set its model and effort.</Text>}>
            {(provider) => (
              <Show when={options().length} fallback={
                <Text emphasis="muted" wrap>Open a {provider().label} session once. Its model and effort choices appear here after that.</Text>
              }>
                <For each={options()}>
                  {(option) => {
                    const save = createSettingSave()
                    return (
                      <SettingRow label={option.label} error={save.error()}>
                        <Select label={`Spawned agent ${option.label}`}
                          value={props.value.pinned[provider().id]?.[option.id] ?? ''}
                          options={[{ value: '', label: 'Provider default' }, ...option.values.map((value) => ({
                            value: value.value, label: value.label, title: value.description,
                          }))]}
                          onChange={(value) => void save.run(() => chooseOption(provider().id, option.id, value))} />
                      </SettingRow>
                    )
                  }}
                </For>
              </Show>
            )}
          </Show>
        </>
      }>
        <Text emphasis="muted" wrap>
          Uses the parent agent's harness, model, and effort at spawn time. When the spawn chooses another harness,
          or the parent runs in the terminal drawer, the child uses that harness's own model and effort defaults.
        </Text>
      </Show>
    </SettingsSection>
  )
}
