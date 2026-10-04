import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch, untrack } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { Integration } from '@acorn/protocol/api.ts'
import type { DataField, DataOperator, DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { queryContentSchema, type QueryContent, type QueryDraft, type QueryReference, type QuerySaveState, type QueryScope } from '@acorn/protocol/dataQueries.ts'
import type { DataSourceDescription, DataSourceDescriptor, DataSourceQuery, DataSourceRef, DataSourceResult, DataSourceScope } from '@acorn/protocol/dataSources.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { AuthoringTurnResult } from '@acorn/protocol/authoring.ts'
import { MISSING, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'
import { integrationsOptions } from '../../infra/queries'
import { activeCacheId } from '../../infra/node/activeNode'
import { ApiError } from '../../infra/node/apiClient'
import { Alert, Badge, Button, Field, Fold, Inline, Input, Picker, pluginLabel, SegmentedControl, Select, Stack, Text } from './kit.ts'
import { queriesClient, queriesKey } from '../queries/queriesClient'
import { QUERY_AUTOSAVE_MS, queryRecoveryStore } from '../queries/recoveryStore'
import {
  beginPreview, editPreview, failPreview, initialComparison, initialPreviewState,
  literalBinding, previewIsStale, replaceComparisonField, replaceComparisonOperator, resolvePreview,
  schemaAtPointer, setScopeParameter, valueAt,
} from './editorModel'
import {
  dataSourceCatalogOptions, dataSourceQueryOptions,
} from './queries'
import AuthoringConversation from './AuthoringConversation'
import { mergeAuthoringCandidate } from './authoringMerge'

type Source = DataSourceDescriptor & DataSourceRef

const emptyParameters: DataSchema = { type: 'object', properties: {}, additionalProperties: false }
const sourceKey = (source: DataSourceRef) => `${source.pluginId}:${source.sourceId}`
const plainContent = (content: QueryContent): QueryContent => queryContentSchema.parse(JSON.parse(JSON.stringify(content)))
const errorMessage = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.code === 'unavailable') return 'This source is unavailable. Reconnect its provider or choose another source.'
    if (error.code === 'connection-required') return 'Choose a connection before continuing.'
    if (error.code === 'forbidden') return 'This connection is not available in the selected workspace.'
    return "The source couldn't answer."
  }
  return error instanceof Error ? error.message : 'The source could not be read.'
}

const blankContent = (query: DataSourceQuery): QueryContent => ({
  name: 'Inline query', parameters: emptyParameters, query, sourceParameters: {},
})

function TypedOperand(props: {
  label: string
  schema: DataSchema
  field?: DataField
  value: DataValue
  options?: readonly { id: string; label: string }[]
  disabled?: boolean
  onChange(value: DataValue): void
}) {
  const type = () => (Array.isArray(props.schema.type) ? props.schema.type.find(value => value !== 'null') : props.schema.type)
  const choices = () => props.options ?? (props.field?.choices?.kind === 'static' ? props.field.choices.values : undefined)
  const text = () => typeof props.value === 'string' ? props.value : typeof props.value === 'number' ? String(props.value) : JSON.stringify(props.value)
  const update = (raw: string): void => {
    if (type() === 'number' || type() === 'integer') props.onChange(Number(raw))
    else if (type() === 'array' || type() === 'object') {
      try { props.onChange(JSON.parse(raw) as DataValue) } catch { /* Keep the last valid typed value. */ }
    } else props.onChange(raw)
  }
  return <Switch fallback={<Input size="sm" label={props.label} disabled={props.disabled} assist={false} value={text()} type={type() === 'number' || type() === 'integer' ? 'number' : 'text'} onInput={update} />}>
    <Match when={type() === 'boolean'}>
      <Select size="sm" label={props.label} disabled={props.disabled} value={String(props.value)} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} onChange={value => props.onChange(value === 'true')} />
    </Match>
    <Match when={choices()?.length}>
      <Picker
        label={choices()!.find(option => option.id === props.value)?.label ?? 'Choose…'}
        ariaLabel={props.label}
        placeholder="Search options"
        emptyText="No matching options."
        disabled={props.disabled}
        items={choices()!.map(option => ({ id: option.id, label: option.label, active: option.id === props.value }))}
        onPick={id => props.onChange(id)}
      />
    </Match>
  </Switch>
}

