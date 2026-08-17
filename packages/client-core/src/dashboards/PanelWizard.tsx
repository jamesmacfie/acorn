import { createMemo, createSignal, For, Show } from 'solid-js'
import type { PluginCollectionFieldType } from '@acorn/protocol/collections.ts'
import { formatRelativeTime } from '@acorn/dashboards-core/relativeTime.ts'
import type { CollectionContribution } from '../registries/collections'
import { Button, Card, Chip, Field, Input, SectionHeader, SegmentedControl } from '../ui/primitives'
import { brandMarkRegistry } from '../ui/brandMarks'
import Icon from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { cachedCollectionAnsweredAt, cachedCollectionPage } from './data'
import { createPanelDraft } from './draft'
import { collectionCardMeta, viewAvailability, type ViewReasonCode } from './editor'
import { COLS, sizePresets, type Rect } from './layout'
import type { PanelDefinition, PanelViewKind } from './model'
import {
  ColdNotice,
  GroupByField,
  LimitField,
  MappingSection,
  ParamInputs,
  RefreshField,
  ShapingSection,
  SourceRows,
  TitleField,
  ViewOptions,
  VIEW_LABELS,
} from './PanelForm'
import PanelPreview from './PanelPreview'
import { addTab, setActiveHomeTab } from './homeTab'
import {
  dashboards,
  HOME_PLACEMENT,
  homeTabs,
  homeTabScope,
  setHomeTabs,
  type PlacementScope,
  type PlacementSurface,
} from './persist'
import './dashboards.css'

// THE PANEL WIZARD (docs/future/dashboards/wizard.md) — panel CREATION, staged, with the panel
// visible while it is being composed.
//
// It exists because "Add panel" used to open one long form and the panel was first seen after saving:
// nobody can pick a view by reading a select, the field vocabulary was invisible until rows arrived,
// and the cold-schema case was a paragraph of prose. Four questions in order — data, view, shape,
// place — with the live preview beside every one of them.
//
// TWO PRESENTATIONS, ONE TRUTH. Every control here is a section of `PanelForm.tsx` over the same
// `createPanelDraft` the sheet uses, and every rule is a pure function in `editor.ts` / `chart.ts` /
// `mapping.ts`. This file owns the STAGING and nothing else: the words for a disabled view card, the
// step order, and the starting rect. If a step ever needs a rule that is not already a pure function,
// that function goes in the pure module first.
//
// NOTHING IS WRITTEN UNTIL THE LAST STEP COMMITS. Escape or backdrop at any step discards the draft
// entirely — the same "nothing was written" promise the grid gesture makes, and it is free for the
// same reason: the draft is memory and the commit is one call.

type StepId = 'data' | 'view' | 'shape' | 'place'

const STEPS: readonly { id: StepId; title: string; hint: string }[] = [
  { id: 'data', title: 'Data', hint: 'Which records the panel is about.' },
  { id: 'view', title: 'View', hint: 'How they are drawn. Only what this data can support.' },
  { id: 'shape', title: 'Shape', hint: 'Which of them, in what order, and what is measured.' },
  { id: 'place', title: 'Place', hint: 'Where it goes and how big it arrives.' },
]

/** A small schematic for each view kind — the whole reason the View step is cards rather than a
 *  select. Lucide names, resolved by `Icon`; every one is in the set (an unmatched name would render
 *  as its own text). */
const VIEW_GLYPHS: Record<PanelViewKind, string> = {
  stat: 'hash',
  list: 'list',
  table: 'table',
  board: 'columns-3',
  chart: 'chart-column',
}

const VIEW_BLURBS: Record<PanelViewKind, string> = {
  stat: 'One number over the rows.',
  list: 'A row each, title first.',
  table: 'Every field, in columns.',
  board: 'Columns of cards, grouped.',
  chart: 'Bars or a line over time.',
}

/** WHY a card is disabled, in words. `viewAvailability` owns the truth and answers in CODES, so these
 *  sentences can be rewritten without touching a test (editor.ts § viewAvailability). The cold case is
 *  deliberately not phrased as a refusal: nobody has checked yet. */
const VIEW_REASONS: Record<ViewReasonCode, string> = {
  ok: '',
  'needs-enum': 'Needs a status-like field. This data has none.',
  'needs-axis': 'Needs a category or a date to plot against.',
  'cold-schema': 'Unknown until this collection has been read once.',
}

/** The type vocabulary, as glyphs, for the gallery's field chips. Same seven the wire declares. */
const TYPE_GLYPHS: Record<PluginCollectionFieldType, string> = {
  text: 'type',
  number: 'hash',
  datetime: 'calendar',
  enum: 'circle-dot',
  boolean: 'toggle-left',
  person: 'user',
  link: 'link',
}

