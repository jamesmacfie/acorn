import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { panelPlanSchema, type DashboardDraft, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { DataSourceDescription, DataSourceScope } from '@acorn/protocol/dataSources.ts'
import { planSummary, SOURCE_ICON, VIEW_ICONS } from '@acorn/dashboards-core/outline.ts'
import { formatRelativeTime } from '@acorn/dashboards-core/relativeTime.ts'
import { activeCacheId } from '../../../infra/node/activeNode'
import { integrationsOptions, modelBackendsOptions, prefsOptions } from '../../../infra/queries'
import { dataSourceCatalogOptions, dataSourceQueryKey, dataSourceQueryOptions } from '../../dataSources/queries'
import {
  defaultInputBindings, inputProviderLabel, inputSourceOf, sourceEntries, sourceKey, sourceReference, unboundInputs, usableConnections, type SourceEntry,
} from '../../dataSources/sourceEntries'
import InputAccountField from '../../dataSources/InputAccountField'
import { queriesClient, queriesKey } from '../../queries/queriesClient'
import { effectiveModelPick, modelPickLabel, readGeneratePick, saveGeneratePick, type ModelPick } from '../../settings/models/generatePick'
import ModelBackendPicker from '../../settings/models/ModelBackendPicker'
import ModelPickerPopover from '../../settings/models/ModelPickerPopover'
import { Alert, Button, Chip, ConfirmButton, Field, Input, Row, SectionHeader } from '../../../kit/components/primitives'
import { Composer } from '../../../kit/components/inputs/Composer'
import { Inline } from '../../../kit/components/layout/Inline'
import { Rows } from '../../../kit/components/layout/Rows'
import { Stack } from '../../../kit/components/layout/Stack'
import { Text } from '../../../kit/components/content/Text'
import Icon from '../../../kit/components/content/Icon'
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
  const shown = createMemo(() => entries().filter(entry => `${entry.label} ${entry.group}`.toLowerCase().includes(search().trim().toLowerCase())))
  /** The shown entries under where they come from, in catalog order: "Acorn", "Agents", "GitHub · Work". */
  const groups = createMemo(() => {
    const byGroup = new Map<string, SourceEntry[]>()
    for (const entry of shown()) byGroup.set(entry.group, [...byGroup.get(entry.group) ?? [], entry])
    return [...byGroup].map(([label, members]) => ({ label, members }))
  })
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
  let back: HTMLDivElement | undefined
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
      // The row that had focus is gone, so focus moves to the way back.
      queueMicrotask(() => back?.querySelector('button')?.focus())
    }
  }
  const startFrom = (key: string): void => {
    const reference = pickedReference()
    if (!reference || unbound().length) return
    const starter = key === BLANK ? undefined : starters()?.[Number(key)]
    props.onLaunch({ kind: 'source', reference, ...(starter ? { starter } : {}) })
  }
  const starterRows = () => [
    ...(starters() ?? []).map((starter, index) => ({
      key: String(index), label: starter.title, detail: planSummary(starter), icon: VIEW_ICONS[starter.view.kind], disabled: unbound().length > 0,
    })),
    { key: BLANK, label: 'Blank panel', detail: 'Just the source, with its main fields as columns. Build the rest yourself.', icon: 'plus', disabled: unbound().length > 0 },
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
        <Text emphasis="muted" wrap>A panel shows live records from one of your sources. Say what you want and AI drafts it, or pick a source and build it yourself.</Text>
        <SectionHeader level="group">Describe it</SectionHeader>
        {/* The model sits beside Draft it behind the sparkle, as it does for a commit message
            (plugins/changes/src/client/GenerateButton.tsx). */}
        <Composer value={request()} onInput={setRequest} placeholder="For example: my open pull requests that need a review, oldest first" submitLabel="Draft it" disabled={!pick()}
          onSubmit={value => props.onLaunch({ kind: 'describe', request: value.trim() })}
          secondary={<Show when={pick()}>{current =>
            <ModelPickerPopover label="Model for the panel" title="Choose who drafts the panel" tipSub={modelPickLabel(backends.data?.backends ?? [], current())} sparkle>
              <ModelBackendPicker backends={backends.data?.backends ?? []} backendId={current().backendId} modelId={current().modelId} onChange={next => {
                setChoice(next)
                void saveGeneratePick(queryClient, next)
              }} />
            </ModelPickerPopover>
          }</Show>} />
        <Show when={!pick()}><Text emphasis="muted" wrap>Connect a model in Settings to draft a panel with AI.</Text></Show>
        <Show when={suggestions().length}>
          <Inline gap="inline" wrap>
            <Text emphasis="muted">Try</Text>
            <For each={suggestions()}>{title => <Chip onPress={() => setRequest(title)}>{title}</Chip>}</For>
          </Inline>
        </Show>

        <SectionHeader level="group">Start from data</SectionHeader>
        {/* Two steps in one place: pick a source, then a starting point for it. Picking swaps the list
            for the starting points, so they show where the person is looking rather than below it. */}
        <Show when={picked()?.kind === 'source' && picked()} fallback={<>
          <Text emphasis="muted" wrap>Pick where the panel's rows come from. Next you choose a starting point.</Text>
          <Input label="Search sources" placeholder="Search sources and saved queries" value={search()} onInput={setSearch} />
          <Show when={catalog.isError}><Alert tone="warn">Sources couldn't be loaded. Try again once the Node reconnects.</Alert></Show>
          <Show when={shown().length} fallback={<Text emphasis="muted">{catalog.isPending ? 'Loading sources…' : 'No sources match.'}</Text>}>
            <For each={groups()}>{group => <>
              <SectionHeader level="sub">{group.label}</SectionHeader>
              <Rows id={`dashboards.launcher.sources.${group.label}`} ariaLabel={group.label}
                items={group.members.map(entry => ({ key: entry.id, label: entry.label, entry }))} selected={null} onSelect={choose}>
                {(item, itemProps, selected) => (
                  <Row item={itemProps} selected={selected()} density="compact" variant={item.entry.detail ? 'stacked' : 'default'} onPress={() => choose(item.key)}
                    leading={<Icon name={item.entry.icon ?? (item.entry.kind === 'saved' ? 'file-search' : SOURCE_ICON)} />} trailing={<Icon name="chevron-right" />}>
                    <Stack gap="none">
                      <Text>{item.entry.name}</Text>
                      <Show when={item.entry.detail}>{detail => <Text emphasis="muted">{detail()}</Text>}</Show>
                    </Stack>
                  </Row>
                )}
              </Rows>
            </>}</For>
          </Show>
        </>}>{entry => <>
          <div class="dash-launcher-picked" ref={back}>
            <Icon name={entry().icon ?? SOURCE_ICON} />
            <Stack gap="none"><Text emphasis="strong">{entry().name}</Text><Text emphasis="muted">{entry().group}</Text></Stack>
            <Button size="sm" variant="ghost" onPress={() => setPicked(undefined)}>Change source</Button>
          </div>
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
          <Field label="Pick a starting point" group>
            <Text emphasis="muted" wrap>A starter is a ready-made panel. You can change any of it once it opens.</Text>
            <Show when={unbound().length}><Text emphasis="muted" wrap>Choose an account for each input to start.</Text></Show>
            <Show when={description.isError}><Alert tone="warn">This source couldn't describe its fields, so it has no starter panels.</Alert></Show>
            <Show when={!description.isPending && !starters.loading} fallback={<Text emphasis="muted">Looking for starter panels…</Text>}>
              <Rows id="dashboards.launcher.starters" ariaLabel="Starting points" items={starterRows()} selected={null} onSelect={startFrom}>
                {(item, itemProps, selected) => (
                  <Row item={itemProps} selected={selected()} density="compact" variant="stacked" onPress={() => startFrom(item.key)}
                    leading={<Icon name={item.icon} />} trailing={<Icon name="chevron-right" />}>
                    <Stack gap="none"><Text>{item.label}</Text><Text emphasis="muted" wrap>{item.detail}</Text></Stack>
                  </Row>
                )}
              </Rows>
            </Show>
          </Field>
        </>}</Show>

        <Show when={unfinished().length}>
          <SectionHeader level="group">Unfinished</SectionHeader>
          <Stack gap="none">
            <For each={allDrafts() ? unfinished() : unfinished().slice(0, DRAFTS_SHOWN)}>{draft => (
              <Row density="compact" leading={<Icon name="square-pen" />} meta={<Text emphasis="muted">{`Edited ${formatRelativeTime(draft.updatedAt)}`}</Text>}
                trailing={<Inline gap="inline">
                  <Button size="sm" onPress={() => props.onLaunch({ kind: 'draft', dashboardId: draft.id })}>Continue</Button>
                  <ConfirmButton size="sm" variant="ghost" confirmLabel="Discard draft?" onConfirm={() => void discard(draft)}>Discard</ConfirmButton>
                </Inline>}>
                {draft.content.title}
              </Row>
            )}</For>
            <Show when={!allDrafts() && unfinished().length > DRAFTS_SHOWN}>
              <Inline><Button size="sm" variant="bare" onPress={() => setAllDrafts(true)}>{`Show ${unfinished().length - DRAFTS_SHOWN} more`}</Button></Inline>
            </Show>
          </Stack>
        </Show>
        <Show when={problem()}>{message => <Alert tone="warn">{message()}</Alert>}</Show>
      </Stack></Modal.Body>
    </Modal>
  )
}
