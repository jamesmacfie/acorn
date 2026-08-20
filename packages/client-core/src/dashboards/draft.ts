import { createMemo, createSignal } from 'solid-js'
import type { PluginCollectionField } from '@acorn/protocol/collections.ts'
import { activeNodeId } from '../node/activeNode'
import type { CollectionContribution } from '../registries/collections'
import { chartSeriesFields, chartShapesFor, defaultChartAxis, type ChartShape } from './chart'
import { collectionsForPicker, defaultPanelTitle } from './compose'
import { cachedCollectionAnsweredAt, cachedCollectionPage, createCollectionCacheRevision } from './data'
import {
  defaultGroupBy,
  normalizePanel,
  parseLimit,
  parseRefresh,
  schemaOf,
  settleComposition,
  trendsFor,
  withViewKind,
  type PanelComposition,
} from './editor'
import {
  isMapped,
  newColumnId,
  panelSchema,
  suggestFieldMapping,
  suggestValueMapping,
  unionRows,
  withMappedValue,
  type PanelSourcePage,
} from './mapping'
import {
  newPanelId,
  type PanelAggregate,
  type PanelDefinition,
  type PanelFieldDef,
  type PanelFilter,
  type PanelMapping,
  type PanelQuery,
  type PanelShaping,
  type PanelSort,
  type PanelTone,
  type PanelView,
  type PanelViewKind,
} from './model'
import { groupableFields, shapeRows, visibleFields } from './shaping'

// ONE DRAFT PANEL, held in memory, with every rule the two presentations share
// (docs/dashboards.md § The generated editor, docs/dashboards.md § The generated editor).
//
// It exists because there are now TWO ways to compose a panel — the single-sheet editor and the
// staged wizard — and "two presentations, one truth" is only true if the truth lives somewhere
// neither of them owns. Everything here is form state and the handlers over it; every rule that can
// be wrong is still a pure function in `editor.ts` / `chart.ts` / `mapping.ts` and merely CALLED from
// here, because vitest in this repo runs in node with no Solid plugin and a signal is not testable.
//
// NOTHING IT DOES PERSISTS. The id is minted on creation so the preview has one, the definition is
// derived on demand, and closing either surface without committing writes nothing at all.
//
// The two signals `view` and `shaping` are ONE draft as far as `editor.ts` is concerned; keeping them
// apart here is a form-state convenience, which is why every composed change goes through `compose`.

