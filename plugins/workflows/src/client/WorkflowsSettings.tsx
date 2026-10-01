import { createResource, createSignal, For, Show } from 'solid-js'
import { activeTaskId, hasHostCapability } from '@acorn/plugin-api/client'
import { workflowApi } from './workflowsClient'
import { Alert, Button, EmptyState, SettingRow, SettingsSection, Stack } from '@acorn/plugin-api/ui'

// Settings → Workflows (docs/workflows.md): a read-only inspector over the workflow definitions the
// active task's worktree loads, from `.acorn/workflows/*.toml` and ~/.acorn, plus any parse errors,
// so a malformed file surfaces instead of vanishing. Task-scoped through activeTaskId, like
// McpSettings. Launching a workflow happens in the command palette (⌘K). One section, matching the
// one `./index.ts` declares for search; each definition is a row whose label is the workflow.
export default function WorkflowsSettings() {
  const taskId = () => activeTaskId()

  const [failure, setFailure] = createSignal('')
  const [data, { refetch }] = createResource(
    () => taskId() ?? 'no-task',
    async () => {
      const api = hasHostCapability({ plugin: 'terminal' })
      const id = taskId()
      if (!api || !id) return { workflows: [], errors: [] }
      // Caught, so a failed Rescan says so here instead of taking the page down.
      setFailure('')
      try {
        return await workflowApi.defs(id)
      } catch (cause) {
        setFailure(cause instanceof Error ? cause.message : String(cause))
        return { workflows: [], errors: [] }
      }
    },
    { initialValue: { workflows: [], errors: [] } },
  )

  const workflows = () => data()?.workflows ?? []
  const errors = () => data()?.errors ?? []

  return (
    <SettingsSection
      id="loaded"
      label="Loaded workflows"
      description="Workflows the open task can run, and any that failed to load."
      help="acorn reads .acorn/workflows in the repo and ~/.acorn/workflows. To write or edit one, open Workflows in the left rail. To run one, use the command palette."
      actions={<Button size="sm" onPress={() => void refetch()}>Rescan</Button>}
    >
      <Show when={failure()}>{(message) => <Alert>{`Could not read the workflows: ${message()}`}</Alert>}</Show>
      <Show
        when={workflows().length}
        fallback={<EmptyState align="start" size="sm">{taskId() ? 'No workflows found.' : 'No workflows found. Open a task to check its worktree.'}</EmptyState>}
      >
        <For each={workflows()}>
          {(wf) => (
            <SettingRow
              label={`${wf.name} [${wf.source}]${wf.posture === 'autonomous' ? ' · autonomous' : ''}`}
              description={`${wf.steps.length} step${wf.steps.length === 1 ? '' : 's'}: ${wf.steps.map((s) => (s.kind && s.kind !== 'agent' ? `${s.name} (${s.kind})` : s.name)).join(' → ')}`}
            />
          )}
        </For>
      </Show>

      <Show when={errors().length}>
        <SettingRow label="Problems" layout="stacked">
          <Stack gap="row">
            <For each={errors()}>{(e) => <Alert tone="warn">{e.source}: {e.message}</Alert>}</For>
          </Stack>
        </SettingRow>
      </Show>
    </SettingsSection>
  )
}
