import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { Button } from '../../../core/client/ui/primitives'
import { Modal } from '../../../core/client/ui/Modal'

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
      onClose={props.onClose}
    >
      <Modal.Body class="agent-context-option-modal">
        <p class="muted">{props.contribution.description}</p>
        <Show when={!options.loading} fallback={<p class="muted">Loading available context…</p>}>
          <Show
            when={!options.error}
            fallback={<p class="action-error" role="alert">Unable to load available context.</p>}
          >
            <div class="agent-context-option-list">
              <For
                each={options() ?? []}
                fallback={<p class="muted agent-context-option-empty">Nothing is currently available from this source.</p>}
              >
                {(option) => (
                  <label class="agent-context-option">
                    <input
                      type="checkbox"
                      checked={selected().has(option.id)}
                      onChange={() => toggle(option.id)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <Show when={option.description}><small>{option.description}</small></Show>
                    </span>
                  </label>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Modal.Body>
      <Modal.Actions>
        <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
        <Button
          variant="solid"
          tone="accent"
          busy={props.attaching}
          disabled={options.loading || !!options.error || selected().size === 0}
          onClick={() => props.onAttach([...selected()])}
        >
          Attach
        </Button>
      </Modal.Actions>
    </Modal>
  )
}
