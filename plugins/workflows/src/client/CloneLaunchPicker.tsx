import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import {
  PrefKeys,
  prefsOptions,
  readJson,
  writeJson,
  type CloneFollowUpChoice,
  type CloneFollowUpPickerProps,
  type Task,
} from '@acorn/plugin-api/client'
import { Field, Select, Text } from '@acorn/plugin-api/ui'
import { tasksRoute } from '@acorn/protocol/api.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { WorkflowCloneLaunch } from '../contract/wire.ts'
import { cloneLaunchesRoute, cloneLaunchRoute, createCloneLaunchWorkflows } from './cloneLaunchWorkflows'
import TypedValueField from './editor/TypedValueField'
import { openWorkflowRun } from './runs/runStore'

// **Then run** in a clone form (docs/workflows/starting-runs.md § After a clone): a workflow the Node
// starts as the clone's first task. The Node does the launch, so closing the form doesn't stop it.

export default function CloneLaunchPicker(props: CloneFollowUpPickerProps) {
  const navigate = useNavigate()
  const prefs = createQuery(() => prefsOptions(true))
  const { target, workflows } = createCloneLaunchWorkflows(props.nodeId, () => props.workspaceId)
  // Undefined until picked, so the default fills in once the list arrives. A default that no longer
  // resolves isn't filled in.
  const [picked, setPicked] = createSignal<string>()
  const selectedId = () => {
    const id = picked() ?? prefs.data?.[PrefKeys.workflowsCloneDefault] ?? ''
    return workflows().some((entry) => entry.id === id) ? id : ''
  }
  const selected = createMemo(() => workflows().find((entry) => entry.id === selectedId()))
  const [values, setValues] = createSignal<Record<string, DataValue>>({})
  const [invalid, setInvalid] = createSignal<Record<string, boolean>>({})
  const inputs = () => selected()?.inputs ?? []
  const filled = () => ({
    ...Object.fromEntries(
      inputs().flatMap((input) => (input.default === undefined ? [] : [[input.name, input.default]])),
    ),
    ...values(),
  })
  const [stage, setStage] = createSignal('')
  // A launch that failed after its clone, so Retry starts the run on the same project and task.
  const [retry, setRetry] = createSignal<{ launchId: string; body: string } | null>(null)
  const following = new AbortController()
  onCleanup(() => following.abort())

  async function start(request: Parameters<CloneFollowUpChoice['start']>[0]) {
    const entry = selected()!
    const workspaceId = request.workspaceId ?? target()
    const launch = {
      clone: { ...request, ...(workspaceId ? { workspaceId } : {}) },
      defId: entry.id,
      inputs: filled(),
    }
    const body = JSON.stringify(launch)
    const launchId = retry()?.body === body ? retry()!.launchId : crypto.randomUUID()
    setRetry(null)
    try {
      setStage(`Cloning ${request.name}…`)
      let state = await writeJson<WorkflowCloneLaunch>(cloneLaunchesRoute, {
        method: 'POST',
        nodeId: props.nodeId,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...launch, launchId }),
      })
      while (state.stage === 'cloning' || state.stage === 'starting') {
        if (state.stage === 'starting') setStage(`Starting ${entry.name}…`)
        state = await readJson<WorkflowCloneLaunch>(`${cloneLaunchRoute(launchId)}?waitMs=20000`, {
          nodeId: props.nodeId,
          signal: following.signal,
          long: true,
        })
      }
      if (following.signal.aborted) return null
      if (state.stage === 'failed') {
        if (state.failedAt === 'starting') setRetry({ launchId, body })
        return {
          ok: false as const,
          error: state.failedAt === 'starting' ? `Cloned, but the workflow didn't start: ${state.error}` : state.error!,
        }
      }
      const tasks = await readJson<Task[]>(tasksRoute, { nodeId: props.nodeId })
      const task = tasks.find((candidate) => candidate.id === state.taskId)
      if (task) openWorkflowRun(task, state.runId!, navigate)
      return { ok: true as const, projectId: state.projectId! }
    } catch (cause) {
      if (following.signal.aborted) return null
      if ((cause as { status?: number }).status === 404)
        return {
          ok: false as const,
          error:
            "This Node lost track of the launch, perhaps in a restart. Check the project list, and start the workflow from the project's task.",
        }
      return { ok: false as const, error: cause instanceof Error ? cause.message : String(cause) }
    } finally {
      setStage('')
    }
  }

  createEffect(() => {
    const entry = selected()
    if (!entry) return props.onChange(null)
    props.onChange({
      label: retry() ? 'Retry' : 'Clone and run',
      ready:
        inputs().every((input) => !input.required || filled()[input.name] !== undefined) &&
        !Object.values(invalid()).some(Boolean),
      start,
    })
  })

  return (
    <Show when={workflows().length}>
      <Field label="Then run" hint="This runs on code you haven't reviewed. Pick a workflow that only reads it.">
        <Select
          label="Then run"
          disabled={props.disabled}
          value={selectedId()}
          options={[
            { value: '', label: 'None' },
            ...workflows().map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
          onChange={(id) => {
            setPicked(id)
            setValues({})
            setInvalid({})
            setRetry(null)
          }}
        />
      </Field>
      <For each={inputs()}>
        {(input) => (
          <TypedValueField
            label={input.required ? `${input.label ?? input.name} *` : (input.label ?? input.name)}
            schema={input.schema}
            required={input.required}
            hint={input.description}
            value={filled()[input.name]}
            disabled={props.disabled}
            onValidity={(valid) => setInvalid((current) => ({ ...current, [input.name]: !valid }))}
            onChange={(value) =>
              setValues((current) => {
                const next = { ...current }
                if (value === undefined) delete next[input.name]
                else next[input.name] = value
                return next
              })
            }
          />
        )}
      </For>
      <Show when={stage()}>
        <Text tone="muted">{stage()}</Text>
      </Show>
    </Show>
  )
}
