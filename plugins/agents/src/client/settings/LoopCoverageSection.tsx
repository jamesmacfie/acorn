import { createResource, For, Show } from 'solid-js'
import { readJson } from '@acorn/plugin-api/client'
import { Alert, SettingRow, SettingsSection } from '@acorn/plugin-api/ui'
import type { AgentLoopCoverage } from '../../contract/loopHook.ts'

// This plugin's section of a plugin's page in Settings > Plugins, drawn in core's `core:plugin-page`
// point (docs/managed-agents/loop-hooks.md § Coverage). It says which harnesses the plugin's tool hooks
// reach, from what each harness reports, because a policy that sees every Claude Code tool call may
// see only the questions another harness asks. Nothing is drawn for a plugin with no tool hooks.

const BEFORE_TEXT: Record<AgentLoopCoverage['harnesses'][number]['beforeTool'], string> = {
  every: 'Every tool call',
  asked: 'Only the tool calls it asks you about',
  none: 'No tool calls',
}

const describe = (harness: AgentLoopCoverage['harnesses'][number]): string =>
  `${BEFORE_TEXT[harness.beforeTool]}${harness.afterTool ? ', and every tool result' : ''}.`

export default function LoopCoverageSection(props: { pluginId: string; nodeId?: string | null }) {
  const [coverage] = createResource(
    () => ({ pluginId: props.pluginId, nodeId: props.nodeId ?? undefined }),
    ({ pluginId, nodeId }) =>
      readJson<AgentLoopCoverage>(
        `/v1/p/agents/loop-coverage/${encodeURIComponent(pluginId)}`,
        nodeId ? { nodeId } : {},
      ),
  )
  return (
    <Show when={coverage.error || coverage()?.harnesses.length}>
      <SettingsSection
        id="agent-coverage"
        label="Agents it reaches"
        help="A harness acorn can bridge runs this plugin's tool rules on every call. Any other harness reaches them only when it asks you for permission. A rule added while a session runs reaches it after its next resume."
      >
        <Show when={coverage.error}>
          <Alert tone="danger">Couldn't read which agents this plugin reaches.</Alert>
        </Show>
        <For each={coverage()?.harnesses ?? []}>
          {(harness) => <SettingRow label={harness.label} description={describe(harness)} />}
        </For>
      </SettingsSection>
    </Show>
  )
}
