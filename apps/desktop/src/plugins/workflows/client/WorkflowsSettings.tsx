import { createResource, For, Show } from 'solid-js'
import { activeTaskId } from '../../../core/client/tasks/tasks'
import { terminalApi } from '../../terminal/client/terminalClient'
import { workflowApi } from '../../agents/client/workflowClient'

// Settings → Workflows (docs/next 14): a read-only inspector over the committed/user workflow
// definitions the active task's worktree would load (`.acorn/workflows/*.toml` + ~/.acorn), plus
// any parse errors (the 13 §B DX rule — malformed files surface, never silently vanish). Mirrors
// McpSettings: task-scoped via activeTaskId, reuses the existing workflow:defs IPC as-is. Launch a
// workflow from the command palette (⌘K); this is the viewer, not a launcher.
export default function WorkflowsSettings() {
  const taskId = () => activeTaskId()

  const [data, { refetch }] = createResource(
    () => taskId() ?? 'no-task',
    async () => {
      const api = terminalApi()
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
          <For each={errors()}>{(e) => <span class="muted">⚠ {e.source}: {e.message}</span>}</For>
        </div>
      </Show>

      <div class="settings-actions">
        <button type="button" class="overlay-btn" onClick={() => void refetch()}>Rescan</button>
      </div>
    </div>
  )
}