function DynamicOptions(props: {
  nodeId: string
  query: DataSourceQuery
  field: DataField
  target: 'field' | 'parameter'
  value: DataValue | typeof MISSING
  disabled?: boolean
  multiple?: boolean
  onChange(value: DataValue): void
}) {
  const [search, setSearch] = createSignal('')
  const request = () => ({
    operation: 'options' as const, source: props.query.source, scope: props.query.scope,
    target: props.target, pointer: props.field.pointer, search: search(), pageSize: 100,
  })
  const options = createQuery(() => ({ ...dataSourceQueryOptions(props.nodeId, request()), enabled: !props.disabled }))
  const selectedIds = () => Array.isArray(props.value) ? props.value.filter((id): id is string => typeof id === 'string') : typeof props.value === 'string' ? [props.value] : []
  const selected = () => options.data?.options.filter(option => selectedIds().includes(option.id)) ?? []
  return <Picker
    label={selected().length ? selected().map(option => option.label).join(', ') : props.value === MISSING ? props.multiple ? 'Every available scope' : 'Choose…' : String(props.value)}
    ariaLabel={props.field.label}
    placeholder={`Search ${props.field.label.toLowerCase()}`}
    emptyText={options.isPending ? 'Loading options…' : options.isError ? 'Options unavailable.' : 'No matching options.'}
    disabled={props.disabled}
    onSearch={setSearch}
    items={(options.data?.options ?? []).map(option => ({ id: option.id, label: option.label, active: selectedIds().includes(option.id) }))}
    onPick={id => props.onChange(props.multiple ? selectedIds().includes(id) ? selectedIds().filter(value => value !== id) : [...selectedIds(), id] : id)}
    status={options.isError ? <Text emphasis="muted">Options could not be loaded. Your existing selection is retained.</Text> : undefined}
  />
}

function ComparisonEditor(props: {
  nodeId: string
  query: DataSourceQuery
  description: DataSourceDescription
  value: Extract<DataPredicate, { kind: 'comparison' }>
  disabled?: boolean
  onChange(value: DataPredicate): void
  onRemove(): void
}) {
  const fields = () => props.description.fields.filter(field => field.query?.operators.length)
  const selectedPointer = () => {
    const address = props.value.left.address
    return address.from === 'item' ? address.pointer : undefined
  }
  const selected = () => fields().find(field => field.pointer === selectedPointer())
  const schema = () => selected() ? schemaAtPointer(props.description.schema, selected()!.pointer) : undefined
  const dynamic = () => selected()?.choices?.kind === 'dynamic'
  const [search, setSearch] = createSignal('')
  const optionRequest = () => selected() ? {
    operation: 'options' as const, source: props.query.source, scope: props.query.scope, target: 'field' as const,
    pointer: selected()!.pointer, search: search(), pageSize: 100,
  } : undefined
  const dynamicOptions = createQuery(() => ({ ...dataSourceQueryOptions(props.nodeId, optionRequest() ?? {
    operation: 'options', source: props.query.source, scope: props.query.scope,
    target: 'field', pointer: '', search: '', pageSize: 100,
  }), enabled: dynamic() }))
  const right = () => props.value.right?.address.from === 'literal' ? props.value.right.address.value : undefined
  const isViewer = () => props.value.right?.address.from === 'context' && props.value.right.address.name === 'viewer'
  return <Stack gap="row">
    <Show when={!selected()}>
      <Alert tone="warn">The selected field is no longer described by this source. Choose a replacement; the saved value has not been discarded.</Alert>
    </Show>
    <Inline gap="inline" wrap>
      <Select size="sm" label="Field" disabled={props.disabled} value={selected()?.pointer ?? ''}
        options={fields().map(field => ({ value: field.pointer, label: field.label }))}
        onChange={pointer => {
          const field = fields().find(entry => entry.pointer === pointer)
          const nextSchema = field && schemaAtPointer(props.description.schema, pointer)
          if (field && nextSchema) props.onChange(replaceComparisonField(props.value, field, nextSchema))
        }} />
      <Select size="sm" label="Comparison" disabled={props.disabled} value={props.value.operator}
        options={(selected()?.query?.operators ?? []).map(operator => ({ value: operator, label: operator.replaceAll('-', ' ') }))}
        onChange={operator => schema() && props.onChange(replaceComparisonOperator(props.value, operator as DataOperator, schema()!))} />
      <Button size="sm" variant="bare" disabled={props.disabled} onPress={props.onRemove}>Remove condition</Button>
    </Inline>
    <Show when={selected()?.viewerMatch}><Button size="sm" variant={isViewer() ? 'solid' : 'bare'} disabled={props.disabled}
      onPress={() => props.onChange({ ...props.value, right: { address: { from: 'context', name: 'viewer', pointer: selected()!.viewerMatch! } } })}>You</Button></Show>
    <Show when={isViewer()}><Button size="sm" variant="bare" disabled={props.disabled} onPress={() => props.onChange({ ...props.value, right: literalBinding('') })}>Use a value</Button></Show>
    <Show when={schema() && right() !== undefined}>{dynamic() ? (
      <Picker
        label={dynamicOptions.data?.options.find(option => option.id === right())?.label ?? String(right())}
        ariaLabel="Value"
        placeholder="Search options"
        emptyText={dynamicOptions.isPending ? 'Loading options…' : dynamicOptions.isError ? 'Options unavailable.' : 'No matching options.'}
        onSearch={setSearch}
        disabled={props.disabled}
        items={(dynamicOptions.data?.options ?? []).map(option => ({ id: option.id, label: option.label, active: option.id === right() }))}
        onPick={value => props.onChange({ ...props.value, right: literalBinding(value) })}
      />
    ) : (
      <TypedOperand label="Value" schema={schema()!} field={selected()} value={right()!} disabled={props.disabled}
        onChange={value => props.onChange({ ...props.value, right: literalBinding(props.value.operator === 'in' && !Array.isArray(value) ? [value] : value) })} />
    )}</Show>
  </Stack>
}

