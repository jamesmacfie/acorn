import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { activeTaskId, tasksOptions } from '@acorn/plugin-api/client'
import { Button, Field, Input, Modal, ModalActions, ModalBody, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { workflowApi } from '../workflowsClient'
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
  const inputs = () => props.request.inputs ?? []
  const [values, setValues] = createSignal<Record<string, string>>({
    ...Object.fromEntries(inputs().filter((input) => input.default).map((input) => [input.name, input.default!])),
    ...(props.request.prefill ?? {}),
  })
  const [taskId, setTaskId] = createSignal(props.request.taskId ?? activeTaskId() ?? '')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()

  const tasks = createQuery(() => tasksOptions(true))
  const choices = createMemo(() => (tasks.data ?? [])
    .filter((task) => task.status === 'active' && (!props.request.projectId || task.projectId === props.request.projectId))
    .map((task) => ({ value: task.id, label: task.title })))

  const missing = () => inputs().some((input) => input.required && !values()[input.name]?.trim())
  const ready = () => !!taskId() && !missing() && !busy()

  const start = async (): Promise<void> => {
    if (!ready()) return
    setBusy(true)
    setError(undefined)
    const filled = Object.fromEntries(Object.entries(values()).filter(([, value]) => value !== ''))
    const answer = await workflowApi.start(taskId(), { defId: props.request.defId }, Object.keys(filled).length ? filled : undefined)
    setBusy(false)
    if (answer.error) {
      setError(answer.error)
      return
    }
    closeWorkflowStart()
    if (answer.runId) props.request.onStarted?.(answer.runId)
  }

  return (
    <Modal onDismiss={closeWorkflowStart} title={`Run ${props.request.name}`} size="md">
      <ModalBody>
        <Stack gap="row">
          <Show when={error()}>{(message) => <Text tone="danger" wrap>{message()}</Text>}</Show>
          <Show when={!props.request.taskId}>
            <Field label="Task" hint="The run happens in this task's checkout." group>
              <Select
                size="sm"
                label="Task"
                value={taskId()}
                options={[{ value: '', label: 'Choose a task…' }, ...choices()]}
                onChange={setTaskId}
              />
            </Field>
          </Show>
          <For each={inputs()}>
            {(input) => (
              <Field
                label={input.required ? `${input.name} *` : input.name}
                hint={input.description}
                group
              >
                <Input
                  size="sm"
                  label={input.name}
                  value={values()[input.name] ?? ''}
                  invalid={!!input.required && !values()[input.name]?.trim()}
                  onInput={(value) => setValues((current) => ({ ...current, [input.name]: value }))}
                />
              </Field>
            )}
          </For>
          <Show when={!inputs().length}>
            <Text emphasis="muted" wrap>This workflow asks for nothing. Pick a task and run it.</Text>
          </Show>
        </Stack>
      </ModalBody>
      <ModalActions>
        <Button variant="bare" onPress={closeWorkflowStart}>Cancel</Button>
        <Button variant="solid" busy={busy()} disabled={!ready()} onPress={() => void start()}>Run</Button>
      </ModalActions>
    </Modal>
  )
}
