import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { Alert, Button, Checkbox, Modal, Stack } from '@acorn/plugin-api/ui'

export default function AgentContextPickerModal(props: {
  contribution: AgentContextContribution
  taskId: string
  initialSelectedIds: readonly string[]
  attaching: boolean
  onAttach(optionIds: readonly string[]): void
  onClose(): void
}) {
  const [options] = createResource(
    () => `${props.taskId}:${props.contribution.id}`,
    () => props.contribution.options({ taskId: props.taskId }),
  )
  const [selected, setSelected] = createSignal<Set<string>>(new Set(), { equals: false })
  let initialized = false

  createEffect(() => {
    const available = options()
    if (!available || initialized) return
    initialized = true
    const availableIds = new Set(available.map((option) => option.id))
    const restored = props.initialSelectedIds.filter((id) => availableIds.has(id))
    setSelected(new Set(restored.length
      ? restored
      : available.filter((option) => option.defaultSelected).map((option) => option.id)))
  })

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <Modal
      title={`Add ${props.contribution.label}`}
      size="md"
      align="center"
      onDismiss={props.onClose}
    >
      <Modal.Body>
        <p class="muted">{props.contribution.description}</p>
        <Show when={!options.loading} fallback={<p class="muted">Loading available context…</p>}>
          <Show
            when={!options.error}
            fallback={<Alert>Unable to load available context.</Alert>}
          >
            <Stack gap="row">
              <For
                each={options() ?? []}
                fallback={<p class="muted agent-context-option-empty">Nothing is currently available from this source.</p>}
              >
                {(option) => (
                  <Checkbox
                    checked={selected().has(option.id)}
                    onChange={() => toggle(option.id)}
                    label={
                      <>
                        <strong>{option.label}</strong>
                        <Show when={option.description}><small>{option.description}</small></Show>
                      </>
                    }
                  />
                )}
              </For>
            </Stack>
          </Show>
        </Show>
      </Modal.Body>
      <Modal.Actions>
        <Button variant="ghost" onPress={props.onClose}>Cancel</Button>
        <Button
          variant="solid"
          tone="accent"
          busy={props.attaching}
          disabled={options.loading || !!options.error || selected().size === 0}
          onPress={() => props.onAttach([...selected()])}
        >
          Attach
        </Button>
      </Modal.Actions>
    </Modal>
  )
}