function PredicateEditor(props: {
  nodeId: string
  query: DataSourceQuery
  description: DataSourceDescription
  value: DataPredicate
  depth?: number
  disabled?: boolean
  onChange(value: DataPredicate): void
  onRemove(): void
}) {
  const fields = () => props.description.fields.filter(field => field.query?.operators.length)
  const addCondition = (): void => {
    const field = fields()[0]
    const schema = field && schemaAtPointer(props.description.schema, field.pointer)
    if (!field || !schema || props.value.kind === 'comparison') return
    props.onChange({ ...props.value, predicates: [...props.value.predicates, initialComparison(field, schema)] })
  }
  if (props.value.kind === 'comparison') return <ComparisonEditor {...props} value={props.value} />
  return <Fold label={props.value.kind === 'all' ? 'All conditions' : 'Any condition'} level="group" defaultOpen>
    <Stack gap="row">
      <Select size="sm" label="Match" disabled={props.disabled} value={props.value.kind}
        options={props.description.operations.groups.map(group => ({ value: group, label: group === 'all' ? 'All conditions' : 'Any condition' }))}
        onChange={kind => props.onChange({ ...props.value as Extract<DataPredicate, { kind: 'all' | 'any' }>, kind: kind as 'all' | 'any' })} />
      <For each={props.value.predicates}>{(predicate, index) => <PredicateEditor
        {...props}
        depth={(props.depth ?? 0) + 1}
        value={predicate}
        onChange={value => props.value.kind !== 'comparison' && props.onChange({ ...props.value, predicates: props.value.predicates.map((entry, at) => at === index() ? value : entry) })}
        onRemove={() => props.value.kind !== 'comparison' && props.onChange({ ...props.value, predicates: props.value.predicates.filter((_entry, at) => at !== index()) })}
      />}</For>
      <Inline gap="inline" wrap>
        <Button size="sm" disabled={props.disabled || !fields().length} onPress={addCondition}>Add condition</Button>
        <Show when={(props.depth ?? 0) < 3 && props.description.operations.groups.length > 1}>
          <Button size="sm" disabled={props.disabled} onPress={() => props.value.kind !== 'comparison' && props.onChange({ ...props.value, predicates: [...props.value.predicates, { kind: 'all', predicates: [] }] })}>Add group</Button>
        </Show>
        <Show when={(props.depth ?? 0) > 0}><Button size="sm" variant="bare" disabled={props.disabled} onPress={props.onRemove}>Remove group</Button></Show>
      </Inline>
    </Stack>
  </Fold>
}

export type SourceQueryEditorState = {
  query?: DataSourceQuery
  source?: DataSourceDescriptor & DataSourceRef
  description?: DataSourceDescription
  preview?: DataSourceResult
  stale: boolean
}

