import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo, createSignal, For, Index, onMount, Show } from 'solid-js'
import {
  createSettingSave, createTextSetting, useUnsavedChanges, type SettingSave,
} from '@acorn/plugin-api/client'
import {
  claudePriceCatalog,
  codexPriceCatalog,
  type AgentPriceCatalogEntry,
  type AgentPricingPreferences,
} from '../../shared/pricing'
import {
  agentPricingOptions,
  agentPricingQueryKey,
  saveAgentPricing,
} from '../pricingClient'
import {
  blankAgentPriceDraft,
  preferencesFromPricingDraft,
  pricingDraftFromPreferences,
  type AgentPriceDraft,
  type AgentPriceField,
  type AgentPricingDraft,
  type AgentPricingProvider,
} from './pricingDraft'
import { agentUsageStore } from '../usage/usageStore'
import {
  Alert, Button, Inline, Input, SettingRow, SettingsSection, Stack, Table, TableCell, TableHead, TableRow, Text,
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

/** An exact model row that has not been stored: it needs a model id and all four prices before the
 *  route will take it, so it waits here until the last one is filled in. */
type PendingModel = { id: string; model: string; price: AgentPriceDraft; saving: boolean }

const complete = (row: PendingModel) =>
  !!row.model.trim() && PRICE_FIELDS.every((field) => row.price[field.id].trim() !== '')

// Settings → Agents → Limits and cost, the pricing sections. Every price saves when its field is
// committed, on blur or Enter. The route takes the whole pricing record, so each commit writes the
// stored record with that one change, and the writes run one after another so a second commit starts
// from what the first one stored. The sections match the ones `../index.ts` declares for search;
// ./AgentLimitsSettings.tsx puts them on the page after the concurrency ceilings.
export default function AgentPricingSettings() {
  const queryClient = useQueryClient()
  const pricing = createQuery(() => agentPricingOptions())
  const stored = createMemo(() => (pricing.data ? pricingDraftFromPreferences(pricing.data) : null))
  const [pending, setPending] = createSignal<Record<AgentPricingProvider, PendingModel[]>>({ claude: [], codex: [] })
  let nextPendingId = 0
  onMount(() => void agentUsageStore.ensure())

  // A half-typed exact model is the one thing on this page that nothing has written yet.
  useUnsavedChanges(() => Object.values(pending()).some((rows) =>
    rows.some((row) => row.model.trim() || Object.values(row.price).some((value) => value.trim()))))

  let queue: Promise<unknown> = Promise.resolve()
  const write = (change: (draft: AgentPricingDraft) => void): Promise<void> => {
    const run = queue.then(async () => {
      // The cache rather than the query's `data`, because the query hears about a write a tick later
      // and the next commit in the queue must build on the one before it.
      const latest = queryClient.getQueryData<AgentPricingPreferences>(agentPricingQueryKey) ?? pricing.data
      if (!latest) throw new Error('Agent pricing has not loaded.')
      const draft = pricingDraftFromPreferences(latest)
      change(draft)
      const result = preferencesFromPricingDraft(draft)
      if (!result.ok) throw new Error(result.errors.join(' '))
      queryClient.setQueryData(agentPricingQueryKey, await saveAgentPricing(result.value))
      void agentUsageStore.refresh()
    })
    queue = run.catch(() => {})
    return run
  }

  const tables = Object.fromEntries(PROVIDERS.map((provider) => [provider.id, {
    builtIn: createSettingSave(),
    exact: createSettingSave(),
  }])) as Record<AgentPricingProvider, { builtIn: SettingSave; exact: SettingSave }>

  const editPending = (provider: AgentPricingProvider, index: number, patch: Partial<PendingModel>) =>
    setPending((all) => ({ ...all, [provider]: all[provider].map((row, i) => (i === index ? { ...row, ...patch } : row)) }))

  const dropPending = (provider: AgentPricingProvider, id: string) =>
    setPending((all) => ({ ...all, [provider]: all[provider].filter((row) => row.id !== id) }))

  const addPending = (provider: AgentPricingProvider, model = '') => {
    const normalized = model.toLowerCase()
    const taken = [...(stored()?.[provider].customModels ?? []), ...pending()[provider]]
    if (taken.some((entry) => entry.model.toLowerCase() === normalized)) return
    setPending((all) => ({
      ...all,
      [provider]: [...all[provider], { id: `new:${nextPendingId++}`, model, price: blankAgentPriceDraft(), saving: false }],
    }))
  }

  // Stores an exact model once every field has something in it. Until then a commit says nothing,
  // because the person is still filling the row in.
  const storePending = async (provider: AgentPricingProvider, index: number) => {
    const row = pending()[provider][index]
    if (!row || row.saving || !complete(row)) return
    editPending(provider, index, { saving: true })
    const ok = await tables[provider].exact.run(() => write((draft) => {
      draft[provider].customModels.push({ id: row.id, model: row.model, price: row.price })
    }))
    if (ok) dropPending(provider, row.id)
    else setPending((all) => ({ ...all, [provider]: all[provider].map((each) => (each.id === row.id ? { ...each, saving: false } : each)) }))
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
      [...(stored()?.claude.customModels ?? []), ...pending().claude].map((entry) => entry.model.trim().toLowerCase()),
    )
    return [...new Set(observed)].filter((model) => !configured.has(model.toLowerCase())).sort()
  })

  return (
    <>
      <Show when={pricing.error}>
        <Alert>
          {pricing.error instanceof Error ? pricing.error.message : 'Agent pricing could not be loaded.'}
        </Alert>
      </Show>
      <Show when={!stored() && pricing.isPending}>
        <Text emphasis="muted">Loading prices…</Text>
      </Show>

      <Show when={unpricedModels().length}>
        <SettingsSection id="unpriced" label="Unpriced models" description="Models seen in recent Claude usage that have no price. Add one to give it an exact price under Claude prices.">
          <SettingRow label="Seen recently" layout="stacked">
            <Inline wrap>
              <For each={unpricedModels()}>
                {(model) => (
                  <Button variant="bare" onPress={() => addPending('claude', model)}>
                    Add <Text emphasis="mono">{model}</Text>
                  </Button>
                )}
              </For>
            </Inline>
          </SettingRow>
        </SettingsSection>
      </Show>

      <Show when={stored()}>
        {(current) => (
          <For each={PROVIDERS}>
            {(provider) => {
              const table = tables[provider.id]
              return (
                <SettingsSection
                  id={provider.id}
                  label={`${provider.label} prices`}
                  description="Estimated USD API prices per million tokens. They change Acorn's estimates only. They do not change what a provider bills or how a subscription applies usage."
                >
                  <SettingRow label="Built-in models" layout="stacked" savedAt={table.builtIn.savedAt()} error={table.builtIn.error()}>
                    <Table size="sm" minWidth={620}>
                      <TableRow head>
                        <TableHead priority="high">Model</TableHead>
                        <For each={PRICE_FIELDS}>{(field) => <TableHead>{field.label}</TableHead>}</For>
                        <TableHead priority="low" />
                      </TableRow>
                      {/* <Index>, not <For>: each save rebuilds the stored record, and <For> would remount
                          every row, dropping focus and whatever the next field holds. */}
                      <Index each={current()[provider.id].catalog}>
                        {(row) => {
                          const definition = () => provider.catalog.find((entry) => entry.id === row().catalogId)
                          const name = () => definition()?.label ?? row().catalogId
                          return (
                            <TableRow>
                              <TableCell header>
                                <Text>{name()}</Text>
                                <Text emphasis="mono">{definition()?.models}</Text>
                              </TableCell>
                              <For each={PRICE_FIELDS}>
                                {(field) => (
                                  <TableCell>
                                    <PriceField
                                      label={`${name()} ${field.label}`}
                                      value={row().price[field.id]}
                                      table={table.builtIn}
                                      save={(value) => {
                                        const catalogId = row().catalogId
                                        return write((draft) => {
                                          const entry = draft[provider.id].catalog.find((each) => each.catalogId === catalogId)
                                          if (!entry) throw new Error(`${name()} is no longer a built-in model.`)
                                          entry.overridden = true
                                          entry.price[field.id] = value
                                        })
                                      }}
                                    />
                                  </TableCell>
                                )}
                              </For>
                              <TableCell>
                                <Button
                                  variant="bare"
                                  disabled={!row().overridden}
                                  onPress={() => {
                                    const catalogId = row().catalogId
                                    void table.builtIn.run(() => write((draft) => {
                                      const entry = draft[provider.id].catalog.find((each) => each.catalogId === catalogId)
                                      if (entry) entry.overridden = false
                                    }))
                                  }}
                                >
                                  Reset
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        }}
                      </Index>
                    </Table>
                  </SettingRow>

                  <SettingRow
                    label="Exact model ids"
                    description="For a model that is not in the built-in list. An exact entry takes priority over a built-in price."
                    layout="stacked"
                    savedAt={table.exact.savedAt()}
                    error={table.exact.error()}
                  >
                    <Stack gap="row">
                      <Show
                        when={current()[provider.id].customModels.length || pending()[provider.id].length}
                        fallback={<Text emphasis="muted">No exact model prices.</Text>}
                      >
                        <Table size="sm" minWidth={620}>
                          <TableRow head>
                            <TableHead priority="high">Exact model id</TableHead>
                            <For each={PRICE_FIELDS}>{(field) => <TableHead>{field.label}</TableHead>}</For>
                            <TableHead priority="low" />
                          </TableRow>
                          <Index each={current()[provider.id].customModels}>
                            {(row) => {
                              // Found by the model id it was stored under, because an edit to the id itself changes it.
                              const edit = (change: (entry: AgentPricingDraft[AgentPricingProvider]['customModels'][number]) => void) => {
                                const model = row().model
                                return write((draft) => {
                                  const entry = draft[provider.id].customModels.find((each) => each.model === model)
                                  if (!entry) throw new Error(`${model} is no longer in the list.`)
                                  change(entry)
                                })
                              }
                              return (
                                // Keyed by the entry, so a field's kept draft never outlives its row: after a Remove above it,
                                // this slot holds the next model, and a blur must not write the old text into that one.
                                <Show when={row().id} keyed>
                                  {(_entry) => (
                                    <TableRow>
                                      <TableCell header>
                                        <PriceField
                                          text
                                          placeholder={provider.exactModelPlaceholder}
                                          label={`Exact ${provider.label} model id`}
                                          value={row().model}
                                          table={table.exact}
                                          save={(value) => edit((entry) => { entry.model = value })}
                                        />
                                      </TableCell>
                                      <For each={PRICE_FIELDS}>
                                        {(field) => (
                                          <TableCell>
                                            <PriceField
                                              label={`${row().model} ${field.label}`}
                                              value={row().price[field.id]}
                                              table={table.exact}
                                              save={(value) => edit((entry) => { entry.price[field.id] = value })}
                                            />
                                          </TableCell>
                                        )}
                                      </For>
                                      <TableCell>
                                        <Button
                                          variant="bare"
                                          onPress={() => {
                                            const model = row().model
                                            void table.exact.run(() => write((draft) => {
                                              draft[provider.id].customModels = draft[provider.id].customModels.filter((each) => each.model !== model)
                                            }))
                                          }}
                                        >
                                          Remove
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </Show>
                              )
                            }}
                          </Index>
                          <Index each={pending()[provider.id]}>
                            {(row, index) => (
                              <TableRow>
                                <TableCell header>
                                  <Input
                                    required
                                    maxLength={200}
                                    assist={false}
                                    placeholder={provider.exactModelPlaceholder}
                                    label={`Exact ${provider.label} model id`}
                                    value={row().model}
                                    onInput={(model) => editPending(provider.id, index, { model })}
                                    onChange={() => void storePending(provider.id, index)}
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
                                        label={`${row().model || 'Custom model'} ${field.label}`}
                                        value={row().price[field.id]}
                                        onInput={(value) => editPending(provider.id, index, { price: { ...row().price, [field.id]: value } })}
                                        onChange={() => void storePending(provider.id, index)}
                                      />
                                    </TableCell>
                                  )}
                                </For>
                                <TableCell>
                                  <Button variant="bare" onPress={() => dropPending(provider.id, row().id)}>Remove</Button>
                                </TableCell>
                              </TableRow>
                            )}
                          </Index>
                        </Table>
                      </Show>
                      <Inline>
                        <Button
                          disabled={pending()[provider.id].some((entry) => !entry.model.trim())}
                          onPress={() => addPending(provider.id)}
                        >
                          Add model
                        </Button>
                      </Inline>
                    </Stack>
                  </SettingRow>
                </SettingsSection>
              )
            }}
          </For>
        )}
      </Show>
    </>
  )
}

/** One cell of a price table on the text save model. The table's row carries **Saved** and the error,
 *  because a cell has no room for either; the cell keeps a refused value and marks itself invalid. */
function PriceField(props: {
  label: string
  value: string
  table: SettingSave
  save: (value: string) => Promise<void>
  /** A model id rather than a price. */
  text?: boolean
  placeholder?: string
}) {
  const field = createTextSetting({
    value: () => props.value,
    save: async (value) => {
      if (!(await props.table.run(() => props.save(value)))) throw new Error(props.table.error())
    },
  })
  return (
    <Show
      when={props.text}
      fallback={
        <Input
          type="number"
          min="0"
          max="1000000"
          step="0.01"
          required
          width="narrow"
          size="sm"
          label={props.label}
          invalid={!!field.error()}
          value={field.value()}
          onInput={field.input}
          onChange={(value) => void field.commit(value)}
        />
      }
    >
      <Input
        required
        maxLength={200}
        assist={false}
        placeholder={props.placeholder}
        label={props.label}
        invalid={!!field.error()}
        value={field.value()}
        onInput={field.input}
        onChange={(value) => void field.commit(value)}
      />
    </Show>
  )
}
