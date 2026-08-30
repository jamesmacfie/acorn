import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createEffect, createSignal, Show } from 'solid-js'
import { Alert, Button, Field, Input, Stack, Text, Toolbar } from '@acorn/plugin-api/ui'
import { MAX_AGENT_CONCURRENCY, validateAgentConcurrency } from '../../shared/concurrency'
import {
  agentConcurrencyOptions,
  agentConcurrencyQueryKey,
  saveAgentConcurrency,
} from './concurrencyClient'

// Settings → Agent concurrency: the two ceilings the turn dispatcher counts against
// (docs/managed-agents.md § Operations and failure).
export default function AgentConcurrencySettings() {
  const queryClient = useQueryClient()
  const limits = createQuery(() => agentConcurrencyOptions())
  const [provider, setProvider] = createSignal('')
  const [workspace, setWorkspace] = createSignal('')
  const [dirty, setDirty] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')
  const [saved, setSaved] = createSignal('')

  // Seeded from the server value, but never over an edit in progress: this query refetches, and a
  // reseed mid-keystroke would take the field back to the stored number.
  createEffect(() => {
    const stored = limits.data
    if (!stored || dirty()) return
    setProvider(String(stored.provider))
    setWorkspace(String(stored.workspace))
  })

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setDirty(true)
    setSaved('')
    setError('')
  }

  // Button-only submit: this page has no <form>, so Enter in a field does not save.
  const submit = async () => {
    // The same validator the route runs, so a bad number is refused in the field rather than by a 400.
    const result = validateAgentConcurrency({
      provider: Number(provider()),
      workspace: Number(workspace()),
    })
    if (!result.ok) {
      setError(result.errors.join(' '))
      return
    }
    setSaving(true)
    setError('')
    try {
      const persisted = await saveAgentConcurrency(result.value)
      queryClient.setQueryData(agentConcurrencyQueryKey, persisted)
      setDirty(false)
      setSaved('Saved. Queued turns start as soon as there is room.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Agent concurrency could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack gap="section">
      <Text emphasis="muted" wrap>
        How many agent turns this Node runs at once. A session always runs one turn at a time, so
        these ceilings only decide how many sessions can be working together. Turns over a ceiling
        wait in the queue and start when there is room.
      </Text>

      <Show when={limits.error}>
        <Alert>
          {limits.error instanceof Error ? limits.error.message : 'Agent concurrency could not be loaded.'}
        </Alert>
      </Show>

      <Field
        label="Turns at once per provider"
        hint="Counted against one agent CLI across every task and workspace. This is what keeps a single provider account from running several turns at once."
      >
        <Input
          type="number"
          min="1"
          max={MAX_AGENT_CONCURRENCY}
          width="narrow"
          value={provider()}
          onInput={(value) => edit(setProvider)(value)}
        />
      </Field>

      <Field
        label="Turns at once per workspace"
        hint="Counted across all providers in one workspace, so one workspace cannot take the machine."
      >
        <Input
          type="number"
          min="1"
          max={MAX_AGENT_CONCURRENCY}
          width="narrow"
          value={workspace()}
          onInput={(value) => edit(setWorkspace)(value)}
        />
      </Field>

      <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show when={saved()}>{(message) => <Alert tone="ok">{message()}</Alert>}</Show>
      <Toolbar variant="actions">
        <Button disabled={!dirty() || saving()} onPress={() => void submit()}>
          {saving() ? 'Saving…' : 'Save limits'}
        </Button>
      </Toolbar>
    </Stack>
  )
}