export default function SourceQueryEditor(props: {
  workspaceId: string
  projectId?: string
  value?: QueryReference
  disabled?: boolean
  /** Run Refresh preview once, as soon as the source is described. For reopening something that
   *  already has a query, such as a placed panel's Edit. A preview reads the source and writes
   *  nothing. */
  previewOnOpen?: boolean
  hideAuthoring?: boolean
  /** For a consumer that filters rows itself, such as a dashboard's filter step. Hides **Add
   *  condition**, and shows conditions the query already has read-only, because they change which
   *  records it returns. */
  hideConditions?: boolean
  /** For a consumer with its own live preview. Hides **Refresh preview** and the records, and turns
   *  `previewOnOpen` off. */
  hidePreview?: boolean
  pickSourceAccount?: boolean
  onChange(value: QueryReference | undefined): void
  /** Lets consumers project the shared editor's exact described fields and retained preview. It is
   * observational only: display changes never flow back into query semantics. */
  onStateChange?(state: SourceQueryEditorState): void
}) {
  const nodeId = () => activeCacheId()
  const scope = createMemo<QueryScope>(() => ({ workspaceId: props.workspaceId, ...(props.projectId ? { projectId: props.projectId } : {}) }))
  const baseScope = createMemo<DataSourceScope>(() => ({ ...scope(), parameters: {} }))
  const queryClient = useQueryClient()
  const catalog = createQuery(() => dataSourceCatalogOptions(nodeId(), baseScope()))
  const integrations = createQuery(() => integrationsOptions(true))
  const library = createQuery(() => ({ queryKey: queriesKey(nodeId(), scope()), queryFn: ({ signal }: { signal: AbortSignal }) => queriesClient(nodeId(), scope()).list(signal) }))
  const [editingShared, setEditingShared] = createSignal<QueryDraft>()
  const [sharedContent, setSharedContent] = createSignal<QueryContent>()
  const [saveState, setSaveState] = createSignal<QuerySaveState>('draft-saved')
  const [conflict, setConflict] = createSignal<{ local: QueryContent; remote: QueryDraft }>()
  const [aiUndo, setAiUndo] = createSignal<QueryContent>()
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => saveTimer && clearTimeout(saveTimer))

  const selectedSaved = () => {
    const value = props.value
    return value?.kind === 'saved' ? library.data?.find(query => query.id === value.queryId) : undefined
  }
  const consumers = createQuery(() => ({
    queryKey: [...queriesKey(nodeId(), scope()), selectedSaved()?.id ?? null, 'consumers'],
    queryFn: () => queriesClient(nodeId(), scope()).consumers(selectedSaved()!.id),
    enabled: !!selectedSaved(),
  }))
  // TanStack's Solid adapter exposes cached objects through a reactive store. Keep that bookkeeping
  // outside the protocol boundary: strict typed-data encoding intentionally rejects symbol properties.
  const content = () => {
    const selected = editingShared() ? sharedContent() : props.value?.kind === 'inline' ? props.value.content : selectedSaved()?.content
    return selected ? plainContent(selected) : undefined
  }
  const query = () => content()?.query
  const sources = () => catalog.data?.sources ?? []
  const source = () => query() ? sources().find(entry => sourceKey(entry) === sourceKey(query()!.source)) : undefined
  const connections = () => {
    const providerId = source()?.providerId
    return providerId ? (integrations.data?.integrations ?? []).filter(connection => connection.providerId === providerId && connection.status !== 'disabled') : []
  }
  const canDescribe = () => !!query() && !(query()!.source.pluginId === 'core' && query()!.source.sourceId === 'choose')
    && (!source()?.providerId || !!query()!.scope.connectionId)
  const describeRequest = () => ({
    operation: 'describe' as const,
    source: query()?.source ?? { pluginId: 'unavailable', sourceId: 'unavailable' },
    scope: query()?.scope ?? baseScope(),
  })
  const description = createQuery(() => ({ ...dataSourceQueryOptions(nodeId(), describeRequest()), enabled: canDescribe() }))

  const emitContent = (next: QueryContent): void => {
    const draft = editingShared()
    if (!draft) {
      props.onChange({ kind: 'inline', content: next, bindings: props.value?.bindings ?? {} })
      return
    }
    setSharedContent(next)
    setSaveState('saved-on-device')
    const storage = typeof localStorage === 'undefined' ? undefined : localStorage
    const copy = { nodeId: nodeId(), entityId: draft.id, baseRevision: draft.draftRevision, baseContent: draft.content, content: next, savedAt: Date.now() }
    setSaveState(queryRecoveryStore(storage).save(copy))
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      setSaveState('saving')
      try {
        const saved = await queriesClient(nodeId(), scope()).save(draft.id, draft.draftRevision, next)
        queryRecoveryStore(storage).acknowledge(copy, saved)
        setEditingShared(saved)
        setSharedContent(saved.content)
        setSaveState('draft-saved')
        // The Node acknowledgement is authoritative. A cache refresh failure must not relabel a
        // successful save as a revision conflict; the next observer can retry the refresh.
        void queryClient.invalidateQueries({ queryKey: queriesKey(nodeId(), scope()) }).catch(() => {})
      } catch {
        const remote = await queriesClient(nodeId(), scope()).get(draft.id).catch(() => undefined)
        if (remote) {
          setConflict({ local: next, remote })
          setSaveState('conflict')
        } else setSaveState(queryRecoveryStore(storage).save(copy))
      }
    }, QUERY_AUTOSAVE_MS)
  }
  const emitQuery = (next: DataSourceQuery): void => emitContent({ ...(content() ?? blankContent(next)), query: next })

  const applyAiProposal = async (proposal: Extract<AuthoringTurnResult, { state: 'proposal' }>): Promise<string | undefined> => {
    const current = content()
    if (!current) return 'Choose a source or saved query before applying an AI proposal.'
    const merged = mergeAuthoringCandidate(proposal.base as QueryContent, proposal.candidate as QueryContent, current)
    if (merged.conflicts.length) return `The query changed while AI was working: ${merged.conflicts.map(value => value.path).join(', ')}.`
    const parsed = queryContentSchema.safeParse(merged.value)
    if (!parsed.success) return 'The reconciled query no longer has a valid typed shape.'
    try {
      await queriesClient(nodeId(), scope()).resolve({ kind: 'inline', content: parsed.data, bindings: {} })
    } catch (error) { return errorMessage(error) }
    setAiUndo(plainContent(current))
    emitContent(parsed.data)
    return undefined
  }

  const selectSource = (next: Source, chosenConnectionId?: string): void => {
    const matches = (integrations.data?.integrations ?? []).filter(connection => connection.providerId === next.providerId && connection.status !== 'disabled')
    const connectionId = chosenConnectionId ?? (next.providerId && matches.length === 1 ? matches[0]!.id : undefined)
    const nextQuery: DataSourceQuery = {
      source: { pluginId: next.pluginId, sourceId: next.sourceId },
      scope: { ...baseScope(), ...(connectionId ? { connectionId } : {}) }, sort: [],
    }
    setEditingShared(undefined)
    setSharedContent(undefined)
    props.onChange({ kind: 'inline', content: blankContent(nextQuery), bindings: {} })
  }
  const selectSaved = (id: string): void => {
    setEditingShared(undefined)
    setSharedContent(undefined)
    if (!id) return props.onChange(undefined)
    props.onChange({ kind: 'saved', queryId: id, bindings: {} })
  }

  const digest = () => content() ? JSON.stringify(content()) : 'none'
  const [preview, setPreview] = createSignal(initialPreviewState(digest()))
  createEffect(() => setPreview(state => editPreview(state, digest())))
  createEffect(() => {
    const state = { query: query(), source: source(), description: description.data,
      preview: preview().result, stale: previewIsStale(preview()) }
    untrack(() => props.onStateChange?.(state))
  })
  const refresh = async (): Promise<void> => {
    const current = query()
    if (!current) return
    const begun = beginPreview(preview())
    setPreview(begun.state)
    try {
      const resolved = content() ? await queriesClient(nodeId(), scope()).resolve({ kind: 'inline', content: content()!, bindings: {} }) : undefined
      const request = { operation: 'query' as const, query: resolved?.query ?? current, mode: 'preview' as const, evaluationTime: Date.now(), pageSize: 25 }
      const result = await queryClient.fetchQuery(dataSourceQueryOptions(nodeId(), request, description.data?.revision))
      setPreview(state => resolvePreview(state, begun.token, result))
    } catch (error) {
      setPreview(state => failPreview(state, begun.token, errorMessage(error)))
    }
  }

  let previewedOnOpen = false
  createEffect(() => {
    if (!props.previewOnOpen || props.hidePreview || previewedOnOpen || !query() || !description.data) return
    previewedOnOpen = true
    void refresh()
  })

  const updateConnection = (connectionId: string): void => {
    const current = query()
    if (!current) return
    const { predicate: _predicate, ...withoutPredicate } = current
    const { connectionId: _connectionId, ...scopeWithoutConnection } = current.scope
    emitQuery({
      ...withoutPredicate,
      scope: { ...scopeWithoutConnection, ...(connectionId ? { connectionId } : {}), parameters: {} },
    })
  }
  const updateParameter = (field: DataField, value: DataValue): void => {
    if (!query() || !description.data) return
    const next = setScopeParameter(query()!, description.data, field.pointer, value).query
    const key = field.pointer.slice(1)
    const { [key]: _binding, ...bindings } = content()?.sourceParameters ?? {}
    emitContent({ ...content()!, query: next, sourceParameters: bindings })
  }
  const setListReach = (field: DataField, reach: 'account' | 'workspace'): void => {
    if (!query() || !content()) return
    const key = field.pointer.slice(1)
    const { [key]: _value, ...parameters } = query()!.scope.parameters
    const { [key]: _binding, ...bindings } = content()!.sourceParameters
    emitContent({ ...content()!, query: { ...query()!, scope: { ...query()!.scope, parameters } },
      sourceParameters: reach === 'workspace' ? { ...bindings, [key]: { address: { from: 'context', name: 'workspaceLinks' } } } : bindings })
  }
  /** The panel picker draws a source's declared reach as one choice: everything, workspace links,
   *  or chosen items, with the item picker only for the last. */
  const isReachChoice = (described: DataSourceDescription, field: DataField): boolean =>
    !!props.pickSourceAccount && described.reach?.parameter === field.pointer && field.choices?.kind === 'dynamic'
  const reachMode = (field: DataField): 'account' | 'workspace' | 'chosen' => {
    const binding = content()?.sourceParameters[field.pointer.slice(1)]
    if (binding?.address.from === 'context' && binding.address.name === 'workspaceLinks') return 'workspace'
    return Array.isArray(currentParameter(field)) ? 'chosen' : 'account'
  }
  const currentParameter = (field: DataField) => query() ? readDataPointer(query()!.scope.parameters, field.pointer) : MISSING
  const parameterSchema = (field: DataField) => description.data ? schemaAtPointer(description.data.parameters, field.pointer) : undefined
  const queryFields = () => description.data?.fields.filter(field => field.query?.operators.length) ?? []
  const addFirstCondition = (): void => {
    const field = queryFields()[0]
    const schema = field && description.data && schemaAtPointer(description.data.schema, field.pointer)
    if (!query() || !field || !schema) return
    emitQuery({ ...query()!, predicate: { kind: description.data!.operations.groups[0] ?? 'all', predicates: [initialComparison(field, schema)] } })
  }
  const incompleteCause = () => {
    const completeness = preview().result?.completeness
    return completeness?.kind === 'incomplete' ? completeness.cause.replaceAll('-', ' ') : undefined
  }

  const startSharedEdit = (): void => {
    const selected = selectedSaved()
    if (!selected) return
    setEditingShared({ ...selected, content: plainContent(selected.content) })
    setSharedContent(plainContent(selected.content))
    setSaveState('draft-saved')
  }
  const customize = (): void => {
    const selected = editingShared()?.content ?? selectedSaved()?.content
    if (!selected) return
    setEditingShared(undefined)
    setSharedContent(undefined)
    props.onChange({ kind: 'inline', content: plainContent(selected), bindings: props.value?.bindings ?? {} })
  }

  return <Stack gap="stack">
    <Field label="Source or saved query" group>
      <Picker
        label={selectedSaved()?.content.name ?? source()?.name ?? 'Choose records…'}
        ariaLabel="Source or saved query"
        placeholder="Search sources and saved queries"
        emptyText={catalog.isPending || library.isPending ? 'Loading sources…' : 'No sources are available.'}
        disabled={props.disabled}
        items={[
          ...(library.data ?? []).map(saved => ({ id: `saved:${saved.id}`, label: saved.content.name, note: 'Saved query', active: props.value?.kind === 'saved' && props.value.queryId === saved.id })),
          ...sources().flatMap(entry => props.pickSourceAccount && entry.providerId
            ? (integrations.data?.integrations ?? []).filter(connection => connection.providerId === entry.providerId && connection.status !== 'disabled').map(connection => ({
              id: `source:${sourceKey(entry)}|${connection.id}`, label: `${entry.name} · ${connection.name ?? connection.label}`,
              note: pluginLabel(entry.pluginId), active: sourceKey(entry) === (source() ? sourceKey(source()!) : '') && query()?.scope.connectionId === connection.id,
            }))
            : [{ id: `source:${sourceKey(entry)}`, label: entry.name, ...(entry.pluginId === 'core' ? {} : { note: pluginLabel(entry.pluginId) }), active: sourceKey(entry) === (source() ? sourceKey(source()!) : '') }]),
        ]}
        onPick={id => {
          if (id.startsWith('saved:')) return selectSaved(id.slice(6))
          const [key, connectionId] = id.slice(7).split('|')
          selectSource(sources().find(entry => sourceKey(entry) === key)!, connectionId)
        }}
      />
    </Field>
    <Show when={catalog.isError}><Alert tone="danger">Sources could not be loaded. Retry after reconnecting the Node.</Alert></Show>
    <Show when={props.value?.kind === 'saved' && selectedSaved()}>
      <Stack gap="row">
      <Inline gap="inline" wrap>
        <Badge>Shared query</Badge>
        <Button size="sm" disabled={props.disabled} onPress={startSharedEdit}>Edit saved query</Button>
        <Button size="sm" disabled={props.disabled} onPress={customize}>Customize for this use</Button>
        <Show when={editingShared()}><Badge tone={saveState() === 'conflict' ? 'warn' : undefined}>{saveState().replaceAll('-', ' ')}</Badge></Show>
      </Inline>
      <Show when={consumers.data?.length}>
        <Text emphasis="muted" wrap>{`Used by ${consumers.data!.map(consumer => consumer.name).join(', ')}.`}</Text>
      </Show>
      </Stack>
    </Show>
    <Show when={conflict()}>{state => <Alert tone="warn" title="This saved query changed elsewhere">
      <Stack gap="row">
        <Text wrap>Your local edits remain on this device. Reload the Node draft or detach your version for this workflow.</Text>
        <Inline gap="inline">
          <Button size="sm" onPress={() => { setEditingShared(state().remote); setSharedContent(state().remote.content); setConflict(undefined); setSaveState('draft-saved') }}>Reload changed query</Button>
          <Button size="sm" onPress={customize}>Customize for this use</Button>
        </Inline>
      </Stack>
    </Alert>}</Show>
    <Show when={query()}>{current => <Stack gap="stack">
      <Show when={!props.hideAuthoring}><AuthoringConversation
        endpoint="/v1/core/authoring/turn"
        target="query"
        targetId={editingShared()?.id ?? selectedSaved()?.id ?? `inline:${sourceKey(current().source)}`}
        scope={scope()}
        baseRevision={editingShared()?.draftRevision ?? 0}
        base={content()!}
        label={content()?.name ?? 'Query'}
        disabled={props.disabled || !!(props.value?.kind === 'saved' && !editingShared())}
        defaultOpen={false}
        onApply={applyAiProposal}
      /></Show>
      <Show when={aiUndo()}>{previous => <Button size="sm" variant="bare" onPress={() => { emitContent(previous()); setAiUndo(undefined) }}>Undo AI edit</Button>}</Show>
      {/* The combined picker already names the account, so a panel asks again only when there's a choice. */}
      <Show when={source()?.providerId && (!props.pickSourceAccount || connections().length > 1)}>
        <Field label={props.pickSourceAccount ? 'Account' : 'Connection'} hint={props.pickSourceAccount ? undefined : 'The account scope is always explicit.'} group>
          <Select size="sm" label={props.pickSourceAccount ? 'Account' : 'Connection'} disabled={props.disabled || !!(props.value?.kind === 'saved' && !editingShared())}
            value={current().scope.connectionId ?? ''}
            options={[{ value: '', label: connections().length ? 'Choose an account…' : 'No connected account' }, ...connections().map((connection: Integration) => ({ value: connection.id, label: connection.name ?? connection.label }))]}
            onChange={updateConnection} />
        </Field>
      </Show>
      <Show when={description.isPending && canDescribe()}><Text emphasis="muted">Loading source fields…</Text></Show>
      <Show when={description.isError}><Alert tone="danger">{errorMessage(description.error)}</Alert></Show>
      <Show when={description.data}>{described => <>
        <Show when={props.pickSourceAccount && !described().reach}><Text emphasis="muted" wrap>{`Reach: ${described().consistency}`}</Text></Show>
        <For each={described().parameterFields}>{field => <Show when={!isReachChoice(described(), field)} fallback={<Field label="Reach" group><Stack gap="row">
          <SegmentedControl ariaLabel="Reach" size="sm" value={reachMode(field)} onChange={mode => mode === 'chosen' ? updateParameter(field, []) : setListReach(field, mode)}
            options={[{ value: 'account', label: 'Everything this account can see' }, { value: 'workspace', label: 'Workspace links' }, { value: 'chosen', label: `Chosen ${described().reach!.itemPlural}` }]} />
          <Show when={reachMode(field) === 'chosen'}>
            <DynamicOptions nodeId={nodeId()} query={current()} field={field} target="parameter" value={currentParameter(field)} multiple
              disabled={props.disabled || !!(props.value?.kind === 'saved' && !editingShared())} onChange={value => updateParameter(field, value)} />
          </Show>
        </Stack></Field>}><Field label={field.label} hint={field.description} group>
          <Show when={parameterSchema(field)?.type === 'array' && field.choices?.kind === 'dynamic'}><Inline gap="inline" wrap>
            <Button size="sm" variant="bare" onPress={() => setListReach(field, 'account')}>Everywhere this account can see</Button>
            <Button size="sm" variant="bare" onPress={() => setListReach(field, 'workspace')}>Workspace links</Button>
          </Inline></Show>
          <Show when={parameterSchema(field)}>{schema => field.choices?.kind === 'dynamic' ? (
            <DynamicOptions nodeId={nodeId()} query={current()} field={field} target="parameter" value={currentParameter(field)} multiple={schema().type === 'array'}
              disabled={props.disabled || !!(props.value?.kind === 'saved' && !editingShared())} onChange={value => updateParameter(field, value)} />
          ) : (
            <TypedOperand label={field.label} schema={schema()} field={field} value={currentParameter(field) === MISSING ? '' : currentParameter(field) as DataValue}
              disabled={props.disabled || !!(props.value?.kind === 'saved' && !editingShared())} onChange={value => updateParameter(field, value)} />
          )}</Show>
        </Field></Show>}</For>
        <Show when={current().predicate} fallback={<Show when={!props.hideConditions}><Button size="sm" disabled={props.disabled || !queryFields().length || !!(props.value?.kind === 'saved' && !editingShared())} onPress={addFirstCondition}>Add condition</Button></Show>}>
          {predicate => <>
            <Show when={props.hideConditions}><Text emphasis="muted">These conditions run inside the source.</Text></Show>
            <PredicateEditor nodeId={nodeId()} query={current()} description={described()} value={predicate()}
              disabled={props.disabled || props.hideConditions || !!(props.value?.kind === 'saved' && !editingShared())}
              onChange={value => emitQuery({ ...current(), predicate: value })}
              onRemove={() => {
                const { predicate: _predicate, ...withoutPredicate } = current()
                emitQuery(withoutPredicate)
              }} />
          </>}
        </Show>
        <Show when={!props.hidePreview}>
          <Inline gap="inline" wrap>
            <Button variant="solid" size="sm" busy={preview().loading} disabled={props.disabled || !canDescribe()} onPress={() => void refresh()}>Refresh preview</Button>
            <Show when={previewIsStale(preview())}><Badge tone="warn">Preview is out of date</Badge></Show>
            <Show when={preview().result}><Text emphasis="muted" tip={`Read ${new Date(preview().result!.readTime).toLocaleString()}`}>Showing up to 25</Text></Show>
          </Inline>
          <Show when={preview().error}><Alert tone="danger" title="Couldn't load a preview">{preview().error} The last preview stays until you refresh.</Alert></Show>
          <Show when={preview().result}>{result => <Stack gap="row">
            <Show when={incompleteCause()}>{cause => <Alert tone="warn">{`Preview is incomplete: ${cause()}.`}</Alert>}</Show>
            <Show when={!result().records.length}><Alert>{`No matching ${source()?.plural.toLowerCase() ?? 'records'}. Edit filters and refresh again.`}</Alert></Show>
            <For each={result().records}>{record => <Fold label={record.display?.title ?? record.ref.recordId} level="sub">
              <Stack gap="row">
                <For each={[...described().fields, ...Object.keys(record.data && typeof record.data === 'object' && !Array.isArray(record.data) ? record.data : {}).filter(key => !described().fields.some(field => field.pointer === `/${key}`)).map(key => ({ pointer: `/${key}`, label: key, origin: 'observed' as const }))]}>{field => {
                  const selected = valueAt(record.data, field.pointer)
                  return <Inline gap="inline" wrap><Text emphasis="strong">{field.label}</Text><Text emphasis="mono" wrap>{selected === undefined ? 'Missing' : typeof selected === 'string' ? selected : JSON.stringify(selected)}</Text><Show when={field.origin === 'observed'}><Badge>Observed</Badge></Show></Inline>
                }}</For>
              </Stack>
            </Fold>}</For>
          </Stack>}</Show>
        </Show>
      </>}</Show>
    </Stack>}</Show>
  </Stack>
}
