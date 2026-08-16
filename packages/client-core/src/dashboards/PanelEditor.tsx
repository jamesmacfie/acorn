import { createMemo, createSignal, For, Index, Show } from 'solid-js'
import type { PluginCollectionField } from '@acorn/protocol/collections.ts'
import { activeNodeId } from '../node/activeNode'
import type { CollectionContribution } from '../registries/collections'
import { Alert, Button, Field, Input, SectionHeader, SegmentedControl, Select } from '../ui/primitives'
import { CollapsibleSection } from '../ui/CollapsibleSection'
import Icon from '../ui/Icon'
import { Modal } from '../ui/Modal'
import Picker from '../ui/Picker'
import { collectionsForPicker, defaultPanelTitle } from './compose'
import { cachedCollectionPage } from './data'
import {
  defaultFilterFor,
  defaultGroupBy,
  normalizePanel,
  operatorNeedsValue,
  parseLimit,
  parseRefresh,
  retainShaping,
  retargetFilter,
  schemaOf,
  viewsFor,
  withOperator,
} from './editor'
import {
  candidateFieldsFor,
  isMapped,
  mappedColumnId,
  newColumnId,
  panelSchema,
  sourceFieldFor,
  statusValuesOf,
  suggestFieldMapping,
  suggestValueMapping,
  withMappedValue,
  PANEL_FIELDS,
  type PanelSourcePage,
} from './mapping'
import {
  newPanelId,
  panelSourceKey,
  type PanelAggregate,
  type PanelDefinition,
  type PanelFilter,
  type PanelMapping,
  type PanelQuery,
  type PanelShaping,
  type PanelSort,
  type PanelTone,
  type PanelView,
  type PanelViewKind,
} from './model'
import { ColumnSelect, FieldSelect, OperatorSelect, ParamInput, ToneSelect, ValueInput } from './selectors'
import { groupableFields } from './shaping'
import './dashboards.css'

// THE panel editor (docs/future/dashboards/composition.md § The generated editor) — one component
// for both entry points, because "add" and "edit" are the same question asked of a panel that does
// not exist yet.
//
// Nothing here is hand-written per collection. Every control is a SELECTOR over the schema
// (selectors.tsx) and every list of choices comes from a derivation (editor.ts, mapping.ts): the
// views offered are the ones the schema supports, the group-by fields are the ones with finite
// values, the operators are the ones the field's type can answer, the value input is the one its type
// is entered with, and the mapping matrix is one "map these onto those" selector repeated. There is
// no validation pass at the end because there is no invalid state to catch.
//
// THE MAPPING STEP APPEARS WHEN THERE IS SOMETHING TO MAP. A single-collection panel is the same
// three-decision form it always was; the columns and the per-source matrices show up on the second
// source, or when somebody invents a column over one. Confronting every user with a matrix to compose
// a list of their pull requests would be the generated editor's failure mode, not its promise.
//
// SOLID NOTE, and it is not optional: every list below whose rows contain an input uses `<Index>`.
// `<For>` keys by REFERENCE, so replacing a filter — or a mapping column — on each keystroke
// re-creates its row and the input loses focus mid-word. `<Index>` keys by position, which is what a
// positional list is.

const VIEW_LABELS: Record<PanelViewKind, string> = { stat: 'Stat', list: 'List', table: 'Table', board: 'Board' }

const AGGREGATES: readonly { value: PanelAggregate; label: string }[] = [
  { value: 'count', label: 'Count of rows' },
  { value: 'sum', label: 'Sum of' },
  { value: 'avg', label: 'Average of' },
  { value: 'min', label: 'Lowest' },
  { value: 'max', label: 'Highest' },
]

