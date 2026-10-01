import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { Show } from 'solid-js'
import { createTextSetting } from '@acorn/plugin-api/client'
import { Alert, Input, SettingRow, SettingsSection } from '@acorn/plugin-api/ui'
import {
  defaultAgentConcurrency,
  MAX_AGENT_CONCURRENCY,
  validateAgentConcurrency,
  type AgentConcurrencyLimits,
} from '../../shared/concurrency'
import {
  agentConcurrencyOptions,
  agentConcurrencyQueryKey,
  saveAgentConcurrency,
} from './concurrencyClient'

// Settings → Agents → Limits and cost, its first section: the two ceilings the turn dispatcher counts
// against (docs/managed-agents.md § Operations and failure). Each field saves on its own, on blur or
// Enter, with the other ceiling as stored. The section matches the one `../index.ts` declares for
// search; ./AgentLimitsSettings.tsx puts it on the page.
export default function AgentConcurrencySettings() {
  const queryClient = useQueryClient()
  const limits = createQuery(() => agentConcurrencyOptions())

  const ceiling = (key: keyof AgentConcurrencyLimits) => createTextSetting({
    value: () => (limits.data ? String(limits.data[key]) : ''),
    save: async (value) => {
      const stored = limits.data
      if (!stored) throw new Error('Agent concurrency has not loaded.')
      // The same validator the route runs, so a bad number is refused beside the field rather than
      // by a 400, and the field keeps what was typed.
      const result = validateAgentConcurrency({ ...stored, [key]: Number(value) })
      if (!result.ok) throw new Error(result.errors.join(' '))
      queryClient.setQueryData(agentConcurrencyQueryKey, await saveAgentConcurrency(result.value))
    },
  })
  const provider = ceiling('provider')
  const workspace = ceiling('workspace')
  // The built-in ceilings are what the node runs on with nothing stored, so Reset goes back to them.
  const defaults = defaultAgentConcurrency()
  const reset = (key: keyof AgentConcurrencyLimits, field: typeof provider) =>
    limits.data && limits.data[key] !== defaults[key] ? () => void field.commit(String(defaults[key])) : undefined

  return (
    <>
      <Show when={limits.error}>
        <Alert>
          {limits.error instanceof Error ? limits.error.message : 'Agent concurrency could not be loaded.'}
        </Alert>
      </Show>
      <SettingsSection
        id="limits"
        label="Turns at once"
        help="How many agents can work at the same time on this node. Extra work waits in line and starts when there's room."
      >
        <SettingRow
          label="Turns at once per provider"
          description="For each agent CLI, such as Claude Code, across all tasks."
          savedAt={provider.savedAt()}
          error={provider.error()}
          onReset={reset('provider', provider)}
        >
          <Input
            type="number"
            min="1"
            max={MAX_AGENT_CONCURRENCY}
            width="narrow"
            label="Turns at once per provider"
            disabled={!limits.data}
            value={provider.value()}
            onInput={provider.input}
            onChange={(value) => void provider.commit(value)}
          />
        </SettingRow>
        <SettingRow
          label="Turns at once per workspace"
          description="For each workspace, across all agent CLIs."
          savedAt={workspace.savedAt()}
          error={workspace.error()}
          onReset={reset('workspace', workspace)}
        >
          <Input
            type="number"
            min="1"
            max={MAX_AGENT_CONCURRENCY}
            width="narrow"
            label="Turns at once per workspace"
            disabled={!limits.data}
            value={workspace.value()}
            onInput={workspace.input}
            onChange={(value) => void workspace.commit(value)}
          />
        </SettingRow>
      </SettingsSection>
    </>
  )
}
