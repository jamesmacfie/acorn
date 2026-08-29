import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { AgentRuntimeState, AgentTurn } from '@acorn/protocol/managedAgents.ts'
import { Button, Icon, Textarea } from '@acorn/plugin-api/ui'
import { clientEvents } from '@acorn/plugin-api/client'
import { agentConcurrencyOptions } from './concurrencyClient'
import { managedAgentApi } from './managedClient'

const promptText = (turn: AgentTurn): string =>
  turn.input.find((part) => part.type === 'text')?.text ?? ''

export default function QueuedAgentTurns(props: {
  sessionId: string
  runtimeState: AgentRuntimeState
  turns: AgentTurn[]
  onChanged(): void | Promise<unknown>
  onError(message: string): void
}) {
  const queued = createMemo(() =>
    props.turns.filter((turn) => turn.status === 'queued').sort((a, b) => a.ordinal - b.ordinal))
  const [editing, setEditing] = createSignal<string | null>(null)
  const [text, setText] = createSignal('')
  const [pending, setPending] = createSignal<string | null>(null)
  // A ready session with a queued turn is the dispatcher's concurrency ceilings holding it, which is
  // the one wait with no other sign of itself: the transcript is empty and the session reads as idle.
  const blockedByLimits = createMemo(() => props.runtimeState === 'ready')
  const limits = createQuery(() => ({ ...agentConcurrencyOptions(), enabled: blockedByLimits() }))

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
        <p class="agent-queued-reason">
          <Show
            when={blockedByLimits()}
            fallback={props.runtimeState === 'working' || props.runtimeState === 'waiting'
              ? 'Sends when the current turn finishes.'
              : 'Sends when the provider is ready.'}
          >
            <span>
              Waiting for a free slot. This Node runs {limits.data?.provider ?? 2} turns at once per
              provider and {limits.data?.workspace ?? 3} per workspace.
            </span>
            <Button
              variant="bare"
              size="sm"
              onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'agent-concurrency' })}
            >
              Change
            </Button>
          </Show>
        </p>
        <For each={queued()}>
          {(turn, index) => (
            <div class="agent-queued-turn">
              <Show
                when={editing() === turn.id}
                fallback={<p>{promptText(turn) || `${turn.input.length} attached input item${turn.input.length === 1 ? '' : 's'}`}</p>}
              >
                <Textarea
                  value={text()}
                  onInput={(value) => setText(value)}
                  rows={2}
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
                      label="Edit queued prompt"
                      disabled={pending() != null}
                      onPress={() => {
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
                    label="Save queued prompt"
                    busy={pending() === `${turn.id}:save`}
                    disabled={!text().trim() || pending() != null}
                    onPress={() => void save(turn)}
                  >
                    <Icon name="check" />
                  </Button>
                  <Button
                    variant="bare"
                    size="sm"
                    iconOnly
                    title="Cancel editing"
                    label="Cancel editing"
                    disabled={pending() != null}
                    onPress={() => setEditing(null)}
                  >
                    <Icon name="x" />
                  </Button>
                </Show>
                <Button
                  variant="bare"
                  size="sm"
                  iconOnly
                  title="Move queued prompt up"
                  label="Move queued turn up"
                  busy={pending() === `${turn.id}:up`}
                  disabled={index() === 0 || pending() != null}
                  onPress={() => void run(`${turn.id}:up`, () =>
                    managedAgentApi.patchQueuedTurn(props.sessionId, turn.id, { ordinal: index() - 1 }))}
                >
                  <Icon name="arrow-up" />
                </Button>
                <Button
                  variant="bare"
                  size="sm"
                  iconOnly
                  title="Move queued prompt down"
                  label="Move queued turn down"
                  busy={pending() === `${turn.id}:down`}
                  disabled={index() === queued().length - 1 || pending() != null}
                  onPress={() => void run(`${turn.id}:down`, () =>
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
                  label="Remove queued prompt"
                  busy={pending() === `${turn.id}:remove`}
                  disabled={pending() != null}
                  onPress={() => void run(`${turn.id}:remove`, () =>
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