export default function PanelEditor(props: {
  collections: readonly CollectionContribution[]
  /** Absent for the add flow. */
  panel?: PanelDefinition
  onSave: (panel: PanelDefinition) => void
  onClose: () => void
}) {
  const existing = props.panel
  // Captured once: a node switch closes this window's surface anyway, and re-reading it per render
  // would make the cached-schema lookup below depend on where the rail happens to be pointing.
  const nodeId = activeNodeId() ?? ''

  const [queries, setQueries] = createSignal<PanelQuery[]>(existing ? [...existing.queries] : [])
  const [mapping, setMapping] = createSignal<PanelMapping>(existing?.mapping ?? {})
  const [title, setTitle] = createSignal(existing?.title ?? '')
  // Set by the first keystroke in the title box. Until then the title follows the collection, which
  // is what makes picking one and pressing Add work without typing anything.
  const [titleTouched, setTitleTouched] = createSignal(!!existing?.title)
  const [view, setView] = createSignal<PanelView>(existing?.view ?? { kind: 'list' })
  const [shaping, setShaping] = createSignal<PanelShaping>(existing?.shaping ?? {})
  const [limitText, setLimitText] = createSignal(existing?.shaping.limit === undefined ? '' : String(existing.shaping.limit))
  const [refreshText, setRefreshText] = createSignal(existing?.refresh === undefined ? '' : String(existing.refresh))

  let pickerHost: HTMLDivElement | undefined
  let titleBox: HTMLInputElement | undefined

  const entryFor = (query: PanelQuery): CollectionContribution | undefined =>
    props.collections.find((entry) => entry.pluginId === query.pluginId && entry.collectionId === query.collectionId)

  // The single door to "which schema does this source have": the answered one out of the node's own
  // cache, else the declared one (editor.ts § schemaOf). A collection that describes itself in its
  // response has nothing here until a panel over it has actually drawn once — which the notice below
  // says out loud rather than presenting an empty form.
  //
  // Read once, not tracked. `getQueryData` is not reactive, so a source whose first answer
  // lands WHILE this modal is open stays cold until it is reopened. The ceiling is one extra
  // open/close; a subscription to another node's QueryClient for the lifetime of a modal is not worth
  // it. Upgrade path: `queryClient.getQueryCache().subscribe` behind a signal.
  const pages = createMemo((): PanelSourcePage[] => queries().map((query) => ({
    query,
    schema: schemaOf(entryFor(query), cachedCollectionPage(query, nodeId)?.schema),
    rows: [],
  })))

  const schema = createMemo(() => panelSchema(pages(), mapping()))
  const mapped = createMemo(() => isMapped(queries(), mapping()))
  const columns = () => mapping().columns ?? []
  const cold = createMemo(() => pages().filter((page) => !page.schema.fields.length))

  const nameOf = (query: PanelQuery): string => entryFor(query)?.name ?? query.collectionId

  const fieldById = (id: string | undefined): PluginCollectionField | undefined =>
    schema().fields.find((field) => field.id === id)
  const groupable = createMemo(() => groupableFields(schema()))
  const numbers = createMemo(() => schema().fields.filter((field) => field.type === 'number'))

  const patch = (change: Partial<PanelShaping>) => setShaping((current) => ({ ...current, ...change }))

  // An existing board whose grouped field the plugin has since dropped. Settled once, on open, so
  // the select and the definition agree — a control showing a value the panel does not hold is how
  // a person saves something other than what they read.
  if (view().kind === 'board' && !fieldById(shaping().groupBy)) patch({ groupBy: defaultGroupBy(schema()) })

  // ── Sources ─────────────────────────────────────────────────────────────────────────────────

  const addable = (text: string) => collectionsForPicker(
    props.collections.filter((entry) => !queries().some((query) =>
      query.pluginId === entry.pluginId && query.collectionId === entry.collectionId)),
    text,
  )

  const addSource = (entry: CollectionContribution) => {
    const first = !queries().length
    setQueries((current) => [...current, { pluginId: entry.pluginId, collectionId: entry.collectionId }])
    if (!titleTouched()) setTitle(defaultPanelTitle(entry, props.collections))
    if (first) {
      // Everything shaped against a collection that is no longer here goes. `normalizePanel` would
      // drop the stale keys on save anyway, but leaving them on screen means showing a person
      // filters over fields their panel does not have.
      setShaping({})
      setLimitText('')
    }
    // THE ROLE PRE-FILL, and the only reason the role vocabulary exists (data-contract.md): the host
    // proposes "your title is that source's title, your status is its status" and writes the proposal
    // into the config, where the Fields matrix below shows exactly what it decided. It never guesses
    // silently and it never overwrites an answer the person already gave.
    setMapping((current) => {
      const fields = suggestFieldMapping(pages(), current)
      return fields ? { ...current, fields } : current
    })
    settle()
  }

  const removeSource = (index: number) => {
    setQueries((current) => current.filter((_, at) => at !== index))
    settle()
  }

  /** Re-gate everything the source list decides, after it changes. */
  const settle = () => {
    setShaping((current) => retainShaping(current, schema()))
    const offered = viewsFor({ schema: schema() })
    if (!offered.includes(view().kind as PanelViewKind)) chooseView(offered[0] ?? 'list')
    else if (view().kind === 'board' && !fieldById(shaping().groupBy)) patch({ groupBy: defaultGroupBy(schema()) })
  }

  const setParam = (index: number, id: string, value: string) =>
    setQueries((current) => current.map((query, at) =>
      at === index ? { ...query, params: { ...(query.params ?? {}), [id]: value } } : query))

  // ── Mapping ─────────────────────────────────────────────────────────────────────────────────

  const addColumn = () => setMapping((current) => ({
    ...current,
    columns: [...(current.columns ?? []), { id: newColumnId(), label: `Column ${(current.columns?.length ?? 0) + 1}` }],
  }))

  const editColumn = (index: number, change: { label?: string; tone?: PanelTone }) =>
    setMapping((current) => ({
      ...current,
      columns: (current.columns ?? []).map((column, at) => (at === index ? { ...column, ...change } : column)),
    }))

  const removeColumn = (index: number) => setMapping((current) => {
    const removed = current.columns?.[index]
    const columns = (current.columns ?? []).filter((_, at) => at !== index)
    // The column's own value mappings go with it — an entry keyed by a column that no longer exists
    // is unreachable config, and `pruneMapping` would drop it on save anyway.
    const bySource = Object.fromEntries(
      Object.entries(current.bySource ?? {}).flatMap(([key, entries]) => {
        const { [removed?.id ?? '']: _gone, ...kept } = entries
        return Object.keys(kept).length ? [[key, kept] as const] : []
      }),
    )
    const next: PanelMapping = { ...current, columns }
    if (Object.keys(bySource).length) next.bySource = bySource
    else delete next.bySource
    return next
  })

  const setSourceField = (key: string, panelFieldId: string, sourceFieldId: string) =>
    setMapping((current) => ({
      ...current,
      fields: { ...(current.fields ?? {}), [key]: { ...(current.fields?.[key] ?? {}), [panelFieldId]: sourceFieldId } },
    }))

  const setUnmapped = (destination: 'catch-all' | 'hidden') => setMapping((current) => {
    const next: PanelMapping = { ...current }
    if (destination === 'hidden') next.unmapped = 'hidden'
    else delete next.unmapped
    return next
  })

  // ── Projection ──────────────────────────────────────────────────────────────────────────────
  // `shaping.fields` is the VISIBLE list, in order; everything the schema declares and the list does
  // not name is hidden. Deriving both from that one array is what keeps "show it again" and "move it
  // up" from needing two pieces of state that can disagree.
  //
  // Reorder is two buttons, not a drag list — the same trade the panel grid's own reorder
  // makes. Keyboard- and screen-reader-operable by construction, where drag needs a parallel
  // keyboard path built anyway to be usable at all. Upgrade path: pointer drag ON TOP of this.
  const visible = createMemo(() => {
    const projected = shaping().fields
    const all = schema().fields.map((field) => field.id)
    return projected?.length ? projected.filter((id) => all.includes(id)) : all
  })
  const hidden = createMemo(() => schema().fields.filter((field) => !visible().includes(field.id)))

  const toggleField = (id: string, show: boolean) =>
    patch({ fields: show ? [...visible(), id] : visible().filter((entry) => entry !== id) })

  const moveField = (index: number, delta: -1 | 1) => {
    const order = [...visible()]
    const target = index + delta
    if (target < 0 || target >= order.length) return
    const [moved] = order.splice(index, 1)
    order.splice(target, 0, moved)
    patch({ fields: order })
  }

  // ── Views, filters and sort ─────────────────────────────────────────────────────────────────

  const chooseView = (kind: PanelViewKind) => {
    setView((current) => ({ ...current, kind }))
    // A board with no group-by has no columns, so choosing the view IS choosing a grouping. It is
    // written into shaping rather than held by the view, so switching to a table and back keeps it.
    if (kind === 'board' && !fieldById(shaping().groupBy)) patch({ groupBy: defaultGroupBy(schema()) })
  }

  /** Everything but `count` is an aggregate OVER a field, so choosing one chooses a field too. */
  const chooseAggregate = (aggregate: PanelAggregate) => setView((current) => ({
    ...current,
    aggregate,
    ...(aggregate === 'count' || fieldById(current.field)?.type === 'number' ? {} : { field: numbers()[0]?.id }),
  }))

  const filters = () => shaping().filters ?? []
  const sort = () => shaping().sort ?? []

  const editFilter = (index: number, next: (filter: PanelFilter) => PanelFilter) =>
    patch({ filters: filters().map((filter, at) => (at === index ? next(filter) : filter)) })
  const editSort = (index: number, next: (key: PanelSort) => PanelSort) =>
    patch({ sort: sort().map((key, at) => (at === index ? next(key) : key)) })

  // ── Output ──────────────────────────────────────────────────────────────────────────────────

  const submit = () => {
    const first = queries()[0]
    if (!first) return
    const fallbackTitle = () => {
      const entry = entryFor(first)
      return entry ? defaultPanelTitle(entry, props.collections) : first.collectionId
    }
    props.onSave(normalizePanel({
      // The id is the panel's identity across every placement that references it, so an edit keeps
      // it and only a new panel mints one (persist.ts § the Perses split).
      id: existing?.id ?? newPanelId(),
      title: title().trim() || fallbackTitle(),
      queries: queries(),
      ...(Object.keys(mapping()).length ? { mapping: mapping() } : {}),
      shaping: { ...shaping(), limit: parseLimit(limitText()) },
      view: view(),
      refresh: parseRefresh(refreshText()),
    }, schema()))
    props.onClose()
  }

  const removeButton = (label: string, onClick: () => void) => (
    <Button size="xs" variant="ghost" iconOnly aria-label={label} onClick={onClick}>
      <Icon name="x" />
    </Button>
  )

  return (
    <Modal
      title={existing ? 'Edit panel' : 'Add panel'}
      size="md"
      onClose={props.onClose}
      // The collection is the first decision for a new panel and already made for an existing one,
      // so the two flows want different landing spots. A bare `autofocus` does not survive a Solid
      // modal (ui/Modal.tsx).
      autoFocus={() => (existing ? titleBox : pickerHost?.querySelector<HTMLElement>('button')) ?? undefined}
      onKeyDown={(event) => {
        if (!(event.key === 'Enter' && (event.metaKey || event.ctrlKey))) return false
        submit()
        return true
      }}
    >
      <Modal.Body class="dash-editor">
        <Field
          label={queries().length > 1 ? 'Collections' : 'Collection'}
          hint="Add a second one and the panel unions their rows. Grouped by the plugin that provides it."
        >
          <Show when={queries().length}>
            <ul class="dash-editor-sources">
              <Index each={queries()}>
                {(query, index) => (
                  <li class="dash-editor-source">
                    <span class="dash-editor-field-name">{nameOf(query())}</span>
                    <span class="muted">{query().pluginId}</span>
                    {removeButton('Remove collection', () => removeSource(index))}
                  </li>
                )}
              </Index>
            </ul>
          </Show>
          <div class="dash-add-picker" ref={pickerHost}>
            <Picker<CollectionContribution>
              label={queries().length ? 'Add a collection' : 'Choose a collection'}
              ariaLabel="Collection"
              placeholder="Filter collections"
              emptyText="No collection matches."
              results={addable}
              rowLabel={(entry) => entry.name}
              rowDescription={(entry) => entry.pluginId}
              // Nothing is ever active: `addable` already drops what the panel holds, so the list is
              // exactly what may still be added.
              isActive={() => false}
              onSelect={addSource}
            />
          </div>
        </Field>

        {/* The honest cold case. A collection that describes itself in its answer promises nothing
            before the first read, and an editor that quietly showed an empty field list would look
            like the collection had none. */}
        <Show when={cold().length}>
          <Alert tone="info">
            {cold().map((page) => nameOf(page.query)).join(', ')}{' '}
            {cold().length === 1 ? 'describes itself' : 'describe themselves'} in the answer and{' '}
            {cold().length === 1 ? 'has' : 'have'} not been read on this device yet, so there are no
            fields to filter, sort or map on. Save the panel, let it load, then edit it again.
          </Alert>
        </Show>

        <Show when={queries().length}>
          <Field label="Title">
            <Input
              ref={(el) => { titleBox = el }}
              value={title()}
              onInput={(event) => { setTitleTouched(true); setTitle(event.currentTarget.value) }}
            />
          </Field>

          <Field label="View" hint="Only the views this panel's fields can support.">
            <SegmentedControl<PanelViewKind>
              ariaLabel="View"
              size="sm"
              value={view().kind as PanelViewKind}
              onChange={chooseView}
              options={viewsFor({ schema: schema() }).map((kind) => ({ value: kind, label: VIEW_LABELS[kind] }))}
            />
          </Field>

          {/* Group-by is shaping, so it is offered whenever the schema has a field with finite
              values rather than only under the board — set it here, flip to board, and the
              columns are already the ones you chose. */}
          <Show when={groupable().length}>
            <Field label="Group by" hint="A board's columns are this field's values, in the order they are declared.">
              <FieldSelect
                fields={groupable()}
                value={shaping().groupBy}
                ariaLabel="Group by"
                emptyLabel={view().kind === 'board' ? undefined : 'No grouping'}
                onChange={(id) => patch({ groupBy: id || undefined })}
              />
            </Field>
          </Show>

          <Show when={view().kind === 'stat'}>
            <div class="dash-editor-pair">
              <Field label="Measure">
                <Select size="sm" aria-label="Aggregate" value={view().aggregate ?? 'count'} onChange={(event) => chooseAggregate(event.currentTarget.value as PanelAggregate)}>
                  {/* Only `count` when there is no number to add up. Offering "Sum of" against a
                      collection of text fields is a choice that can only ever draw an em dash. */}
                  <For each={numbers().length ? AGGREGATES : AGGREGATES.slice(0, 1)}>
                    {(option) => <option value={option.value}>{option.label}</option>}
                  </For>
                </Select>
              </Field>
              {/* Only a number can be summed or averaged, so only number fields are offered —
                  the same gate as the view list, one level down. */}
              <Show when={(view().aggregate ?? 'count') !== 'count'}>
                <Field label="Field">
                  <FieldSelect
                    fields={numbers()}
                    value={view().field}
                    ariaLabel="Aggregated field"
                    onChange={(id) => setView((current) => ({ ...current, field: id }))}
                  />
                </Field>
              </Show>
            </div>
          </Show>

          {/* ── The mapping step ───────────────────────────────────────────────────────────── */}
          <Show when={mapped()}>
            <SectionHeader
              level="sub"
              actions={(
                <>
                  <Button size="xs" variant="ghost" onClick={addColumn}>
                    <Icon name="plus" /> Add column
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!columns().length}
                    title="Map each source value onto the column whose name matches it"
                    onClick={() => setMapping((current) => suggestValueMapping(pages(), current))}
                  >
                    Suggest
                  </Button>
                </>
              )}
            >
              Columns
            </SectionHeader>

            <Show
              when={columns().length}
              fallback={(
                <span class="dash-editor-note muted">
                  With no columns of your own each source keeps its own statuses, so a board shows
                  both providers' vocabularies side by side. Add columns to invent your own.
                </span>
              )}
            >
              <ul class="dash-editor-fields">
                <Index each={columns()}>
                  {(column, index) => (
                    <li class="dash-editor-row">
                      <Input
                        size="sm"
                        aria-label="Column name"
                        value={column().label}
                        onInput={(event) => editColumn(index, { label: event.currentTarget.value })}
                      />
                      <ToneSelect
                        ariaLabel={`${column().label} tone`}
                        value={column().tone}
                        onChange={(tone) => editColumn(index, { tone })}
                      />
                      {removeButton('Remove column', () => removeColumn(index))}
                    </li>
                  )}
                </Index>
              </ul>

              <Field label="Unmapped values" hint="A value no column claims still has to go somewhere.">
                <SegmentedControl<'catch-all' | 'hidden'>
                  ariaLabel="Unmapped values"
                  size="sm"
                  value={mapping().unmapped ?? 'catch-all'}
                  onChange={setUnmapped}
                  options={[{ value: 'catch-all', label: 'Catch-all column' }, { value: 'hidden', label: 'Hidden' }]}
                />
              </Field>

              <Index each={pages()}>
                {(page) => (
                  <>
                    <SectionHeader level="sub">{nameOf(page().query)}</SectionHeader>
                    <Show
                      when={statusValuesOf(page(), mapping()).length}
                      fallback={<span class="dash-editor-note muted">No status values to map yet.</span>}
                    >
                      <Index each={statusValuesOf(page(), mapping())}>
                        {(value) => (
                          <div class="dash-editor-row">
                            <span class="dash-editor-field-name">{value().label}</span>
                            <ColumnSelect
                              ariaLabel={`${value().label} column`}
                              columns={columns()}
                              value={mappedColumnId(mapping(), panelSourceKey(page().query), value().id)}
                              onChange={(columnId) => setMapping((current) =>
                                withMappedValue(current, panelSourceKey(page().query), value().id, columnId))}
                            />
                          </div>
                        )}
                      </Index>
                    </Show>
                  </>
                )}
              </Index>
            </Show>

            {/* Folded, because the role pre-fill is right almost always and a matrix nobody needs to
                touch should not be the first thing they see. */}
            <CollapsibleSection level="sub" label="Fields" persistKey="dashboards.field-mapping">
              <Index each={pages()}>
                {(page) => (
                  <>
                    <SectionHeader level="sub">{nameOf(page().query)}</SectionHeader>
                    <Index each={PANEL_FIELDS}>
                      {(field) => (
                        <Field label={field().name} layout="row">
                          <FieldSelect
                            fields={candidateFieldsFor(page(), field().id)}
                            value={sourceFieldFor(page(), field().id, mapping())}
                            ariaLabel={`${field().name} from ${nameOf(page().query)}`}
                            emptyLabel="None"
                            onChange={(id) => setSourceField(panelSourceKey(page().query), field().id, id)}
                          />
                        </Field>
                      )}
                    </Index>
                  </>
                )}
              </Index>
            </CollapsibleSection>
          </Show>

          {/* Rendered by the host, meant by the plugin: a param's value crosses back opaquely
              and nothing here knows what `repo` is for. */}
          <Show when={queries().some((query) => entryFor(query)?.params?.length)}>
            <SectionHeader level="sub">Inputs</SectionHeader>
            <Index each={queries()}>
              {(query, index) => (
                <Show when={entryFor(query())?.params?.length}>
                  <Show when={queries().length > 1}>
                    <span class="dash-editor-note muted">{nameOf(query())}</span>
                  </Show>
                  <Index each={entryFor(query())?.params ?? []}>
                    {(param) => (
                      <Field label={param().name} layout="row">
                        <ParamInput
                          param={param()}
                          value={query().params?.[param().id] ?? ''}
                          onChange={(value) => setParam(index, param().id, value)}
                        />
                      </Field>
                    )}
                  </Index>
                </Show>
              )}
            </Index>
          </Show>

          <Show when={schema().fields.length}>
            <SectionHeader
              level="sub"
              actions={(
                <Button size="xs" variant="ghost" onClick={() => patch({ filters: [...filters(), defaultFilterFor(schema().fields[0])] })}>
                  <Icon name="plus" /> Add filter
                </Button>
              )}
            >
              Filters
            </SectionHeader>
            <Index each={filters()}>
              {(filter, index) => {
                const field = () => fieldById(filter().field)
                return (
                  <div class="dash-editor-row">
                    <FieldSelect
                      fields={schema().fields}
                      value={filter().field}
                      ariaLabel="Filtered field"
                      onChange={(id) => {
                        const next = fieldById(id)
                        if (next) editFilter(index, (current) => retargetFilter(current, next))
                      }}
                    />
                    <OperatorSelect
                      field={field()}
                      value={filter().op}
                      onChange={(op) => {
                        const on = field()
                        if (on) editFilter(index, (current) => withOperator(current, on, op))
                      }}
                    />
                    <Show when={operatorNeedsValue(filter().op) && field()}>
                      {(on) => (
                        <ValueInput
                          field={on()}
                          value={filter().value}
                          onChange={(value) => editFilter(index, (current) => ({ ...current, value }))}
                        />
                      )}
                    </Show>
                    {removeButton('Remove filter', () => patch({ filters: filters().filter((_, at) => at !== index) }))}
                  </div>
                )
              }}
            </Index>

            <SectionHeader
              level="sub"
              actions={(
                <Button size="xs" variant="ghost" onClick={() => patch({ sort: [...sort(), { field: schema().fields[0].id, direction: 'asc' }] })}>
                  <Icon name="plus" /> Add sort
                </Button>
              )}
            >
              Sort
            </SectionHeader>
            <Index each={sort()}>
              {(key, index) => (
                <div class="dash-editor-row">
                  <FieldSelect
                    fields={schema().fields}
                    value={key().field}
                    ariaLabel="Sorted field"
                    onChange={(id) => editSort(index, (current) => ({ ...current, field: id }))}
                  />
                  <SegmentedControl<'asc' | 'desc'>
                    ariaLabel="Direction"
                    size="sm"
                    value={key().direction}
                    onChange={(direction) => editSort(index, (current) => ({ ...current, direction }))}
                    options={[{ value: 'asc', label: 'Asc' }, { value: 'desc', label: 'Desc' }]}
                  />
                  {removeButton('Remove sort key', () => patch({ sort: sort().filter((_, at) => at !== index) }))}
                </div>
              )}
            </Index>

            <SectionHeader level="sub">Fields</SectionHeader>
            <ul class="dash-editor-fields">
              <Index each={visible()}>
                {(id, index) => (
                  <li class="dash-editor-field">
                    <Button
                      size="xs"
                      variant="ghost"
                      iconOnly
                      aria-label="Hide field"
                      onClick={() => toggleField(id(), false)}
                    >
                      <Icon name="eye" />
                    </Button>
                    <span class="dash-editor-field-name">{fieldById(id())?.name ?? id()}</span>
                    <Button size="xs" variant="ghost" iconOnly aria-label="Move up" disabled={index === 0} onClick={() => moveField(index, -1)}>
                      <Icon name="chevron-up" />
                    </Button>
                    <Button size="xs" variant="ghost" iconOnly aria-label="Move down" disabled={index === visible().length - 1} onClick={() => moveField(index, 1)}>
                      <Icon name="chevron-down" />
                    </Button>
                  </li>
                )}
              </Index>
              <Index each={hidden()}>
                {(field) => (
                  <li class="dash-editor-field" data-hidden="">
                    <Button size="xs" variant="ghost" iconOnly aria-label="Show field" onClick={() => toggleField(field().id, true)}>
                      <Icon name="eye-off" />
                    </Button>
                    <span class="dash-editor-field-name muted">{field().name}</span>
                  </li>
                )}
              </Index>
            </ul>
          </Show>

          <div class="dash-editor-pair">
            <Field label="Limit" hint="Rows kept after sorting. Empty keeps them all.">
              <Input
                size="sm"
                type="number"
                min="0"
                value={limitText()}
                onInput={(event) => setLimitText(event.currentTarget.value)}
              />
            </Field>
            <Field label="Refresh" hint={refreshHint(pages().map((page) => entryFor(page.query)?.refresh))}>
              <Input
                size="sm"
                type="number"
                min="0"
                value={refreshText()}
                onInput={(event) => setRefreshText(event.currentTarget.value)}
              />
            </Field>
          </div>
        </Show>
      </Modal.Body>

      <Modal.Actions>
        <Button variant="bare" onClick={props.onClose}>Cancel</Button>
        <Button variant="solid" tone="accent" disabled={!queries().length} onClick={submit}>
          {existing ? 'Save' : 'Add panel'}
        </Button>
      </Modal.Actions>
    </Modal>
  )
}

/** Each source polls at its own declared interval unless the panel overrides them all, so the hint
 *  names the range rather than pretending there is one number. */
function refreshHint(declared: readonly (number | undefined)[]): string {
  const seconds = [...new Set(declared.flatMap((value) => value ?? []))].sort((a, b) => a - b)
  if (!seconds.length) return 'Seconds. Empty never polls.'
  return `Seconds. Empty follows each collection's own (${seconds.join(', ')}s).`
}
