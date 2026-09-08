import { createResource, For, Show } from 'solid-js'
import { activeTaskId, hasHostCapability } from '@acorn/plugin-api/client'
import { workflowApi } from './workflowsClient'
import { Alert, Button, EmptyState, Field, Stack, Text, Toolbar } from '@acorn/plugin-api/ui'

// Settings → Workflows (docs/workflows.md): a read-only inspector over the workflow definitions the
// active task's worktree loads, from `.acorn/workflows/*.toml` and ~/.acorn, plus any parse errors,
// so a malformed file surfaces instead of vanishing. Task-scoped through activeTaskId, like
// McpSettings. Launching a workflow happens in the command palette (⌘K).
export default function WorkflowsSettings() {
  const taskId = () => activeTaskId()

  const [data, { refetch }] = createResource(
    () => taskId() ?? 'no-task',
    async () => {
      const api = hasHostCapability({ plugin: 'terminal' })
      const id = taskId()
      if (!api || !id) return { workflows: [], errors: [] }
      return workflowApi.defs(id)
    },
    { initialValue: { workflows: [], errors: [] } },
  )

  const workflows = () => data()?.workflows ?? []
  const errors = () => data()?.errors ?? []

  return (
    <Stack gap="section">
      <Text emphasis="muted" wrap>
        Read-only view of the workflows the active task's worktree would load (.acorn/workflows/*.toml
        in the repo, plus ~/.acorn/workflows). Launch one from the command palette (⌘K).
      </Text>
      <Text emphasis="muted" wrap>
        To write one, open Workflows in the left rail. That is where every workflow this workspace can
        run is listed, and where the editor is.
      </Text>

      <Show
        when={workflows().length}
        fallback={<EmptyState align="start">No workflows found{taskId() ? '' : ' — open a task to scan its worktree'}.</EmptyState>}
      >
        <Stack gap="row">
          <For each={workflows()}>
            {(wf) => (
              <Field
                group
                label={`${wf.name} [${wf.source}]${wf.posture === 'autonomous' ? ' · autonomous' : ''}`}
              >
                <Text emphasis="muted" wrap>
                  {wf.steps.length} step{wf.steps.length === 1 ? '' : 's'}: {wf.steps.map((s) => (s.kind && s.kind !== 'agent' ? `${s.name} (${s.kind})` : s.name)).join(' → ')}
                </Text>
              </Field>
            )}
          </For>
        </Stack>
      </Show>

      <Show when={errors().length}>
        <Field group label="Problems">
          <Stack gap="row">
            <For each={errors()}>{(e) => <Alert tone="warn">{e.source}: {e.message}</Alert>}</For>
          </Stack>
        </Field>
      </Show>

      <Toolbar variant="actions" size="sm">
        <Button size="sm" onPress={() => void refetch()}>Rescan</Button>
      </Toolbar>
    </Stack>
  )
}
