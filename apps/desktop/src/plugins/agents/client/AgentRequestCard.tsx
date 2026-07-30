import { createEffect, createSignal, For, Show } from 'solid-js'
import type { AgentRequest } from '../../../core/shared/managedAgents'
import { Button, Input, Select } from '../../../core/client/ui/primitives'
import { managedAgentApi } from './managedClient'

export default function AgentRequestCard(props: {
  request: AgentRequest
  focused?: boolean
  onResolved?: () => void
}) {
  const [answers, setAnswers] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  let cardRef: HTMLElement | undefined
  const payload = () => props.request.payload
  const options = () => Array.isArray(payload().options)
    ? payload().options as Array<{ id: string; label: string; kind?: string }>
    : []
  const questions = () => Array.isArray(payload().questions)
    ? payload().questions as Array<{ id: string; header?: string; prompt: string; options?: Array<{ id: string; label: string }> }>
    : []

  createEffect(() => {
    if (!props.focused || !cardRef) return
    cardRef.scrollIntoView({ block: 'nearest' })
    cardRef.focus({ preventScroll: true })
  })

  async function resolve(resolution: unknown) {
    if (busy() || props.request.status !== 'pending') return
    setBusy(true)
    setError('')
    try {
      await managedAgentApi.resolve(props.request.sessionId, props.request.providerRequestId, resolution)
      props.onResolved?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to resolve this request.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      class="agent-request-card"
      classList={{ 'agent-request-focused': props.focused }}
      data-kind={props.request.kind}
      ref={cardRef}
      tabIndex={-1}
    >
      <div class="agent-request-kicker">{props.request.kind.replace('_', ' ')}</div>
      <Show when={props.request.status === 'resolving'}>
        <div class="muted">Response sent; waiting for the provider to acknowledge it…</div>
      </Show>
      <h4>{props.request.title}</h4>
      <Show when={props.request.detail}><p>{props.request.detail}</p></Show>
      <For each={questions()}>
        {(question) => (
          <label class="agent-question">
            <span>{question.header ? `${question.header}: ` : ''}{question.prompt}</span>
            <Show
              when={question.options?.length}
              fallback={
                <Input
                  type="text"
                  value={answers()[question.id] ?? ''}
                  onInput={(event) => setAnswers((current) => ({ ...current, [question.id]: event.currentTarget.value }))}
                />
              }
            >
              <Select
                value={answers()[question.id] ?? ''}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.currentTarget.value }))}
              >
                <option value="">Choose…</option>
                <For each={question.options}>{(option) => <option value={option.label}>{option.label}</option>}</For>
              </Select>
            </Show>
          </label>
        )}
      </For>
      <div class="agent-request-actions">
        <Show when={questions().length}>
          <Button disabled={busy() || props.request.status !== 'pending'} onClick={() => void resolve({ answers: answers() })}>
            Submit answers
          </Button>
        </Show>
        <For each={options()}>
          {(option) => (
            <Button
              tone={option.kind?.startsWith('reject') ? 'danger' : 'neutral'}
              classList={{ 'agent-request-reject': option.kind?.startsWith('reject') }}
              disabled={busy() || props.request.status !== 'pending'}
              onClick={() => void resolve({ optionId: option.id })}
            >
              {option.label}
            </Button>
          )}
        </For>
      </div>
      <Show when={error()}><p class="action-error" role="alert">{error()}</p></Show>
    </section>
  )
}
