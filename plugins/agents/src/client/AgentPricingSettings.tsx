import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { claudePriceCatalog } from '../shared/pricing'
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
import { agentUsageStore } from './usageStore'
import { Button, Table } from '@acorn/plugin-api/ui'
import './agent-pricing.css'

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
    <form class="settings-section agent-pricing-settings" onSubmit={submit}>
      <p class="muted settings-hint">
        These are estimated USD prices per million tokens for local Claude usage. They change
        Acorn’s estimate only; they do not change what a provider bills. Codex does not currently
        expose the token history needed for a local cost estimate.
      </p>

      <Show when={pricing.error}>
        <p class="settings-error" role="alert">
          {pricing.error instanceof Error ? pricing.error.message : 'Agent pricing could not be loaded.'}
        </p>
      </Show>
      <Show when={!draft() && pricing.isPending}>
        <p class="muted">Loading prices…</p>
      </Show>

      <Show when={unpricedModels().length}>
        <div class="agent-pricing-unpriced">
          <span class="settings-label">Unpriced models seen recently</span>
          <For each={unpricedModels()}>
            {(model) => (
              <Button variant="bare" class="agent-pricing-model-add" onClick={() => addCustom(model)}>
                Add <code>{model}</code>
              </Button>
            )}
          </For>
        </div>
      </Show>

      <Show when={draft()}>
        {(current) => (
          <>
            <section>
              <h3 class="settings-section-label agent-pricing-heading">Built-in Claude prices</h3>
              <Table class="agent-pricing-table" size="sm" minWidth={620}>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <For each={PRICE_FIELDS}>{(field) => <th>{field.label}</th>}</For>
                      <th><span class="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={current().catalog}>
                      {(row) => {
                        const definition = claudePriceCatalog.find((entry) => entry.id === row.catalogId)
                        return (
                          <tr>
                            <th>
                              <span>{definition?.label ?? row.catalogId}</span>
                              <code>{definition?.models}</code>
                            </th>
                            <For each={PRICE_FIELDS}>
                              {(field) => (
                                <td>
                                  <input
                                    class="ui-input agent-pricing-rate"
                                    type="number"
                                    min="0"
                                    max="1000000"
                                    step="0.01"
                                    required
                                    aria-label={`${definition?.label ?? row.catalogId} ${field.label}`}
                                    value={row.price[field.id]}
                                    onInput={(event) => updateCatalogPrice(
                                      row.catalogId,
                                      field.id,
                                      event.currentTarget.value,
                                    )}
                                  />
                                </td>
                              )}
                            </For>
                            <td>
                              <Button
                                variant="bare" class="agent-pricing-reset"
                                disabled={!row.overridden}
                                onClick={() => resetCatalogPrice(row.catalogId)}
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
            </section>

            <section>
              <div class="agent-pricing-custom-head">
                <h3 class="settings-section-label agent-pricing-heading">Exact model prices</h3>
                <Button
                  disabled={current().customModels.some((entry) => !entry.model.trim())}
                  onClick={() => addCustom()}
                >
                  Add model
                </Button>
              </div>
              <p class="muted settings-hint">
                Add the exact model id from Claude’s usage history when a new model is not in the
                built-in list. An exact entry takes priority over a built-in price.
              </p>
              <Show
                when={current().customModels.length}
                fallback={<p class="muted agent-pricing-empty">No exact model prices.</p>}
              >
                <Table class="agent-pricing-table" size="sm" minWidth={620}>
                    <thead>
                      <tr>
                        <th>Exact model id</th>
                        <For each={PRICE_FIELDS}>{(field) => <th>{field.label}</th>}</For>
                        <th><span class="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={current().customModels}>
                        {(row) => (
                          <tr>
                            <th>
                              <input
                                class="ui-input agent-pricing-model"
                                required
                                maxlength="200"
                                placeholder="claude-new-model"
                                aria-label="Exact Claude model id"
                                value={row.model}
                                onInput={(event) => updateCustom(row.id, { model: event.currentTarget.value })}
                              />
                            </th>
                            <For each={PRICE_FIELDS}>
                              {(field) => (
                                <td>
                                  <input
                                    class="ui-input agent-pricing-rate"
                                    type="number"
                                    min="0"
                                    max="1000000"
                                    step="0.01"
                                    required
                                    aria-label={`${row.model || 'Custom model'} ${field.label}`}
                                    value={row.price[field.id]}
                                    onInput={(event) => updateCustom(row.id, {
                                      field: field.id,
                                      value: event.currentTarget.value,
                                    })}
                                  />
                                </td>
                              )}
                            </For>
                            <td>
                              <Button
                                variant="bare" class="agent-pricing-remove"
                                onClick={() => removeCustom(row.id)}
                              >
                                Remove
                              </Button>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                </Table>
              </Show>
            </section>
          </>
        )}
      </Show>

      <Show when={error()}><p class="settings-error" role="alert">{error()}</p></Show>
      <Show when={saved()}><p class="muted agent-pricing-saved" role="status">{saved()}</p></Show>
      <div class="settings-actions">
        <Button type="submit" disabled={!dirty() || saving()}>
          {saving() ? 'Saving…' : 'Save pricing'}
        </Button>
      </div>
    </form>
  )
}
