import { createResource, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  activeNodeId,
  activeTaskId,
  createSettingSave,
  hasHostCapability,
  PrefKeys,
  prefsOptions,
  savePref,
} from '@acorn/plugin-api/client'
import { workflowApi } from './workflowsClient'
import { createCloneLaunchWorkflows } from './cloneLaunchWorkflows'
import { Alert, Button, EmptyState, Select, SettingRow, SettingsSection, Stack } from '@acorn/plugin-api/ui'

// Settings → Workflows (docs/workflows.md): a read-only inspector over the workflow definitions the
// active task's worktree loads, from `.acorn/workflows/*.toml` and ~/.acorn, plus any parse errors,
// so a malformed file surfaces instead of vanishing. Task-scoped through activeTaskId, like
// McpSettings. Launching a workflow happens in the command palette (⌘K). The sections match the ones
// the plugin's settings page declares for search.
export default function WorkflowsSettings() {
  return (
    <>
      <AfterCloneSettings />
      <LoadedWorkflows />
    </>
  )
}

// The workflow a clone form fills in to run after the clone (docs/workflows/starting-runs.md § After a
// clone). The form can change or clear it for each clone.
function AfterCloneSettings() {
  const cache = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const save = createSettingSave()
  const { workflows } = createCloneLaunchWorkflows(activeNodeId())
  const saved = () => prefs.data?.[PrefKeys.workflowsCloneDefault] ?? ''
  // A saved default that no longer resolves stays visible as missing, and the form doesn't fill it in.
  const missing = () => !!saved() && !workflows().some((entry) => entry.id === saved())
  return (
    <SettingsSection
      id="after-clone"
      label="After a clone"
      description="This runs on code you haven't reviewed. Pick a workflow that only reads it."
    >
      <SettingRow
        label="Then run"
        description="Filled into Clone from URL. Only workflows from ~/.acorn/workflows and ones saved here are offered, never one the repository ships."
        error={save.error()}
        savedAt={save.savedAt()}
      >
        <Select
          label="Then run"
          value={saved()}
          options={[
            { value: '', label: 'None' },
            ...workflows().map((entry) => ({ value: entry.id, label: entry.name })),
            ...(missing() ? [{ value: saved(), label: `${saved()} (missing)` }] : []),
          ]}
          onChange={(value) =>
            void save.run(() => savePref(cache, PrefKeys.workflowsCloneDefault, value, { throwOnFailure: true }))
          }
        />
      </SettingRow>
    </SettingsSection>
  )
}

function LoadedWorkflows() {
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
      actions={
        <Button size="sm" onPress={() => void refetch()}>
          Rescan
        </Button>
      }
    >
      <Show when={failure()}>{(message) => <Alert>{`Could not read the workflows: ${message()}`}</Alert>}</Show>
      <Show
        when={workflows().length}
        fallback={
          <EmptyState align="start" size="sm">
            {taskId() ? 'No workflows found.' : 'No workflows found. Open a task to check its worktree.'}
          </EmptyState>
        }
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
            <For each={errors()}>
              {(e) => (
                <Alert tone="warn">
                  {e.source}: {e.message}
                </Alert>
              )}
            </For>
          </Stack>
        </SettingRow>
      </Show>
    </SettingsSection>
  )
}
