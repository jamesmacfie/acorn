import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { panelPlanSchema, type DashboardDraft, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { DataSourceDescription, DataSourceScope } from '@acorn/protocol/dataSources.ts'
import { describePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { formatRelativeTime } from '@acorn/dashboards-core/relativeTime.ts'
import { activeCacheId } from '../../../infra/node/activeNode'
import { integrationsOptions, modelBackendsOptions, prefsOptions } from '../../../infra/queries'
import { dataSourceCatalogOptions, dataSourceQueryKey, dataSourceQueryOptions } from '../../dataSources/queries'
import {
  defaultInputBindings, inputProviderLabel, inputSourceOf, sourceEntries, sourceKey, sourceReference, unboundInputs, usableConnections, type SourceEntry,
} from '../../dataSources/sourceEntries'
import InputAccountField from '../../dataSources/InputAccountField'
import { queriesClient, queriesKey } from '../../queries/queriesClient'
import { effectiveModelPick, readGeneratePick, saveGeneratePick, type ModelPick } from '../../settings/models/generatePick'
import ModelBackendPicker from '../../settings/models/ModelBackendPicker'
import { Alert, Button, Chip, ConfirmButton, Field, Input, Row, SectionHeader } from '../../../kit/components/primitives'
import { Composer } from '../../../kit/components/inputs/Composer'
import { Inline } from '../../../kit/components/layout/Inline'
import { Rows } from '../../../kit/components/layout/Rows'
import { Stack } from '../../../kit/components/layout/Stack'
import { Text } from '../../../kit/components/content/Text'
import { Modal } from '../../../kit/components/overlays/Modal'
import { dashboardClient, dashboardDraftsKey } from '../dashboardClient'
import { unpublishedDashboards } from '../dashboardEditorModel'
import { dashboardRecoveryStore } from '../dashboardRecovery'
import { regionAllowsSource, type PanelRegion } from '../region'
import { checkedStarters } from './inspectors'

// The Add panel launcher: one small screen that asks what the panel should show
// (docs/dashboards/mapping-and-editor.md § The generated editor). A request starts the AI, a source
// with an optional starter fills the studio in, and unfinished drafts are listed openly rather than
// reopened. The host opens the studio with whichever the person chose.

export type LaunchResult =
  | { kind: 'describe'; request: string }
  | { kind: 'source'; reference: QueryReference; starter?: PanelPlan }
  | { kind: 'draft'; dashboardId: string }

const SUGGESTIONS = 4
const DRAFTS_SHOWN = 3
const BLANK = 'blank'

/** The describe request for a source row's query, or undefined for a saved query. */
const describeRequest = (reference: QueryReference | undefined) => reference?.kind === 'inline'
  ? { operation: 'describe' as const, source: reference.content.query.source, scope: reference.content.query.scope }
  : undefined

export default function PanelLauncher(props: {
  workspaceId: string
  /** A plugin's region the panel will show in, which limits the sources offered. */
  region?: PanelRegion
  onLaunch: (result: LaunchResult) => void
  onDismiss: () => void
}) {
  const nodeId = activeCacheId()
  const queryClient = useQueryClient()
  const scope = { workspaceId: props.workspaceId }
  const client = dashboardClient(nodeId, scope)
  const baseScope: DataSourceScope = { ...scope, parameters: {} }
  const [problem, setProblem] = createSignal<string>()

  // ── Describe ─────────────────────────────────────────────────────────────────────────────────
  const [request, setRequest] = createSignal('')
  const backends = createQuery(() => modelBackendsOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const [choice, setChoice] = createSignal<ModelPick | null>(null)
  const pick = createMemo(() => choice() ?? effectiveModelPick(backends.data?.backends ?? [], readGeneratePick(prefs.data)))

  // ── Start from data ──────────────────────────────────────────────────────────────────────────
  const catalog = createQuery(() => dataSourceCatalogOptions(nodeId, baseScope))
  // Refetched when the window regains focus, so an account connected in a browser shows up in the
  // input pickers without a reload.
  const integrations = createQuery(() => ({ ...integrationsOptions(true), refetchOnWindowFocus: 'always' as const }))
  const library = createQuery(() => ({ queryKey: queriesKey(nodeId, scope), queryFn: ({ signal }: { signal: AbortSignal }) => queriesClient(nodeId, scope).list(signal) }))
  const entries = createMemo(() => sourceEntries({
    sources: catalog.data?.sources ?? [], connections: integrations.data?.integrations ?? [], saved: library.data ?? [], byAccount: true,
  }).filter(entry => !props.region || regionAllowsSource(props.region, sourceKey(entry.kind === 'saved' ? entry.query.content.query.source : entry.source))))
  const [search, setSearch] = createSignal('')
  const shown = createMemo(() => entries().filter(entry => entry.label.toLowerCase().includes(search().trim().toLowerCase())))
  const referenceFor = (entry: SourceEntry, inputs?: DataSourceScope['inputs']): QueryReference => entry.kind === 'saved'
    ? { kind: 'saved', queryId: entry.query.id, bindings: {} }
    : sourceReference(entry.source, { ...baseScope, ...(entry.connectionId ? { connectionId: entry.connectionId } : {}), ...(inputs ? { inputs } : {}) })

  /** Starter titles from sources this session has already described, because the catalog carries no
   *  starters. Read once per list, so the chips don't move while the person reads them. */
  const suggestions = createMemo(() => [...new Set(entries().flatMap(entry => {
    const described = describeRequest(referenceFor(entry))
    const description = described && queryClient.getQueryData<DataSourceDescription>(dataSourceQueryKey(nodeId, described))
    return (JSON.parse(JSON.stringify(description?.starterPlans ?? [])) as unknown[]).flatMap(candidate => {
      const parsed = panelPlanSchema.safeParse(candidate)
      return parsed.success ? [parsed.data.title] : []
    })
  }))].slice(0, SUGGESTIONS))

  const [picked, setPicked] = createSignal<SourceEntry>()
  /** A picked derived source's input bindings, one account per input. */
  const [inputBindings, setInputBindings] = createSignal<DataSourceScope['inputs']>()
  const pickedReference = createMemo(() => picked() && referenceFor(picked()!, inputBindings()))
  const pickedSource = () => { const entry = picked(); return entry?.kind === 'source' ? entry.source : undefined }
  /** Required inputs still waiting for an account. Starters stay disabled until there are none. */
  const unbound = createMemo(() => unboundInputs(pickedSource(), { ...baseScope, ...(inputBindings() ? { inputs: inputBindings() } : {}) }, catalog.data?.sources ?? []))
  const bindInput = (name: string, connectionId: string | undefined): void => {
    const { [name]: _previous, ...others } = inputBindings() ?? {}
    setInputBindings(connectionId ? { ...others, [name]: { connectionId, parameters: {} } } : others)
  }
  const description = createQuery(() => {
    const described = describeRequest(pickedReference())
    return { ...dataSourceQueryOptions(nodeId, described ?? { operation: 'describe', source: { pluginId: 'unavailable', sourceId: 'unavailable' }, scope: baseScope }), enabled: !!described }
  })
  const [starters] = createResource(
    () => description.data && pickedReference()?.kind === 'inline' ? { described: description.data, reference: pickedReference() as Extract<QueryReference, { kind: 'inline' }> } : undefined,
    ({ described, reference }) => checkedStarters(described, reference.content.query, plan => client.validate(plan)),
  )
  const choose = (id: string): void => {
    const entry = entries().find(candidate => candidate.id === id)
    if (!entry) return
    // A saved query has no starters of its own, so it opens straight away.
    if (entry.kind === 'saved') props.onLaunch({ kind: 'source', reference: referenceFor(entry) })
    else {
      setInputBindings(defaultInputBindings(entry.source, catalog.data?.sources ?? [], integrations.data?.integrations ?? []))
      setPicked(entry)
    }
  }
  const startFrom = (key: string): void => {
    const reference = pickedReference()
    if (!reference || unbound().length) return
    const starter = key === BLANK ? undefined : starters()?.[Number(key)]
    props.onLaunch({ kind: 'source', reference, ...(starter ? { starter } : {}) })
  }
  const starterRows = () => [
    ...(starters() ?? []).map((starter, index) => ({ key: String(index), label: starter.title, detail: describePanelPlan(starter)[0], disabled: unbound().length > 0 })),
    { key: BLANK, label: 'Blank', detail: 'Start with the source and its main fields.', disabled: unbound().length > 0 },
  ]

  // ── Drafts ───────────────────────────────────────────────────────────────────────────────────
  const drafts = createQuery(() => ({ queryKey: dashboardDraftsKey(nodeId, scope), queryFn: ({ signal }: { signal: AbortSignal }) => client.list(signal), staleTime: 0 }))
  const unfinished = createMemo(() => unpublishedDashboards(drafts.data ?? []))
  const [allDrafts, setAllDrafts] = createSignal(false)
  const discard = async (draft: DashboardDraft): Promise<void> => {
    try {
      await client.delete(draft.id, draft.draftRevision)
      dashboardRecoveryStore(typeof localStorage === 'undefined' ? undefined : localStorage).discard(nodeId, draft.id)
      await drafts.refetch()
    } catch { setProblem(`Couldn't discard ${draft.content.title}.`) }
  }

  return (
    <Modal title="Add panel" size="lg" onDismiss={props.onDismiss}>
      <Modal.Body><Stack gap="stack">
        <Composer value={request()} onInput={setRequest} placeholder="Describe what you want to see" submitLabel="Draft it" disabled={!pick()}
          onSubmit={value => props.onLaunch({ kind: 'describe', request: value.trim() })} />
        <Show when={pick()} fallback={<Text emphasis="muted" wrap>Connect a model in Settings to draft a panel with AI.</Text>}>{current =>
          <ModelBackendPicker backends={backends.data?.backends ?? []} backendId={current().backendId} modelId={current().modelId} onChange={next => {
            setChoice(next)
            void saveGeneratePick(queryClient, next)
          }} />
        }</Show>
        <Show when={suggestions().length}>
          <Inline gap="inline" wrap><For each={suggestions()}>{title => <Chip onPress={() => setRequest(title)}>{title}</Chip>}</For></Inline>
        </Show>

        <SectionHeader level="group">Or start from data</SectionHeader>
        <Input label="Search sources" placeholder="Search sources and saved queries" value={search()} onInput={setSearch} />
        <Show when={catalog.isError}><Alert tone="warn">Sources couldn't be loaded. Try again once the Node reconnects.</Alert></Show>
        <Show when={shown().length} fallback={<Text emphasis="muted">{catalog.isPending ? 'Loading sources…' : 'No sources match.'}</Text>}>
          <Rows id="dashboards.launcher.sources" ariaLabel="Sources" items={shown().map(entry => ({ key: entry.id, label: entry.label }))}
            selected={picked()?.id ?? null} onSelect={choose}>
            {(item, itemProps, selected) => (
              <Row item={itemProps} selected={selected()} density="compact" onPress={() => choose(item.key)}
                meta={<Show when={entries().find(entry => entry.id === item.key)?.note}>{note => <Text emphasis="muted">{note()}</Text>}</Show>}>
                {item.label}
              </Row>
            )}
          </Rows>
        </Show>
        <Show when={pickedSource()?.inputs}>{inputs => (
          <Field label="Choose an account for each input" group>
            <For each={Object.keys(inputs())}>{name => {
              const input = () => inputs()[name]!
              const providerId = () => inputSourceOf(input(), catalog.data?.sources ?? [])?.providerId
              return <Show when={providerId()}>
                <InputAccountField label={input().label} optional={input().optional} provider={inputProviderLabel(input(), catalog.data?.sources ?? [])}
                  connections={usableConnections(integrations.data?.integrations ?? [], providerId())}
                  value={inputBindings()?.[name]?.connectionId} bound={!!inputBindings()?.[name]} onChange={connectionId => bindInput(name, connectionId)} />
              </Show>
            }}</For>
          </Field>
        )}</Show>
        <Show when={picked()?.kind === 'source' && picked()}>{entry => (
          <Field label={`Start ${entry().label} from`} group>
            <Show when={unbound().length}><Text emphasis="muted" wrap>Choose an account for each input to start.</Text></Show>
            <Show when={description.isError}><Alert tone="warn">This source couldn't describe its fields, so it has no starter panels.</Alert></Show>
            <Show when={!description.isPending && !starters.loading} fallback={<Text emphasis="muted">Looking for starter panels…</Text>}>
              <Rows id="dashboards.launcher.starters" ariaLabel="Starter panels" items={starterRows()} selected={null} onSelect={startFrom}>
                {(item, itemProps, selected) => (
                  <Row item={itemProps} selected={selected()} density="compact" variant="stacked" onPress={() => startFrom(item.key)}>
                    <Stack gap="none"><Text>{item.label}</Text><Text emphasis="muted">{item.detail}</Text></Stack>
                  </Row>
                )}
              </Rows>
            </Show>
          </Field>
        )}</Show>

        <Show when={unfinished().length}>
          <SectionHeader level="group">Unfinished</SectionHeader>
          <Stack gap="row">
            <For each={allDrafts() ? unfinished() : unfinished().slice(0, DRAFTS_SHOWN)}>{draft => (
              <Inline gap="inline" wrap>
                <Text>{draft.content.title}</Text>
                <Text emphasis="muted">{`edited ${formatRelativeTime(draft.updatedAt)}`}</Text>
                <Button size="sm" onPress={() => props.onLaunch({ kind: 'draft', dashboardId: draft.id })}>Continue</Button>
                <ConfirmButton size="sm" variant="ghost" confirmLabel="Discard draft?" onConfirm={() => void discard(draft)}>Discard</ConfirmButton>
              </Inline>
            )}</For>
            <Show when={!allDrafts() && unfinished().length > DRAFTS_SHOWN}>
              <Button size="sm" variant="bare" onPress={() => setAllDrafts(true)}>{`and ${unfinished().length - DRAFTS_SHOWN} more`}</Button>
            </Show>
          </Stack>
        </Show>
        <Show when={problem()}>{message => <Alert tone="warn">{message()}</Alert>}</Show>
      </Stack></Modal.Body>
    </Modal>
  )
}
