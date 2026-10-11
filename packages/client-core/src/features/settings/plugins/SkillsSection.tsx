import { For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { PluginSkillState } from '@acorn/protocol/api.ts'
import { readPluginSkills, setPluginSkillEnabled } from '../../../infra/node/nodePlugins'
import { reviewPendingTrust } from '../../../host/plugins/distribution'
import { Alert, Button, Checkbox } from '../../../kit/components/primitives'
import { Text } from '../../../kit/components/content/Text'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { createSettingSave } from '../settingSave'

// The procedures a loaded plugin supplies to agents (docs/managed-agents/skills.md § Skills). The Node
// holds the switches and the approvals, and says which harnesses each skill reached since it started.
// Read through the active Node's query cache, so another Node's answer is never shown as this one's.

// Versioned: the cache persists, and a later shape must not be read as this one.
const skillsKey = (pluginId: string) => ['plugin-skills', 'v1', pluginId] as const

type Skill = PluginSkillState['skills'][number]

const STATUS_TEXT: Record<Skill['status'], string> = {
  ready: 'Agents get it at their next start or resume.',
  disabled: 'Off. Sessions already running keep it until they restart.',
  unapproved: 'Waiting for your approval. Agents don’t get it until you approve it.',
  changed:
    'Its files changed since the Node started this plugin, so agents don’t get it. Reload or restart the plugin to review it.',
}

// Eligibility above, verified delivery here: only a start that succeeded is counted. A harness with its
// own skill support loads it natively; any other reads it from acorn's list.
const reached = (skill: Skill): string => {
  if (!skill.deliveries.length) return 'No session has started with it since the Node started.'
  const how = (delivery: Skill['deliveries'][number]) =>
    delivery.outcome === 'omitted'
      ? `Left out of a full list for ${delivery.harness}`
      : delivery.native
        ? `Loaded natively by ${delivery.harness}`
        : `Reached ${delivery.harness} through acorn’s list`
  return (
    skill.deliveries
      .map(
        (delivery) =>
          `${how(delivery)} at ${new Date(delivery.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      )
      .join('. ') + '.'
  )
}

export function SkillsSection(props: { pluginId: string }) {
  const qc = useQueryClient()
  const skills = createQuery(() => ({
    queryKey: skillsKey(props.pluginId),
    queryFn: ({ signal }: { signal?: AbortSignal }) => readPluginSkills(props.pluginId, signal),
    // Deliveries move as sessions start, so an open page keeps up.
    refetchInterval: 15_000,
  }))
  const save = createSettingSave()
  const setEnabled = (name: string, enabled: boolean) =>
    save.run(async () => {
      qc.setQueryData(skillsKey(props.pluginId), await setPluginSkillEnabled(props.pluginId, name, enabled))
    })

  return (
    <SettingsSection
      id="skills"
      label="Skills"
      description="Procedures your agents see by name and read when a task matches."
    >
      <Show when={skills.error}>
        <Alert tone="danger">Couldn't read this plugin's skills. {String(skills.error)}</Alert>
      </Show>
      <Show when={skills.data?.skills.some((skill) => skill.status === 'unapproved')}>
        <Alert
          tone="warn"
          variant="banner"
          actions={
            <Button size="sm" onPress={() => reviewPendingTrust(props.pluginId)}>
              Review…
            </Button>
          }
        >
          Some skills are waiting for your approval.
        </Alert>
      </Show>
      <For each={skills.data?.skills ?? []}>
        {(skill) => (
          <>
            <SettingRow
              label={skill.title}
              description={skill.description}
              error={save.error()}
              savedAt={save.savedAt()}
            >
              <Checkbox
                switch
                ariaLabel={`Give agents ${skill.title}`}
                checked={skill.enabled}
                onChange={(on) => void setEnabled(skill.name, on)}
              />
            </SettingRow>
            <Text tone="muted" wrap>{`${STATUS_TEXT[skill.status]} ${reached(skill)}`}</Text>
          </>
        )}
      </For>
    </SettingsSection>
  )
}
