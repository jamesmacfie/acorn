import { createMemo, createSignal, Index, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createCredentialForm, integrationsOptions, modelBackendsOptions } from '@acorn/plugin-api/client'
import { integrationsKey, modelBackendsKey } from '@acorn/protocol/api.ts'
import type { PublicIntegrationProvider } from '@acorn/protocol/integrations.ts'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import { Alert, Badge, Button, Card, DescriptionList, Field, Heading, Inline, Input, Stack, Text } from '@acorn/plugin-api/ui'

// The AI branch of the wizard: what this machine can already generate with, and a form for a key if
// it can generate with nothing.
//
// It probes nothing itself. `GET /v1/core/models/backends` runs `which` per read, so mounting this
// step is the whole of the "detect at first load" behaviour — no boot work, and nothing to cache
// (docs/integrations/model-providers.md § Model providers).
//
// The step never blocks. Someone with no CLI and no key reads one line about where this lives in
// Settings and moves on, which is why there is no gate on the wizard's Next here. Generating text is
// a feature acorn has, not a step in setting it up.

/** The word beside a tool: a program already on this machine, or a key acorn holds. The step's
 *  intro already says what either is for. */
const readyWord = (backend: ModelBackend): string => (backend.kind === 'harness' ? 'Installed' : 'Connected')

export default function AiSetup() {
  const queryClient = useQueryClient()
  const status = createQuery(() => modelBackendsOptions(true))
  const integrations = createQuery(() => integrationsOptions(true))

  const backends = () => status.data?.backends ?? []
  // Every harness that offers a one-shot mode and is not on this machine. A row, not an error:
  // nothing is broken, a program is simply not installed here.
  const missing = () => status.data?.missing ?? []

  // Derived from the descriptors rather than named here. The plan called for an OpenAI card and an
  // Anthropic card, and both are model providers that ask for a typed key, so asking the registry
  // gives the same two cards without this plugin knowing either provider exists — and gives a third
  // for free the day someone contributes one.
  const keyProviders = createMemo(() => {
    const connected = integrations.data?.integrations ?? []
    const count = (providerId: string) => connected.filter((entry) => entry.providerId === providerId).length
    return (integrations.data?.providers ?? []).filter((provider) =>
      provider.kind === 'model-provider' &&
      provider.connection.connectable &&
      provider.connection.kind !== 'device-flow' &&
      (provider.connection.maxConnections === undefined || count(provider.id) < provider.connection.maxConnections),
    )
  })

  // Which card is open, by provider id rather than by descriptor: the integrations query refetches
  // after a key lands, and holding the object would leave the form pointed at a stale copy.
  const [openId, setOpenId] = createSignal('')
  const open = createMemo(() => keyProviders().find((provider) => provider.id === openId()))

  const form = createCredentialForm(open, async () => {
    setOpenId('')
    // Both, and the backends list matters more: it is what the rows above are drawn from, so without
    // it the key lands and the screen says nothing happened.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: integrationsKey }),
      queryClient.invalidateQueries({ queryKey: modelBackendsKey }),
    ])
  })

  const choose = (provider: PublicIntegrationProvider) => {
    setOpenId(provider.id)
    form.reset()
  }

  return (
    <Stack gap="row">
      <Heading level={2}>Generate with AI</Heading>
      <Text emphasis="muted" wrap>
        acorn can write commit messages, SQL queries, and workflows for you. It uses an AI tool already
        on this computer, or an API key you add here.
      </Text>

      {/* A list of facts, not cards: a card here looked exactly like the key cards below it, which
          can be pressed. Index, not For: this list refetches on a 30 second stale time, so every row
          would be a new object each time. */}
      <Show when={backends().length || missing().length}>
        <DescriptionList>
          <Index each={backends()}>
            {(backend) => (
              <DescriptionList.Item label={backend().label}>
                <Badge tone="ok">{readyWord(backend())}</Badge>
              </DescriptionList.Item>
            )}
          </Index>
          <Index each={missing()}>
            {(harness) => (
              <DescriptionList.Item label={harness().label}>
                <Badge>Not installed</Badge>
              </DescriptionList.Item>
            )}
          </Index>
        </DescriptionList>
      </Show>

      <Show when={!backends().length}>
        <Text emphasis="muted" wrap>
          {keyProviders().length
            ? 'No AI tools found on this computer. You can add a key below, or later in Settings under AI models.'
            : 'No AI tools found on this computer. You can add a key later in Settings under AI models.'}
        </Text>
      </Show>

      <Show when={keyProviders().length}>
        <Heading
          level={3}
          help="acorn stores the key on this computer and sends it only to the provider. Your agents never see it."
        >
          Add an API key
        </Heading>
        <Inline gap="stack" even>
          <Index each={keyProviders()}>
            {(provider) => (
              <Card interactive selected={openId() === provider().id} onPress={() => choose(provider())}>
                <Text emphasis="strong">{provider().label}</Text>
              </Card>
            )}
          </Index>
        </Inline>
      </Show>

      <Show when={open()}>
        {(provider) => (
          // `focus` scrolls the form into view as it opens. It opens below the cards, and without
          // this the press looked like it did nothing whenever the form landed under the fold.
          <Card focus>
            <Stack gap="row">
              <Text emphasis="strong">{`Connect ${provider().label}`}</Text>
              {/* Drawn from `connection.fields`, so nothing about either provider's credential is
                  written down here. The label, the placeholder, the hint and whether it is a password
                  are all the descriptor's. */}
              <Index each={form.fields()}>
                {(field) => (
                  <Field label={field().label} hint={field().hint}>
                    <Input
                      width="auto"
                      type={field().type}
                      placeholder={field().placeholder}
                      value={form.value(field().id)}
                      onInput={(value) => form.setValue(field().id, value)}
                      onSubmit={() => void form.submit()}
                    />
                  </Field>
                )}
              </Index>
              <Inline gap="inline">
                <Button
                  variant="solid"
                  tone="accent"
                  busy={form.busy()}
                  disabled={!form.complete()}
                  onPress={() => void form.submit()}
                >
                  Connect
                </Button>
                <Button variant="ghost" onPress={() => setOpenId('')}>Cancel</Button>
              </Inline>
              <Show when={form.error()}>{(text) => <Alert>{text()}</Alert>}</Show>
            </Stack>
          </Card>
        )}
      </Show>
    </Stack>
  )
}
