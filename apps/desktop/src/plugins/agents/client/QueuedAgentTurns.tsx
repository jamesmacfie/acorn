import { createMemo, createSignal, For, Show } from 'solid-js'
import type { AgentTurn } from '../../../core/shared/managedAgents'
import Icon from '../../../core/client/ui/Icon'
import { Button, Textarea } from '../../../core/client/ui/primitives'
import { managedAgentApi } from './managedClient'

const promptText = (turn: AgentTurn): string =>
  turn.input.find((part) => part.type === 'text')?.text ?? ''

export default function QueuedAgentTurns(props: {
  sessionId: string
  turns: AgentTurn[]
  onChanged(): void | Promise<unknown>
  onError(message: string): void
}) {
  const queued = createMemo(() =>
    props.turns.filter((turn) => turn.status === 'queued').sort((a, b) => a.ordinal - b.ordinal))
  const [editing, setEditing] = createSignal<string | null>(null)
  const [text, setText] = createSignal('')
  const [pending, setPending] = createSignal<string | null>(null)

  const run = async (actionId: string, operation: () => Promise<unknown>): Promise<boolean> => {
    if (pending()) return false
    setPending(actionId)
    props.onError('')
    try {
      await operation()
      await props.onChanged()
      return true
    } catch (error) {
      props.onError(error instanceof Error ? error.message : 'Unable to update the queued turn.')
      return false
    } finally {
      setPending(null)
    }
  }

  const save = async (turn: AgentTurn) => {
    const next = text().trim()
    if (!next) return
    const withoutText = turn.input.filter((part) => part.type !== 'text')
    const saved = await run(`${turn.id}:save`, () => managedAgentApi.patchQueuedTurn(props.sessionId, turn.id, {
      input: [{ type: 'text', text: next }, ...withoutText],
    }))
    if (saved) setEditing(null)
  }

  return (
    <Show when={queued().length}>
      <section class="agent-queued-turns" aria-label="Queued follow-ups">
        <header><strong>Queued follow-ups</strong><span>{queued().length}</span></header>
        <For each={queued()}>
          {(turn, index) => (
            <div class="agent-queued-turn">
              <Show
                when={editing() === turn.id}
                fallback={<p>{promptText(turn) || `${turn.input.length} attached input item${turn.input.length === 1 ? '' : 's'}`}</p>}
              >
                <Textarea
                  value={text()}
                  onInput={(event) => setText(event.currentTarget.value)}
                  rows="2"
                  size="sm"
                />
              </Show>
              <div class="agent-queued-actions">
                <Show
                  when={editing() === turn.id}
                  fallback={
                    <Button
                      variant="bare"
                      size="sm"
                      iconOnly
                      title="Edit queued prompt"
                      aria-label="Edit queued prompt"
                      disabled={pending() != null}
                      onClick={() => {
                        setEditing(turn.id)
                        setText(promptText(turn))
                      }}
                    >
                      <Icon name="pencil" />
                    </Button>
                  }
                >
                  <Button
                    variant="bare"
                    tone="accent"
                    size="sm"
                    iconOnly
                    title="Save queued prompt"
                    aria-label="Save queued prompt"
                    busy={pending() === `${turn.id}:save`}
                    disabled={!text().trim() || pending() != null}
                    onClick={() => void save(turn)}
                  >
                    <Icon name="check" />
                  </Button>
                  <Button
                    variant="bare"
                    size="sm"
                    iconOnly
                    title="Cancel editing"
                    aria-label="Cancel editing"
                    disabled={pending() != null}
                    onClick={() => setEditing(null)}
                  >
                    <Icon name="x" />
                  </Button>
                </Show>
                <Button
                  variant="bare"
                  size="sm"
                  iconOnly
                  title="Move queued prompt up"
                  aria-label="Move queued turn up"
                  busy={pending() === `${turn.id}:up`}
                  disabled={index() === 0 || pending() != null}
                  onClick={() => void run(`${turn.id}:up`, () =>
                    managedAgentApi.patchQueuedTurn(props.sessionId, turn.id, { ordinal: index() - 1 }))}
                >
                  <Icon name="arrow-up" />
                </Button>
                <Button
                  variant="bare"
                  size="sm"
                  iconOnly
                  title="Move queued prompt down"
                  aria-label="Move queued turn down"
                  busy={pending() === `${turn.id}:down`}
                  disabled={index() === queued().length - 1 || pending() != null}
                  onClick={() => void run(`${turn.id}:down`, () =>
                    managedAgentApi.patchQueuedTurn(props.sessionId, turn.id, { ordinal: index() + 1 }))}
                >
                  <Icon name="arrow-down" />
                </Button>
                <Button
                  variant="bare"
                  tone="danger"
                  size="sm"
                  iconOnly
                  title="Remove queued prompt"
                  aria-label="Remove queued prompt"
                  busy={pending() === `${turn.id}:remove`}
                  disabled={pending() != null}
                  onClick={() => void run(`${turn.id}:remove`, () =>
                    managedAgentApi.removeQueuedTurn(props.sessionId, turn.id))}
                >
                  <Icon name="trash-2" />
                </Button>
              </div>
            </div>
          )}
        </For>
      </section>
    </Show>
  )
}
