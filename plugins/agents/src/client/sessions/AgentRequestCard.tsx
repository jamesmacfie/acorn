import { createSignal, For, Show } from 'solid-js'
import type { AgentRequest } from '@acorn/protocol/managedAgents.ts'
import { Alert, Button, Card, Field, Heading, Inline, Input, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { managedAgentApi } from './managedClient'

// A question the harness is blocked on: a permission, a choice, a form. Drawn above the transcript
// rather than in it, because the session cannot move until it is answered.
export default function AgentRequestCard(props: {
  request: AgentRequest
  focused?: boolean
  onResolved?: () => void
}) {
  const [answers, setAnswers] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const payload = () => props.request.payload
  const options = () => Array.isArray(payload().options)
    ? payload().options as Array<{ id: string; label: string; kind?: string }>
    : []
  const questions = () => Array.isArray(payload().questions)
    ? payload().questions as Array<{ id: string; header?: string; prompt: string; options?: Array<{ id: string; label: string }> }>
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
                    value={answers()[question.id] ?? ''}
                    onInput={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
                  />
                }
              >
                <Select
                  label={question.prompt}
                  value={answers()[question.id] ?? ''}
                  onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
                  options={[
                    { value: '', label: 'Choose…' },
                    ...(question.options ?? []).map((option) => ({ value: option.label, label: option.label })),
                  ]}
                />
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
