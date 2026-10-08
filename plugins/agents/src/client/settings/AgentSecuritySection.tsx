import { lazy } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createSettingSave, readJson, writeJson } from '@acorn/plugin-api/client'
import { Checkbox, SettingRow, SettingsSection } from '@acorn/plugin-api/ui'
import { agentSessionDefaultsRoute, type AgentSessionDefaults } from '../../shared/sessionDefaults'
import { agentSessionDefaultsQueryKey } from './sessionDefaultsClient'
import InstructionReviewPanel from './InstructionReviewPanel'
const SecurityDiagnosticsPanel = lazy(() => import('./SecurityDiagnosticsPanel'))

// This plugin's section of Settings > Security and backup, drawn in core's `core:security` point. The
// switches enable required checks in the managed-turn dispatcher on the selected Node.
// (../../server/sessions/instructionCheck.ts). The value is one field of the session defaults record,
// whose write route takes only a device, so an agent can't turn the check off.
//
// It follows the settings header's node switcher, so it reads and writes the named node's record
// directly. ./sessionDefaultsClient.ts always means the active node.

const LABEL = 'Check instruction files before each agent turn'

export default function AgentSecuritySection(props: { nodeId?: string | null }) {
  const queryClient = useQueryClient()
  const nodeId = () => props.nodeId ?? undefined
  const queryKey = () => [...agentSessionDefaultsQueryKey, 'node', props.nodeId ?? ''] as const
  const stored = createQuery(() => ({
    queryKey: queryKey(),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      readJson<AgentSessionDefaults>(agentSessionDefaultsRoute, { signal, nodeId: nodeId() }),
  }))
  const save = createSettingSave()

  const write = async (field: 'checkInstructionFiles' | 'reviewChangedInstructions', on: boolean) => {
    const saved = await writeJson<AgentSessionDefaults>(
      agentSessionDefaultsRoute,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: on }),
        nodeId: nodeId(),
      },
      (response) => `instruction setting ${response.status}`,
    )
    queryClient.setQueryData(queryKey(), saved)
    // The agents settings pages read the active node's copy of the same record.
    void queryClient.invalidateQueries({ queryKey: agentSessionDefaultsQueryKey })
  }

  return (
    <SettingsSection
      id="agent-instructions"
      label="Agent instruction files"
      help="Acorn checks discovered repository instructions and skills before a managed agent turn."
    >
      <SettingRow
        label={LABEL}
        description="If one holds hidden characters, the turn stops and says where they are."
        savedAt={save.savedAt()}
        // Until the node answers, the switch would show Off as a guess and a click would write it.
        error={save.error() ?? (stored.isError ? "Couldn't load this setting." : undefined)}
      >
        <Checkbox
          switch
          ariaLabel={LABEL}
          checked={stored.data?.checkInstructionFiles ?? false}
          disabled={!stored.isSuccess}
          onChange={(next) => save.run(() => write('checkInstructionFiles', next))}
        />
      </SettingRow>
      <SettingRow
        label="Review changed instruction files"
        description="Stop managed turns until you approve the current instruction and skill snapshot. Off by default."
        error={save.error() ?? (stored.isError ? "Couldn't load this setting." : undefined)}
      >
        <Checkbox switch ariaLabel="Review changed instruction files"
          checked={stored.data?.reviewChangedInstructions ?? false}
          disabled={!stored.isSuccess}
          onChange={(next) => save.run(() => write('reviewChangedInstructions', next))} />
      </SettingRow>
      <InstructionReviewPanel nodeId={props.nodeId} />
      <SecurityDiagnosticsPanel nodeId={props.nodeId} />
    </SettingsSection>
  )
}
