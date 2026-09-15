import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { claudePriceCatalog, codexPriceCatalog, type AgentPriceCatalogEntry } from '../../shared/pricing'
import {
  agentPricingOptions,
  agentPricingQueryKey,
  saveAgentPricing,
} from '../pricingClient'
import {
  blankAgentPriceDraft,
  preferencesFromPricingDraft,
  pricingDraftFromPreferences,
  type AgentPriceField,
  type AgentPricingDraft,
  type AgentPricingProvider,
} from './pricingDraft'
import { agentUsageStore } from '../usage/usageStore'
import {
  Alert, Button, Inline, Input, Section, Stack, Table, TableCell, TableHead, TableRow, Text, Toolbar,
} from '@acorn/plugin-api/ui'

const PRICE_FIELDS: Array<{ id: AgentPriceField; label: string }> = [
  { id: 'input', label: 'Input' },
  { id: 'output', label: 'Output' },
  { id: 'cacheWrite', label: 'Cache write' },
  { id: 'cacheRead', label: 'Cache read' },
]

const PROVIDERS: Array<{
  id: AgentPricingProvider
  label: string
  exactModelPlaceholder: string
  catalog: readonly AgentPriceCatalogEntry[]
}> = [
  { id: 'claude', label: 'Claude', exactModelPlaceholder: 'claude-new-model', catalog: claudePriceCatalog },
  { id: 'codex', label: 'Codex', exactModelPlaceholder: 'gpt-new-model', catalog: codexPriceCatalog },
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

  const updateCatalogPrice = (
    provider: AgentPricingProvider,
    catalogId: string,
    field: AgentPriceField,
    value: string,
  ) => {
    setDraft((current) => current ? {
      ...current,
      [provider]: {
        ...current[provider],
        catalog: current[provider].catalog.map((entry) => entry.catalogId === catalogId
          ? { ...entry, overridden: true, price: { ...entry.price, [field]: value } }
          : entry),
      },
    } : current)
    setDirty(true)
    setSaved('')
  }

  const resetCatalogPrice = (provider: AgentPricingProvider, catalogId: string) => {
    const definition = PROVIDERS.find((entry) => entry.id === provider)?.catalog
      .find((entry) => entry.id === catalogId)
    if (!definition) return
    const defaults = definition.defaultPrice(Date.now())
    setDraft((current) => current ? {
      ...current,
      [provider]: {
        ...current[provider],
        catalog: current[provider].catalog.map((entry) => entry.catalogId === catalogId
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
      },
    } : current)
    setDirty(true)
    setSaved('')
  }

  const updateCustom = (
    provider: AgentPricingProvider,
    id: string,
    update: { model: string } | { field: AgentPriceField; value: string },
  ) => {
    setDraft((current) => current ? {
      ...current,
      [provider]: {
        ...current[provider],
        customModels: current[provider].customModels.map((entry) => {
          if (entry.id !== id) return entry
          return 'model' in update
            ? { ...entry, model: update.model }
            : { ...entry, price: { ...entry.price, [update.field]: update.value } }
        }),
      },
    } : current)
    setDirty(true)
    setSaved('')
  }

  const addCustom = (provider: AgentPricingProvider, model = '') => {
    const normalized = model.toLowerCase()
    const current = draft()
    if (!current || current[provider].customModels.some((entry) => entry.model.toLowerCase() === normalized)) return
    setDraft({
      ...current,
      [provider]: {
        ...current[provider],
        customModels: [
          ...current[provider].customModels,
          { id: `new:${nextCustomId++}`, model, price: blankAgentPriceDraft() },
        ],
      },
    })
    setDirty(true)
    setSaved('')
  }

  const removeCustom = (provider: AgentPricingProvider, id: string) => {
    setDraft((current) => current
      ? {
          ...current,
          [provider]: {
            ...current[provider],
            customModels: current[provider].customModels.filter((entry) => entry.id !== id),
          },
        }
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
      (draft()?.claude.customModels ?? []).map((entry) => entry.model.trim().toLowerCase()),
    )
    return [...new Set(observed)].filter((model) => !configured.has(model.toLowerCase())).sort()
  })

  // Button-only submit: this page has no <form>, so Enter in a field does not save.
  const submit = async () => {
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
    <Stack gap="section">
      <Text emphasis="muted" wrap>
        These are estimated USD API prices per million tokens. They change Acorn’s estimates only;
        they do not change what a provider bills or how a subscription applies usage.
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
                <Button variant="bare" onPress={() => addCustom('claude', model)}>
                  Add <Text emphasis="mono">{model}</Text>
                </Button>
              )}
            </For>
          </Inline>
        </Section>
      </Show>

      <Show when={draft()}>
        {(current) => (
          <For each={PROVIDERS}>
            {(provider) => (
            <>
            <Section label={`Built-in ${provider.label} prices`}>
              <Table size="sm" minWidth={620}>
                <TableRow head>
                  <TableHead priority="high">Model</TableHead>
                  <For each={PRICE_FIELDS}>{(field) => <TableHead>{field.label}</TableHead>}</For>
                  <TableHead priority="low" />
                </TableRow>
                <For each={current()[provider.id].catalog}>
                  {(row) => {
                    const definition = provider.catalog.find((entry) => entry.id === row.catalogId)
                    return (
                      <TableRow>
                        <TableCell header>
                          <Text>{definition?.label ?? row.catalogId}</Text>
                          <Text emphasis="mono">{definition?.models}</Text>
                        </TableCell>
                        <For each={PRICE_FIELDS}>
                          {(field) => (
                            <TableCell>
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
                                onInput={(value) => updateCatalogPrice(provider.id, row.catalogId, field.id, value)}
                              />
                            </TableCell>
                          )}
                        </For>
                        <TableCell>
                          <Button
                            variant="bare"
                            disabled={!row.overridden}
                            onPress={() => resetCatalogPrice(provider.id, row.catalogId)}
                          >
                            Reset
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  }}
                </For>
              </Table>
            </Section>

            <Section
              label={`Exact ${provider.label} model prices`}
              actions={
                <Button
                  disabled={current()[provider.id].customModels.some((entry) => !entry.model.trim())}
                  onPress={() => addCustom(provider.id)}
                >
                  Add model
                </Button>
              }
            >
              <Stack gap="row">
                <Text emphasis="muted" wrap>
                  Add an exact model id when it is not in the built-in list. An exact entry takes
                  priority over a built-in price.
                </Text>
                <Show
                  when={current()[provider.id].customModels.length}
                  fallback={<Text emphasis="muted">No exact model prices.</Text>}
                >
                  <Table size="sm" minWidth={620}>
                    <TableRow head>
                      <TableHead priority="high">Exact model id</TableHead>
                      <For each={PRICE_FIELDS}>{(field) => <TableHead>{field.label}</TableHead>}</For>
                      <TableHead priority="low" />
                    </TableRow>
                    <For each={current()[provider.id].customModels}>
                      {(row) => (
                        <TableRow>
                          <TableCell header>
                            <Input
                              required
                              maxLength={200}
                              assist={false}
                              placeholder={provider.exactModelPlaceholder}
                              label={`Exact ${provider.label} model id`}
                              value={row.model}
                              onInput={(value) => updateCustom(provider.id, row.id, { model: value })}
                            />
                          </TableCell>
                          <For each={PRICE_FIELDS}>
                            {(field) => (
                              <TableCell>
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
                                  onInput={(value) => updateCustom(provider.id, row.id, { field: field.id, value })}
                                />
                              </TableCell>
                            )}
                          </For>
                          <TableCell>
                            <Button variant="bare" onPress={() => removeCustom(provider.id, row.id)}>Remove</Button>
                          </TableCell>
                        </TableRow>
                      )}
                    </For>
                  </Table>
                </Show>
              </Stack>
            </Section>
            </>
            )}
          </For>
        )}
      </Show>

      <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show when={saved()}>{(message) => <Alert tone="ok">{message()}</Alert>}</Show>
      <Toolbar variant="actions">
        <Button disabled={!dirty() || saving()} onPress={() => void submit()}>
          {saving() ? 'Saving…' : 'Save pricing'}
        </Button>
      </Toolbar>
    </Stack>
  )
}