/** The Dashboard picker's "make one" option. Not a tab id: minted ids are eight hex characters and
 *  the default tab's is empty, so nothing real can answer to it. */
const NEW_TAB = '+'

type Preset = 's' | 'm' | 'l'

const PRESET_LABELS: Record<Preset, string> = { s: 'S', m: 'M', l: 'L' }

export default function PanelWizard(props: {
  collections: readonly CollectionContribution[]
  /** The placement the wizard was launched from. It is the default destination, not the only one. */
  scope: PlacementScope
  onCreate: (panel: PanelDefinition, scope: PlacementScope, rect: Rect) => void
  /** The quiet escape: hand the draft to the single sheet, nothing lost. */
  onOpenEditor: (panel: PanelDefinition) => void
  onClose: () => void
}) {
  const draft = createPanelDraft(props)

  const [stepIndex, setStepIndex] = createSignal(0)
  const [filter, setFilter] = createSignal('')
  const [preset, setPreset] = createSignal<Preset>('m')
  const [surface, setSurface] = createSignal<PlacementSurface>(props.scope.surface)
  const [tabId, setTabId] = createSignal(props.scope.surface === 'home' ? props.scope.ownerId ?? '' : '')

  const step = () => STEPS[stepIndex()]
  let heading: HTMLHeadingElement | undefined

  /** Focus follows the step, so a keyboard or screen-reader user lands on what changed rather than
   *  back at the top of a dialog they have already read. */
  const goTo = (index: number) => {
    setStepIndex(Math.max(0, Math.min(STEPS.length - 1, index)))
    queueMicrotask(() => heading?.focus())
  }

  // ── Step 1: the gallery ─────────────────────────────────────────────────────────────────────

  /** Everything a card shows, with ZERO new wire data (editor.ts § collectionCardMeta): the
   *  manifest's own promise plus whatever this device happens to have cached. The cache revision is
   *  read so a page landing mid-wizard turns "not read on this device yet" into a row count in place. */
  const metaFor = (entry: CollectionContribution) => {
    draft.cacheRevision()
    const query = { pluginId: entry.pluginId, collectionId: entry.collectionId }
    const page = cachedCollectionPage(query, draft.nodeId)
    const answeredAt = cachedCollectionAnsweredAt(query, draft.nodeId)
    return collectionCardMeta(entry, { ...(page ? { page } : {}), ...(answeredAt ? { answeredAt } : {}) })
  }

  const cardFacts = (meta: ReturnType<typeof metaFor>): string => {
    const parts: string[] = []
    // Absent rows and absent answered-at are the same fact said once: nobody here has read it.
    if (meta.answeredAt === undefined) parts.push('Not read on this device yet')
    else parts.push(`${meta.rows ?? 0} ${meta.rows === 1 ? 'row' : 'rows'} · read ${formatRelativeTime(meta.answeredAt)}`)
    if (meta.refresh !== undefined) parts.push(`refreshes every ${meta.refresh}s`)
    if (meta.selfDescribing) parts.push('describes itself in the answer')
    return parts.join(' · ')
  }

  // ── Step 2: the five cards ──────────────────────────────────────────────────────────────────

  const availability = createMemo(() => viewAvailability(draft.schema()))

  // ── Step 4: destination and footprint ───────────────────────────────────────────────────────

  const tabs = createMemo(() => homeTabs(dashboards()))

  /** The Home destinations: the dashboards that exist, plus a new one.
   *
   *  THIS IS ALSO THE ONLY DOOR TO A SECOND DASHBOARD, and that is deliberate. The tab bar owns the
   *  `+`, but the bar exists only past one tab — and Home with one dashboard is pixel-identical to
   *  what it was before tabs (tabs.md § UX), so the first one cannot be created from a button that
   *  is not there. "Where should this panel go? Somewhere new" is the honest place to ask. */
  const tabOptions = () => [
    ...(tabs().length ? tabs() : [{ id: '', name: 'Home' }]),
    { id: NEW_TAB, name: 'New dashboard…' },
  ]

  /** Where a commit lands; Home is the only surface with a choice inside it, because a placement you
   *  cannot see is not one you can be asked to aim at.
   *
   *  Creating the destination happens HERE rather than when the option is picked, so the wizard keeps
   *  its promise that nothing is written until the last step commits. */
  const resolveTarget = (): PlacementScope => {
    if (surface() !== 'home') return props.scope
    if (tabId() !== NEW_TAB) return tabs().length > 1 ? homeTabScope(tabId()) : HOME_PLACEMENT
    const created = addTab(tabs())
    setHomeTabs(created.tabs)
    // Land on the dashboard the panel went to. Placing it somewhere invisible is the one outcome
    // nobody asked for.
    setActiveHomeTab(created.id)
    return homeTabScope(created.id)
  }

  const rect = (): Rect => sizePresets(draft.definition().view.kind)[preset()]

  const commit = () => {
    if (!draft.ready()) return
    props.onCreate(draft.definition(), resolveTarget(), rect())
    props.onClose()
  }

  const openEditor = () => {
    props.onOpenEditor(draft.definition())
    props.onClose()
  }

  /** The 12-cell strip a preset draws as. A footprint is easier to choose by looking at than by
   *  reading "6 columns", which is the same argument the View step's cards make. */
  const strip = (width: number) => (
    <span class="dash-preset-track" aria-hidden="true">
      <span class="dash-preset-fill" style={{ width: `${(width / COLS) * 100}%` }} />
    </span>
  )

  return (
    <Modal
      title="Add panel"
      size="wide"
      onClose={props.onClose}
      autoFocus={() => heading}
      onKeyDown={(event) => {
        if (!(event.key === 'Enter' && (event.metaKey || event.ctrlKey))) return false
        commit()
        return true
      }}
    >
      <Modal.Body class="dash-wizard">
        {/* The rail. A list with `aria-current="step"`, so the position is announced rather than only
            drawn; on a narrow window CSS turns it into a horizontal strip and no second markup path
            exists. Steps are navigable both ways — a step whose prerequisites vanished re-derives
            rather than blocks (editor.ts § settleComposition). */}
        <ol class="dash-wizard-rail">
          <For each={STEPS}>
            {(entry, index) => (
              <li>
                <button
                  type="button"
                  class="dash-wizard-step"
                  aria-current={index() === stepIndex() ? 'step' : undefined}
                  disabled={index() > 0 && !draft.ready()}
                  onClick={() => goTo(index())}
                >
                  <span class="dash-wizard-step-index" aria-hidden="true">{index() + 1}</span>
                  <span>{entry.title}</span>
                </button>
              </li>
            )}
          </For>
        </ol>

        <section class="dash-wizard-body" aria-labelledby="dash-wizard-heading">
          <h2 id="dash-wizard-heading" class="dash-wizard-heading" tabindex={-1} ref={heading}>
            {step().title}
          </h2>
          <p class="dash-editor-note muted">{step().hint}</p>

          {/* ── Data ────────────────────────────────────────────────────────────────────────── */}
          <Show when={step().id === 'data'}>
            <SourceRows draft={draft} />
            <Field label={draft.queries().length ? 'Add another collection' : 'Choose a collection'}>
              <Input
                size="sm"
                aria-label="Filter collections"
                placeholder="Filter collections"
                value={filter()}
                onInput={(event) => setFilter(event.currentTarget.value)}
              />
            </Field>
            <div class="dash-gallery">
              <For
                each={draft.addable(filter())}
                fallback={(
                  <span class="dash-editor-note muted">
                    {filter() ? 'No collection matches.' : 'Every collection here is already on this panel.'}
                  </span>
                )}
              >
                {(entry) => {
                  const meta = createMemo(() => metaFor(entry))
                  // The board card's own classes, reused: a gallery card is a title, a mark and some
                  // meta, which is exactly what those are (dashboards.css § Board).
                  return (
                    <Card interactive pad="sm" class="dash-card" onActivate={() => draft.addSource(entry)}>
                      <span class="dash-card-title">
                        {/* The plugin's own mark where it registered one, its id where it did not —
                            `Icon` renders an unmatched name as text, so naming a brand blind would
                            print the literal string (views/Provenance.tsx says the same). */}
                        <Show when={brandMarkRegistry.get(entry.pluginId)}>
                          <Icon name={`brand:${entry.pluginId}`} title={entry.pluginId} />
                        </Show>
                        <span class="dash-editor-field-name">{entry.name}</span>
                        <span class="muted">{entry.pluginId}</span>
                      </span>
                      <Show when={meta().fields.length}>
                        <span class="dash-card-meta dash-collection-chips">
                          <For each={meta().fields}>
                            {(field) => (
                              <Chip size="xs" title={field.type} leading={<Icon name={TYPE_GLYPHS[field.type]} />}>
                                {field.name}
                              </Chip>
                            )}
                          </For>
                        </span>
                      </Show>
                      <span class="dash-card-meta">{cardFacts(meta())}</span>
                    </Card>
                  )
                }}
              </For>
            </div>
            {/* A param changes what the rows ARE, so it is asked here rather than beside the shaping. */}
            <ParamInputs draft={draft} />
            <ColdNotice draft={draft} />
          </Show>

          {/* ── View ────────────────────────────────────────────────────────────────────────── */}
          <Show when={step().id === 'view'}>
            <div class="dash-gallery" role="radiogroup" aria-label="View">
              <For each={availability()}>
                {(entry) => (
                  <Card
                    interactive
                    pad="sm"
                    class="dash-card"
                    disabled={!entry.ok}
                    selected={draft.view().kind === entry.kind}
                    onActivate={() => draft.chooseView(entry.kind)}
                  >
                    <span class="dash-card-title">
                      <span class="dash-view-glyph" aria-hidden="true"><Icon name={VIEW_GLYPHS[entry.kind]} /></span>
                      <span class="dash-editor-field-name">{VIEW_LABELS[entry.kind]}</span>
                    </span>
                    {/* Plain text, not a tooltip: a reason nobody can reach is not a reason. */}
                    <span class="dash-card-meta">
                      {entry.ok ? VIEW_BLURBS[entry.kind] : VIEW_REASONS[entry.reason]}
                    </span>
                  </Card>
                )}
              </For>
            </div>
          </Show>

          {/* ── Shape ───────────────────────────────────────────────────────────────────────── */}
          <Show when={step().id === 'shape'}>
            <GroupByField draft={draft} />
            <ViewOptions draft={draft} />
            <MappingSection draft={draft} />
            <ShapingSection draft={draft} />
            <LimitField draft={draft} />
          </Show>

          {/* ── Place ───────────────────────────────────────────────────────────────────────── */}
          <Show when={step().id === 'place'}>
            <TitleField draft={draft} />

            <Field label="Size" hint="A starting footprint. Drag or resize it afterwards like any other panel.">
              <SegmentedControl<Preset>
                ariaLabel="Size"
                size="sm"
                value={preset()}
                onChange={setPreset}
                options={(['s', 'm', 'l'] as const).map((entry) => {
                  const size = sizePresets(draft.definition().view.kind)[entry]
                  return {
                    value: entry,
                    title: `${size.w} of ${COLS} columns`,
                    label: <>{PRESET_LABELS[entry]}{strip(size.w)}</>,
                  }
                })}
              />
            </Field>

            <Field label="Where">
              <SegmentedControl<PlacementSurface>
                ariaLabel="Where"
                size="sm"
                value={surface()}
                onChange={setSurface}
                options={[
                  { value: 'home', label: 'Home' },
                  {
                    value: 'pane',
                    label: 'Task pane',
                    // Reachable only from the pane itself: there is one dashboard pane scope and
                    // aiming at it from Home would place a panel where nobody is looking.
                    disabled: props.scope.surface !== 'pane',
                    title: 'Add it from a task’s dashboard pane.',
                  },
                  {
                    value: 'plugin-region',
                    label: 'Plugin region',
                    disabled: true,
                    title: 'Needs plugin-hosted regions (docs/future/dashboards/placements.md).',
                  },
                ]}
              />
            </Field>

            <Show when={surface() === 'home'}>
              <Field label="Dashboard">
                <SegmentedControl<string>
                  ariaLabel="Dashboard"
                  size="sm"
                  value={tabId()}
                  onChange={setTabId}
                  options={tabOptions().map((tab) => ({ value: tab.id, label: tab.name }))}
                />
              </Field>
            </Show>

            <RefreshField draft={draft} />
          </Show>
        </section>

        {/* Always present, at every step: this is the thing the wizard exists for. */}
        <aside class="dash-wizard-preview">
          <SectionHeader level="sub">Preview</SectionHeader>
          <PanelPreview draft={draft} />
        </aside>
      </Modal.Body>

      <Modal.Actions>
        <Button variant="bare" onClick={props.onClose}>Cancel</Button>
        {/* For people who want the whole sheet at once. Cheap because both edit the same draft
            shape; if it proves unused, delete it. */}
        <Button variant="bare" disabled={!draft.ready()} onClick={openEditor}>Open in editor</Button>
        <Button variant="ghost" disabled={stepIndex() === 0} onClick={() => goTo(stepIndex() - 1)}>Back</Button>
        <Show
          when={stepIndex() < STEPS.length - 1}
          fallback={(
            <Button variant="solid" tone="accent" disabled={!draft.ready()} onClick={commit}>Add panel</Button>
          )}
        >
          <Button variant="solid" tone="accent" disabled={!draft.ready()} onClick={() => goTo(stepIndex() + 1)}>
            Next
          </Button>
        </Show>
      </Modal.Actions>
    </Modal>
  )
}
