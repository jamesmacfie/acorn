import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { claudePriceCatalog } from '../../shared/pricing'
import {
  agentPricingOptions,
  agentPricingQueryKey,
  saveAgentPricing,
} from './pricingClient'
import {
  blankAgentPriceDraft,
  preferencesFromPricingDraft,
  pricingDraftFromPreferences,
  type AgentPriceField,
  type AgentPricingDraft,
} from './pricingDraft'
import { agentUsageStore } from '../usage/usageStore'
import { Alert, Button, Inline, Input, Section, Stack, Table, Text, Toolbar } from '@acorn/plugin-api/ui'

const PRICE_FIELDS: Array<{ id: AgentPriceField; label: string }> = [
  { id: 'input', label: 'Input' },
  { id: 'output', label: 'Output' },
  { id: 'cacheWrite', label: 'Cache write' },
  { id: 'cacheRead', label: 'Cache read' },
]

export default function AgentPricingSettings() {
  const queryClient = useQueryClient()
  const pricing = createQuery(() => agentPricingOptions())
  const [draft, setDraft] = createSignal<AgentPricingDraft | null>(null)
  const [dirty, setDirty] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')
  const [saved, setSaved] = createSignal('')
  let nextCustomId = 0

  createEffect(() => {
    if (!draft() && pricing.data) setDraft(pricingDraftFromPreferences(pricing.data))
  })
  onMount(() => void agentUsageStore.ensure())

  const updateCatalogPrice = (catalogId: string, field: AgentPriceField, value: string) => {
    setDraft((current) => current ? {
      ...current,
      catalog: current.catalog.map((entry) => entry.catalogId === catalogId
        ? { ...entry, overridden: true, price: { ...entry.price, [field]: value } }
        : entry),
    } : current)
    setDirty(true)
    setSaved('')
  }

  const resetCatalogPrice = (catalogId: string) => {
    const definition = claudePriceCatalog.find((entry) => entry.id === catalogId)
    if (!definition) return
    const defaults = definition.defaultPrice(Date.now())
    setDraft((current) => current ? {
      ...current,
      catalog: current.catalog.map((entry) => entry.catalogId === catalogId
        ? {
            ...entry,
            overridden: false,
            price: {
              input: String(defaults.input),
              output: String(defaults.output),
              cacheWrite: String(defaults.cacheWrite),
              cacheRead: String(defaults.cacheRead),
            },
          }
        : entry),
    } : current)
    setDirty(true)
    setSaved('')
  }

  const updateCustom = (
    id: string,
    update: { model: string } | { field: AgentPriceField; value: string },
  ) => {
    setDraft((current) => current ? {
      ...current,
      customModels: current.customModels.map((entry) => {
        if (entry.id !== id) return entry
        return 'model' in update
          ? { ...entry, model: update.model }
          : { ...entry, price: { ...entry.price, [update.field]: update.value } }
      }),
    } : current)
    setDirty(true)
    setSaved('')
  }

  const addCustom = (model = '') => {
    const normalized = model.toLowerCase()
    const current = draft()
    if (!current || current.customModels.some((entry) => entry.model.toLowerCase() === normalized)) return
    setDraft({
      ...current,
      customModels: [
        ...current.customModels,
        { id: `new:${nextCustomId++}`, model, price: blankAgentPriceDraft() },
      ],
    })
    setDirty(true)
    setSaved('')
  }

  const removeCustom = (id: string) => {
    setDraft((current) => current
      ? { ...current, customModels: current.customModels.filter((entry) => entry.id !== id) }
      : current)
    setDirty(true)
    setSaved('')
  }

  const unpricedModels = createMemo(() => {
    // The one `'claude'` left on the client, and it is not a branch on a closed harness set. The whole
    // pricing table is Anthropic's model catalogue (shared/pricing.ts) and the preferences it edits are
    // keyed `claude`, so the id names the pricing namespace rather than the harness.
    const claude = agentUsageStore.snapshot()?.providers.find((provider) => provider.provider === 'claude')
    const observed = [
      ...(claude?.daily?.today.unpricedModels ?? []),
      ...(claude?.daily?.yesterday?.unpricedModels ?? []),
    ]
    const configured = new Set(
      (draft()?.customModels ?? []).map((entry) => entry.model.trim().toLowerCase()),
    )
    return [...new Set(observed)].filter((model) => !configured.has(model.toLowerCase())).sort()
  })

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const current = draft()
    if (!current || saving()) return
    const result = preferencesFromPricingDraft(current)
    if (!result.ok) {
      setError(result.errors.join(' '))
      return
    }
    setSaving(true)
    setError('')
    setSaved('')
    try {
      const persisted = await saveAgentPricing(result.value)
      queryClient.setQueryData(agentPricingQueryKey, persisted)
      setDraft(pricingDraftFromPreferences(persisted))
      setDirty(false)
      setSaved('Saved. Refreshing the estimate…')
      void agentUsageStore.refresh().then(() => setSaved('Saved. Estimate refreshed.'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Agent pricing could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="section">
        <Text emphasis="muted" wrap>
          These are estimated USD prices per million tokens for local Claude usage. They change
          Acorn’s estimate only; they do not change what a provider bills. Codex does not currently
          expose the token history needed for a local cost estimate.
        </Text>

        <Show when={pricing.error}>
          <Alert>
            {pricing.error instanceof Error ? pricing.error.message : 'Agent pricing could not be loaded.'}
          </Alert>
        </Show>
        <Show when={!draft() && pricing.isPending}>
          <Text emphasis="muted">Loading prices…</Text>
        </Show>

        <Show when={unpricedModels().length}>
          <Section label="Unpriced models seen recently">
            <Inline wrap>
              <For each={unpricedModels()}>
                {(model) => (
                  <Button variant="bare" onPress={() => addCustom(model)}>
                    Add <Text emphasis="mono">{model}</Text>
                  </Button>
                )}
              </For>
            </Inline>
          </Section>
        </Show>

        <Show when={draft()}>
          {(current) => (
            <>
              <Section label="Built-in Claude prices">
                <Table size="sm" minWidth={620}>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <For each={PRICE_FIELDS}>{(field) => <th>{field.label}</th>}</For>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    <For each={current().catalog}>
                      {(row) => {
                        const definition = claudePriceCatalog.find((entry) => entry.id === row.catalogId)
                        return (
                          <tr>
                            <th>
                              <Text>{definition?.label ?? row.catalogId}</Text>
                              <Text emphasis="mono">{definition?.models}</Text>
                            </th>
                            <For each={PRICE_FIELDS}>
                              {(field) => (
                                <td>
                                  <Input
                                    type="number"
                                    min="0"
                                    max="1000000"
                                    step="0.01"
                                    required
                                    width="narrow"
                                    size="sm"
                                    label={`${definition?.label ?? row.catalogId} ${field.label}`}
                                    value={row.price[field.id]}
                                    onInput={(value) => updateCatalogPrice(row.catalogId, field.id, value)}
                                  />
                                </td>
                              )}
                            </For>
                            <td>
                              <Button
                                variant="bare"
                                disabled={!row.overridden}
                                onPress={() => resetCatalogPrice(row.catalogId)}
                              >
                                Reset
                              </Button>
                            </td>
                          </tr>
                        )
                      }}
                    </For>
                  </tbody>
                </Table>
              </Section>

              <Section
                label="Exact model prices"
                actions={
                  <Button
                    disabled={current().customModels.some((entry) => !entry.model.trim())}
                    onPress={() => addCustom()}
                  >
                    Add model
                  </Button>
                }
              >
                <Stack gap="row">
                  <Text emphasis="muted" wrap>
                    Add the exact model id from Claude’s usage history when a new model is not in the
                    built-in list. An exact entry takes priority over a built-in price.
                  </Text>
                  <Show
                    when={current().customModels.length}
                    fallback={<Text emphasis="muted">No exact model prices.</Text>}
                  >
                    <Table size="sm" minWidth={620}>
                      <thead>
                        <tr>
                          <th>Exact model id</th>
                          <For each={PRICE_FIELDS}>{(field) => <th>{field.label}</th>}</For>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        <For each={current().customModels}>
                          {(row) => (
                            <tr>
                              <th>
                                <Input
                                  required
                                  maxLength={200}
                                  assist={false}
                                  placeholder="claude-new-model"
                                  label="Exact Claude model id"
                                  value={row.model}
                                  onInput={(value) => updateCustom(row.id, { model: value })}
                                />
                              </th>
                              <For each={PRICE_FIELDS}>
                                {(field) => (
                                  <td>
                                    <Input
                                      type="number"
                                      min="0"
                                      max="1000000"
                                      step="0.01"
                                      required
                                      width="narrow"
                                      size="sm"
                                      label={`${row.model || 'Custom model'} ${field.label}`}
                                      value={row.price[field.id]}
                                      onInput={(value) => updateCustom(row.id, { field: field.id, value })}
                                    />
                                  </td>
                                )}
                              </For>
                              <td>
                                <Button variant="bare" onPress={() => removeCustom(row.id)}>Remove</Button>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </Table>
                  </Show>
                </Stack>
              </Section>
            </>
          )}
        </Show>

        <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
        <Show when={saved()}>{(message) => <Alert tone="ok">{message()}</Alert>}</Show>
        <Toolbar variant="actions">
          <Button submit disabled={!dirty() || saving()}>
            {saving() ? 'Saving…' : 'Save pricing'}
          </Button>
        </Toolbar>
      </Stack>
    </form>
  )
}
