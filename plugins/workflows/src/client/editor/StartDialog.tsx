import { createMemo, createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { activeTaskId, tasksOptions } from '@acorn/plugin-api/client'
import { Button, Field, Modal, ModalActions, ModalBody, Select, Stack, Text } from '@acorn/plugin-api/ui'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import TypedValueField from './TypedValueField'
import { openWorkflowRun } from '../runs/runStore'
import { startWorkflow } from '../startWorkflow'
import { closeWorkflowStart, startRequest, type StartRequest } from './startRequest'

// "Run this workflow": one box per declared input, and a task to run it on.
//
// One dialog, one mount point. The editor's Run and the palette's "Run a workflow" both ask for it
// through ./startRequest.ts and the browse list draws it, because that region is on screen whenever
// the Workflows source is (../WorkflowsBrowse.tsx). A second mount would be a second dialog.

/** The one mount point. Draws nothing until something asks. */

export default function StartDialogHost() {
  return (
    <Show when={startRequest()}>
      {(pending) => <StartDialog request={pending()} />}
    </Show>
  )
}

function StartDialog(props: { request: StartRequest }) {
  const navigate = useNavigate()
  const inputs = () => props.request.inputs ?? []
  const [values, setValues] = createSignal<Record<string, DataValue>>({
    ...Object.fromEntries(inputs().filter((input) => input.default !== undefined).map((input) => [input.name, input.default!])),
    ...(props.request.prefill ?? {}),
  })
  const [taskId, setTaskId] = createSignal(props.request.taskId ?? activeTaskId() ?? '')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()
  const [invalid, setInvalid] = createSignal<Record<string, boolean>>({})

  const tasks = createQuery(() => tasksOptions(true))
  const choices = createMemo(() => (tasks.data ?? [])
    .filter((task) => task.status === 'active' && (!props.request.projectId || task.projectId === props.request.projectId))
    .map((task) => ({ value: task.id, label: task.title })))

  const missing = () => inputs().some((input) => input.required && values()[input.name] === undefined)
  const ready = () => !!taskId() && !missing() && !Object.values(invalid()).some(Boolean) && !busy()

  const start = async (): Promise<void> => {
    if (!ready()) return
    setBusy(true)
    setError(undefined)
    const filled = Object.fromEntries(Object.entries(values()).filter(([, value]) => value !== ''))
    const answer = await startWorkflow(taskId(), { defId: props.request.defId }, Object.keys(filled).length ? filled : undefined)
    setBusy(false)
    if (answer.error) {
      setError(answer.error)
      return
    }
    closeWorkflowStart()
    if (!answer.runId) return
    if (props.request.onStarted) return props.request.onStarted(answer.runId, taskId())
    const task = (tasks.data ?? []).find((candidate) => candidate.id === taskId())
    if (task) openWorkflowRun(task, answer.runId, navigate)
  }

  return (
    <Modal onDismiss={closeWorkflowStart} title={`Run ${props.request.name}`} size="md">
      <ModalBody>
        <Stack gap="row">
          <Show when={error()}>{(message) => <Text tone="danger" wrap>{message()}</Text>}</Show>
          <Show when={!props.request.taskId}>
            <Field label="Task" group>
              <Select
                label="Task"
                value={taskId()}
                options={[{ value: '', label: 'Choose a task…' }, ...choices()]}
                onChange={setTaskId}
              />
            </Field>
          </Show>
          <For each={inputs()}>
            {(input) => (
                <TypedValueField
                  label={input.required ? `${input.label ?? input.name} *` : input.label ?? input.name}
                  schema={input.schema}
                  hint={input.description}
                  value={values()[input.name]}
                  required={input.required}
                  onValidity={(valid) => setInvalid(current => ({ ...current, [input.name]: !valid }))}
                  onChange={(value) => setValues((current) => {
                    const next = { ...current }
                    if (value === undefined) delete next[input.name]
                    else next[input.name] = value
                    return next
                  })}
                />
            )}
          </For>
          <Show when={!inputs().length}>
            <Text emphasis="muted" wrap>This workflow needs no inputs.</Text>
          </Show>
        </Stack>
      </ModalBody>
      <ModalActions>
        <Button variant="ghost" onPress={closeWorkflowStart}>Cancel</Button>
        <Button variant="solid" busy={busy()} disabled={!ready()} onPress={() => void start()}>Run</Button>
      </ModalActions>
    </Modal>
  )
}
