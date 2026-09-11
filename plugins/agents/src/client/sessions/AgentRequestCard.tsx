import { createSignal, For, Show } from 'solid-js'
import type { AgentRequest } from '@acorn/protocol/managedAgents.ts'
import { Alert, Button, Card, Checkbox, Field, Heading, Inline, Input, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { managedAgentApi } from './managedClient'

// A question the harness is blocked on: a permission, a choice, a form. Drawn in the transcript at the
// point the agent asked, by the card for its own `request` event (./AgentEventCard.tsx), so that
// answering it happens where the reader is already looking and the thread keeps the interruption in
// order. The task sidebar's "Needs you" list is how a reader reaches one in a session they are not on.
export default function AgentRequestCard(props: {
  request: AgentRequest
  focused?: boolean
  onResolved?: () => void
}) {
  // Answers are the option's label rather than its id, because that is what both harnesses record as
  // what the person said: Codex numbers its options positionally, so an id would reach the agent as "0".
  const [answers, setAnswers] = createSignal<Record<string, string | string[]>>({})
  const typed = (id: string): string => {
    const answer = answers()[id]
    return typeof answer === 'string' ? answer : ''
  }
  const ticked = (id: string): string[] => {
    const answer = answers()[id]
    return Array.isArray(answer) ? answer : []
  }
  const tick = (id: string, label: string, on: boolean): void => {
    setAnswers((current) => {
      const chosen = ticked(id)
      return { ...current, [id]: on ? [...chosen, label] : chosen.filter((value) => value !== label) }
    })
  }
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const payload = () => props.request.payload
  const options = () => Array.isArray(payload().options)
    ? payload().options as Array<{ id: string; label: string; kind?: string }>
    : []
  const questions = () => Array.isArray(payload().questions)
    ? payload().questions as Array<{
      id: string
      header?: string
      prompt: string
      multiple?: boolean
      options?: Array<{ id: string; label: string }>
    }>
    : []

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
    // The stripe carries "this is waiting on you" without a border colour the kit has no role for.
    // `focus` is how the notice that opened this pane lands the reader on the request it named.
    <Card stripe="warn" pad="sm" selected={props.focused} focus={props.focused ?? false}>
      <Stack gap="row">
        <Heading level={3} eyebrow={props.request.kind.replace('_', ' ')}>{props.request.title}</Heading>
        <Show when={props.request.status === 'resolving'}>
          <Text emphasis="muted" wrap>Response sent; waiting for the provider to acknowledge it…</Text>
        </Show>
        <Show when={props.request.detail}>{(detail) => <Text emphasis="muted" wrap>{detail()}</Text>}</Show>
        <For each={questions()}>
          {(question) => (
            <Field label={`${question.header ? `${question.header}: ` : ''}${question.prompt}`}>
              <Show
                when={question.options?.length}
                fallback={
                  <Input
                    value={typed(question.id)}
                    onInput={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
                  />
                }
              >
                <Show
                  when={question.multiple}
                  fallback={
                    <Select
                      label={question.prompt}
                      value={typed(question.id)}
                      onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
                      options={[
                        { value: '', label: 'Choose…' },
                        ...(question.options ?? []).map((option) => ({ value: option.label, label: option.label })),
                      ]}
                    />
                  }
                >
                  <Stack gap="row">
                    <For each={question.options ?? []}>
                      {(option) => (
                        <Checkbox
                          label={option.label}
                          checked={ticked(question.id).includes(option.label)}
                          onChange={(on) => tick(question.id, option.label, on)}
                        />
                      )}
                    </For>
                  </Stack>
                </Show>
              </Show>
            </Field>
          )}
        </For>
        <Inline wrap>
          <Show when={questions().length}>
            <Button
              disabled={busy() || props.request.status !== 'pending'}
              onPress={() => void resolve({ answers: answers() })}
            >
              Submit answers
            </Button>
          </Show>
          <For each={options()}>
            {(option) => (
              <Button
                tone={option.kind?.startsWith('reject') ? 'danger' : 'neutral'}
                disabled={busy() || props.request.status !== 'pending'}
                onPress={() => void resolve({ optionId: option.id })}
              >
                {option.label}
              </Button>
            )}
          </For>
        </Inline>
        <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      </Stack>
    </Card>
  )
}
