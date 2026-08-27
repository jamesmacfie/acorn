import { createResource, For, Show } from 'solid-js'
import { activeTaskId, hostCapabilities } from '@acorn/plugin-api/client'
import { workflowApi } from '../contract/workflowClient'
import { Alert, Button } from '@acorn/plugin-api/ui'

// Settings → Workflows (docs/workflows.md): a read-only inspector over the workflow definitions the
// active task's worktree loads, from `.acorn/workflows/*.toml` and ~/.acorn, plus any parse errors,
// so a malformed file surfaces instead of vanishing. Task-scoped through activeTaskId, like
// McpSettings. Launching a workflow happens in the command palette (⌘K).
export default function WorkflowsSettings() {
  const taskId = () => activeTaskId()

  const [data, { refetch }] = createResource(
    () => taskId() ?? 'no-task',
    async () => {
      const api = hostCapabilities().terminal
      const id = taskId()
      if (!api || !id) return { workflows: [], errors: [] }
      return workflowApi.defs(id)
    },
    { initialValue: { workflows: [], errors: [] } },
  )

  const workflows = () => data()?.workflows ?? []
  const errors = () => data()?.errors ?? []

  return (
    <div class="settings-section">
      <span class="muted settings-hint">
        Read-only view of the workflows the active task's worktree would load (`.acorn/workflows/*.toml` in the repo, plus `~/.acorn/workflows`). Launch one from the command palette (⌘K).
      </span>

      <Show when={workflows().length} fallback={<p class="muted">No workflows found{taskId() ? '' : ' — open a task to scan its worktree'}.</p>}>
        <For each={workflows()}>
          {(wf) => (
            <div class="settings-field">
              <span class="settings-label">
                {wf.name} <span class="muted">[{wf.source}]</span>
                <Show when={wf.posture === 'autonomous'}> <span class="muted">· autonomous</span></Show>
              </span>
              <span class="muted">
                {wf.steps.length} step{wf.steps.length === 1 ? '' : 's'}: {wf.steps.map((s) => (s.kind && s.kind !== 'agent' ? `${s.name} (${s.kind})` : s.name)).join(' → ')}
              </span>
            </div>
          )}
        </For>
      </Show>

      <Show when={errors().length}>
        <div class="settings-field">
          <span class="settings-label">Problems</span>
          <For each={errors()}>{(e) => <Alert tone="warn">{e.source}: {e.message}</Alert>}</For>
        </div>
      </Show>

      <div class="settings-actions">
        <Button onClick={() => void refetch()}>Rescan</Button>
      </div>
    </div>
  )
}