export function createPanelDraft(props: {
  collections: readonly CollectionContribution[]
  /** Absent for the add flow. */
  panel?: PanelDefinition
}) {
  const existing = props.panel
  // Captured once: a node switch closes this window's surface anyway, and re-reading it per render
  // would make the cached-schema lookup below depend on where the rail happens to be pointing.
  const nodeId = activeNodeId() ?? ''
  // The panel's identity across every placement that references it, so an edit keeps it and only a
  // new panel mints one (persist.ts § the Perses split). Minted HERE rather than on commit because
  // the preview renders a definition and a definition has an id; nothing is written until commit.
  const id = existing?.id ?? newPanelId()

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

  const entryFor = (query: PanelQuery): CollectionContribution | undefined =>
    props.collections.find((entry) => entry.pluginId === query.pluginId && entry.collectionId === query.collectionId)

  // The single door to "which schema does this source have": the answered one out of the node's own
  // cache, else the declared one (editor.ts § schemaOf). A collection that describes itself in its
  // response has nothing here until a panel over it has actually drawn once — which the cold notice
  // says out loud rather than presenting an empty form.
  //
  // REACTIVE, via a cache subscription (data.ts § createCollectionCacheRevision), because
  // `getQueryData` is only a snapshot: an answer landing while a surface is open — the panel was just
  // placed, or a sibling panel over the same collection fetched — has to fill the gated sections and
  // the wizard's preview in place rather than waiting for a reopen.
  //
  // THE ROWS ARE THE CACHE'S TOO, and they are the wizard preview's only data path. Neither surface
  // issues a fetch of its own: whether an editor may RUN a collection is the run-once-and-pin question
  // and it is answered in `dynamic-collections.md`, by a person pressing a button.
  const cacheRevision = createCollectionCacheRevision(nodeId)
  const pages = createMemo((): PanelSourcePage[] => {
    cacheRevision()
    return queries().map((query) => {
      const cached = cachedCollectionPage(query, nodeId)
      return { query, schema: schemaOf(entryFor(query), cached?.schema), rows: cached?.rows ?? [] }
    })
  })

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

  /** Apply what a pure composition rule decided. */
  const compose = (next: PanelComposition) => {
    setView(next.view)
    setShaping(next.shaping)
  }

  // An existing board whose grouped field the plugin has since dropped. Settled once, on open, so the
  // select and the definition agree — a control showing a value the panel does not hold is how a
  // person saves something other than what they read.
  if (view().kind === 'board' && !fieldById(shaping().groupBy)) patch({ groupBy: defaultGroupBy(schema()) })

  // ── Sources ───────────────────────────────────────────────────────────────────────────────────

  /** The collections still addable, filtered — the picker's list and the wizard gallery's, one
   *  derivation so the two cannot offer different things. */
  const addable = (text = '') => collectionsForPicker(
    props.collections.filter((entry) => !queries().some((query) =>
      query.pluginId === entry.pluginId && query.collectionId === entry.collectionId)),
    text,
  )

  /** Re-gate everything the source list decides, after it changes (editor.ts § settleComposition). */
  const settle = () => compose(settleComposition({ view: view(), shaping: shaping() }, schema()))

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
    // THE ROLE PRE-FILL, and the only reason the role vocabulary exists (docs/dashboards.md § The two
    // vocabularies): the host proposes "your title is that source's title, your status is its status"
    // and writes the proposal into the config, where the Fields matrix shows exactly what it decided.
    // It never guesses silently and it never overwrites an answer the person already gave.
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

  const setParam = (index: number, paramId: string, value: string) =>
    setQueries((current) => current.map((query, at) =>
      at === index ? { ...query, params: { ...(query.params ?? {}), [paramId]: value } } : query))

  // ── Mapping ───────────────────────────────────────────────────────────────────────────────────

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
    const kept = (current.columns ?? []).filter((_, at) => at !== index)
    // The column's own value mappings go with it — an entry keyed by a column that no longer exists
    // is unreachable config, and `pruneMapping` would drop it on save anyway.
    const bySource = Object.fromEntries(
      Object.entries(current.bySource ?? {}).flatMap(([key, entries]) => {
        const { [removed?.id ?? '']: _gone, ...rest } = entries
        return Object.keys(rest).length ? [[key, rest] as const] : []
      }),
    )
    const next: PanelMapping = { ...current, columns: kept }
    if (Object.keys(bySource).length) next.bySource = bySource
    else delete next.bySource
    return next
  })

  const mapValue = (sourceKey: string, value: string, columnId: string | undefined) =>
    setMapping((current) => withMappedValue(current, sourceKey, value, columnId))

  const suggestValues = () => setMapping((current) => suggestValueMapping(pages(), current))

  const setSourceField = (key: string, panelFieldId: string, sourceFieldId: string) =>
    setMapping((current) => ({
      ...current,
      fields: { ...(current.fields ?? {}), [key]: { ...(current.fields?.[key] ?? {}), [panelFieldId]: sourceFieldId } },
    }))

  // ── The user's own panel fields ───────────────────────────────────────────────────────────────

  const extraFields = () => mapping().extraFields ?? []

  const addField = () => setMapping((current) => ({
    ...current,
    extraFields: [
      ...(current.extraFields ?? []),
      // `text` because it is the type every collection has some of, and the two cases that motivated
      // invented fields — a repo name, an issue identifier — are both text.
      { id: newColumnId(), label: `Field ${(current.extraFields?.length ?? 0) + 1}`, type: 'text' as const },
    ],
  }))

  const editField = (index: number, change: Partial<PanelFieldDef>) => setMapping((current) => ({
    ...current,
    extraFields: (current.extraFields ?? []).map((field, at) => (at === index ? { ...field, ...change } : field)),
  }))

  const removeField = (index: number) => setMapping((current) => {
    const removed = current.extraFields?.[index]
    const extra = (current.extraFields ?? []).filter((_, at) => at !== index)
    // Its per-source answers go with it. `pruneMapping` would drop them on save anyway; doing it here
    // as well means the matrix on screen is the mapping that will be stored.
    const fields = Object.fromEntries(
      Object.entries(current.fields ?? {}).flatMap(([key, entries]) => {
        const { [removed?.id ?? '']: _gone, ...rest } = entries
        return Object.keys(rest).length ? [[key, rest] as const] : []
      }),
    )
    const next: PanelMapping = { ...current }
    if (extra.length) next.extraFields = extra
    else delete next.extraFields
    if (Object.keys(fields).length) next.fields = fields
    else delete next.fields
    return next
  })

  const setUnmapped = (destination: 'catch-all' | 'hidden') => setMapping((current) => {
    const next: PanelMapping = { ...current }
    if (destination === 'hidden') next.unmapped = 'hidden'
    else delete next.unmapped
    return next
  })

  // ── Projection ────────────────────────────────────────────────────────────────────────────────
  // `shaping.fields` is the VISIBLE list, in order; everything the schema declares and the list does
  // not name is hidden. Deriving both from that one array is what keeps "show it again" and "move it
  // up" from needing two pieces of state that can disagree.

  const visible = createMemo(() => {
    const projected = shaping().fields
    const all = schema().fields.map((field) => field.id)
    return projected?.length ? projected.filter((entry) => all.includes(entry)) : all
  })
  const hidden = createMemo(() => schema().fields.filter((field) => !visible().includes(field.id)))

  const toggleField = (fieldId: string, show: boolean) =>
    patch({ fields: show ? [...visible(), fieldId] : visible().filter((entry) => entry !== fieldId) })

  const moveField = (index: number, delta: -1 | 1) => {
    const order = [...visible()]
    const target = index + delta
    if (target < 0 || target >= order.length) return
    const [moved] = order.splice(index, 1)
    order.splice(target, 0, moved)
    patch({ fields: order })
  }

  // ── Views, filters and sort ───────────────────────────────────────────────────────────────────

  /** The board's implied grouping and the chart's inferred axes, both in `editor.ts § withViewKind`
   *  rather than here — the sheet's segmented control and the wizard's cards apply the same rules to
   *  the same pair, and a second copy is how two presentations come to disagree about what choosing a
   *  view means. */
  const chooseView = (kind: PanelViewKind) => compose(withViewKind({ view: view(), shaping: shaping() }, kind, schema()))

  const shapes = createMemo(() => chartShapesFor(schema()))
  /** The shape the panel will actually draw: its own, if this schema still supports it. */
  const shape = (): ChartShape => {
    const wanted = view().shape
    return wanted && shapes().includes(wanted) ? wanted : shapes()[0] ?? 'bar'
  }
  /** The enums this chart may be split into series by — every one for a line, every one but the
   *  category axis for a bar (chart.ts § chartSeriesFields). Empty means the control is not offered,
   *  which is how the grouped bar stays unrepresentable over a single-enum schema. */
  const seriesFields = createMemo(() => chartSeriesFields(schema(), shape(), view(), shaping()))
  const chooseShape = (next: ChartShape) => setView((current) => {
    // A bar's category axis and a line's time axis are different fields, so the old `x` cannot be
    // carried across — it is re-inferred for the shape that is now selected.
    const x = defaultChartAxis(schema(), next, shaping())
    // And a line split by the enum that just became the bar's category axis is a split `buildBar`
    // drops anyway (chart.ts § the grouped bar); dropping it here too means the select is never
    // showing a value the panel does not hold.
    return { ...current, shape: next, x, ...(current.series && current.series === x ? { series: undefined } : {}) }
  })

  const trends = createMemo(() => trendsFor(schema()))
  /** Turning the trend off takes the comparison with it: a delta with no series behind it is config
   *  that renders nothing, and it would come back the next time somebody flicked the trend on. */
  const chooseTrend = (entry: 'none' | NonNullable<PanelView['trend']>) => setView((current) => ({
    ...current,
    trend: entry === 'none' ? undefined : entry,
    ...(entry === 'history' ? {} : { compare: undefined, good: undefined }),
  }))

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

  // ── Output ────────────────────────────────────────────────────────────────────────────────────

  /** THE draft, as the definition it would be saved as — normalised, so what the preview draws and
   *  what a commit writes are the same object and cannot drift. */
  const definition = createMemo((): PanelDefinition => {
    const first = queries()[0]
    const entry = first && entryFor(first)
    const fallbackTitle = entry
      ? defaultPanelTitle(entry, props.collections)
      : first?.collectionId ?? ''
    return normalizePanel({
      id,
      title: title().trim() || fallbackTitle,
      queries: queries(),
      ...(Object.keys(mapping()).length ? { mapping: mapping() } : {}),
      shaping: { ...shaping(), limit: parseLimit(limitText()) },
      view: view(),
      refresh: parseRefresh(refreshText()),
    }, schema())
  })

  /** What a view component needs to draw this draft, over the SAME compose/mapping/shaping pipeline a
   *  placed panel runs (data.ts § createPanelData) — from cached rows only. There is exactly one way
   *  to draw a panel and this is it, minus the fetching. */
  const previewSchema = createMemo(() => panelSchema(pages(), definition().mapping))
  const preview = {
    schema: previewSchema,
    rows: createMemo(() =>
      shapeRows(unionRows(pages(), definition().mapping), previewSchema(), definition().shaping)),
    fields: createMemo(() => visibleFields(previewSchema(), definition().shaping)),
    /** Whether this device has ever read one of these sources. ANSWERED, not "has rows": a
     *  collection that legitimately returned nothing has been read, and drawing "not read yet" over
     *  it would be the cold notice lying. `pages` subscribes to the cache revision, so this ticks
     *  when an answer lands with the surface open. */
    answered: () => pages().some((page) => cachedCollectionAnsweredAt(page.query, nodeId) !== undefined),
  }

  return {
    existing,
    nodeId,
    /** Ticks when a collection page lands in this node's cache. Exposed for the one reader that looks
     *  at collections the draft does not hold yet — the wizard's gallery cards, whose row counts and
     *  read-at times come out of the same cache (data.ts § createCollectionCacheRevision). */
    cacheRevision,
    collections: () => props.collections,
    // State
    queries,
    mapping,
    title,
    typeTitle: (value: string) => { setTitleTouched(true); setTitle(value) },
    view,
    shaping,
    limitText,
    setLimitText,
    refreshText,
    setRefreshText,
    // Derived
    entryFor,
    nameOf,
    pages,
    schema,
    mapped,
    columns,
    cold,
    fieldById,
    groupable,
    numbers,
    visible,
    hidden,
    filters,
    sort,
    extraFields,
    shapes,
    shape,
    seriesFields,
    trends,
    addable,
    ready: () => queries().length > 0,
    definition,
    preview,
    // Actions
    patch,
    addSource,
    removeSource,
    setParam,
    addColumn,
    editColumn,
    removeColumn,
    mapValue,
    suggestValues,
    setSourceField,
    addField,
    editField,
    removeField,
    setUnmapped,
    toggleField,
    moveField,
    chooseView,
    chooseShape,
    chooseTrend,
    chooseAggregate,
    setAxis: (x: string) => setView((current) => ({ ...current, x })),
    setSeries: (series: string | undefined) => setView((current) => ({ ...current, series })),
    setMeasureField: (field: string) => setView((current) => ({ ...current, field })),
    setCompare: (entry: 'none' | NonNullable<PanelView['compare']>) => setView((current) => ({
      ...current,
      compare: entry === 'none' ? undefined : entry,
      ...(entry === 'none' ? { good: undefined } : {}),
    })),
    setGood: (entry: 'none' | NonNullable<PanelView['good']>) =>
      setView((current) => ({ ...current, good: entry === 'none' ? undefined : entry })),
    editFilter,
    editSort,
  }
}

export type PanelDraft = ReturnType<typeof createPanelDraft>
