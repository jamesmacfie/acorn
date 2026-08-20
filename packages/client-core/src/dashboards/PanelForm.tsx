import { createMemo, createResource, For, Index, Show } from 'solid-js'
import { Alert, Button, Field, Input, SectionHeader, SegmentedControl, Select } from '../ui/primitives'
import { CollapsibleSection } from '../ui/CollapsibleSection'
import Icon from '../ui/Icon'
import { chartAxisFields, type ChartShape } from './chart'
import type { PanelDraft } from './draft'
import { defaultFilterFor, operatorNeedsValue, retargetFilter, withOperator } from './editor'
import {
  candidateFieldsFor,
  mappedColumnId,
  panelFieldsFor,
  sourceFieldFor,
  statusValuesOf,
} from './mapping'
import { panelSourceKey, type PanelAggregate, type PanelView, type PanelViewKind } from './model'
import { ColumnSelect, FieldSelect, FieldTypeSelect, OperatorSelect, ParamInput, ToneSelect, ValueInput } from './selectors'
import './dashboards.css'

// The panel form, in sections. See docs/dashboards.md § The generated editor.
//
// Every control a panel is composed with lives here exactly once, and the two surfaces that compose
// panels arrange them differently: `PanelEditor` stacks all of them in one sheet, `PanelWizard` deals
// them across four steps. Nothing below knows which one it is inside, which is why the wizard adds no
// second implementation of any rule the sheet already embodies.
//
// Nothing here is hand-written per collection. Every control is a selector over the schema
// (selectors.tsx) and every list of choices comes from a derivation (editor.ts, mapping.ts, chart.ts)
// reached through the draft (draft.ts): the views offered are the ones the schema supports, the group-by
// fields are the ones with finite values, the operators are the ones the field's type can answer, the
// value input is the one its type is entered with, and the mapping matrix is one "map these onto those"
// selector repeated. There is no validation pass at the end because there is no invalid state to catch.
//
// A Solid note, and it is not optional: every list below whose rows contain an input uses `<Index>`.
// `<For>` keys by reference, so replacing a filter, or a mapping column, on each keystroke re-creates its
// row and the input loses focus mid-word. `<Index>` keys by position, which is what a positional list is.

export const VIEW_LABELS: Record<PanelViewKind, string> = {
  stat: 'Stat',
  list: 'List',
  table: 'Table',
  board: 'Board',
  chart: 'Chart',
}

const SHAPE_LABELS: Record<ChartShape, string> = { bar: 'Bar', line: 'Line' }

/** The two trend tiers, said in the words that keep them apart. They are different features wearing one
 *  mark, "when did these rows change" against "what was this number", and a person who reads them as the
 *  same thing will expect a history the store cannot have. */
const TREND_LABELS: Record<'none' | NonNullable<PanelView['trend']>, string> = {
  none: 'None',
  activity: 'Activity',
  history: 'Recorded',
}

const COMPARE_LABELS: Record<'none' | NonNullable<PanelView['compare']>, string> = {
  none: 'None',
  day: 'Yesterday',
  week: 'Last week',
}

/** Direction-goodness is the user's judgement and nothing else's: open PRs going up is bad for one
 *  person's board and good for another's, so `Neutral` is the default and the honest one. */
const GOOD_LABELS: Record<'none' | NonNullable<PanelView['good']>, string> = {
  none: 'Neutral',
  up: 'Up is good',
  down: 'Down is good',
}

const AGGREGATES: readonly { value: PanelAggregate; label: string }[] = [
  { value: 'count', label: 'Count of rows' },
  { value: 'sum', label: 'Sum of' },
  { value: 'avg', label: 'Average of' },
  { value: 'min', label: 'Lowest' },
  { value: 'max', label: 'Highest' },
]

export const removeButton = (label: string, onClick: () => void) => (
  <Button size="xs" variant="ghost" iconOnly aria-label={label} onClick={onClick}>
    <Icon name="x" />
  </Button>
)

/** The chosen collections, each removable. */
export function SourceRows(props: { draft: PanelDraft }) {
  return (
    <Show when={props.draft.queries().length}>
      <ul class="dash-editor-sources">
        <Index each={props.draft.queries()}>
          {(query, index) => (
            <li class="dash-editor-source">
              <span class="dash-editor-field-name">{props.draft.nameOf(query())}</span>
              <span class="muted">{query().pluginId}</span>
              {removeButton('Remove collection', () => props.draft.removeSource(index))}
            </li>
          )}
        </Index>
      </ul>
    </Show>
  )
}

/** The honest cold case. A collection that describes itself in its answer promises nothing before the
 *  first read, and a form that quietly showed an empty field list would look like the collection had
 *  none. */
export function ColdNotice(props: { draft: PanelDraft }) {
  const cold = () => props.draft.cold()
  return (
    <Show when={cold().length}>
      <Alert tone="info">
        {cold().map((page) => props.draft.nameOf(page.query)).join(', ')}{' '}
        {cold().length === 1 ? 'describes itself' : 'describe themselves'} in the answer and{' '}
        {cold().length === 1 ? 'has' : 'have'} not been read on this device yet, so there are no
        fields to filter, sort or map on. Save the panel, let it load, then edit it again.
      </Alert>
    </Show>
  )
}

/** Rendered by the host, meant by the plugin: a param's value crosses back opaquely and nothing here
 *  knows what `repo` is for. */
export function ParamInputs(props: { draft: PanelDraft }) {
  return (
    <Show when={props.draft.queries().some((query) => props.draft.entryFor(query)?.params?.length)}>
      <SectionHeader level="sub">Inputs</SectionHeader>
      <Index each={props.draft.queries()}>
        {(query, index) => (
          <Show when={props.draft.entryFor(query())?.params?.length}>
            <Show when={props.draft.queries().length > 1}>
              <span class="dash-editor-note muted">{props.draft.nameOf(query())}</span>
            </Show>
            <div class="dash-editor-rows">
              <Index each={props.draft.entryFor(query())?.params ?? []}>
                {(param) => {
                  // Per param, on demand, and only where the plugin offers to resolve any: a repository
                  // list is a request, and asking for one against every param of every collection on the
                  // panel would spend several to render a text box.
                  //
                  // The source is which collection this is, not the query, and that distinction is a bug
                  // this had. A query carries its params, so keying the resource off it re-ran the fetch
                  // on every change, and each re-run put the resource back to `undefined`, which swapped
                  // the control out from under the value that had just been chosen. It looked exactly
                  // like the pick had not saved.
                  //
                  // A memo with an explicit `equals` rather than reading the two fields inline: the
                  // fields have to stay tracked, because removing a source moves another one into this
                  // position, but must only notify when they actually differ.
                  const collection = createMemo(
                    () => ({ pluginId: query().pluginId, collectionId: query().collectionId }),
                    undefined,
                    { equals: (a, b) => a.pluginId === b.pluginId && a.collectionId === b.collectionId },
                  )
                  const [options] = createResource(
                    () => (props.draft.entryFor(collection())?.paramOptions ? collection() : undefined),
                    (key) => props.draft.entryFor(key)!.paramOptions!(param().id, props.draft.nodeId),
                  )
                  return (
                    // `group` where the answer is several checkboxes, because a caption cannot be a label
                    // for more than one control (primitives.tsx, `Field`).
                    <Field label={param().name} layout="split" group={param().multiple}>
                      <ParamInput
                        param={param()}
                        options={options()}
                        value={query().params?.[param().id] ?? ''}
                        onChange={(value) => props.draft.setParam(index, param().id, value)}
                      />
                    </Field>
                  )
                }}
              </Index>
            </div>
          </Show>
        )}
      </Index>
    </Show>
  )
}

export function TitleField(props: { draft: PanelDraft; ref?: (el: HTMLInputElement) => void }) {
  return (
    <Field label="Title">
      <Input
        ref={props.ref}
        value={props.draft.title()}
        onInput={(event) => props.draft.typeTitle(event.currentTarget.value)}
      />
    </Field>
  )
}

/** Group-by is shaping, so it is offered whenever the schema has a field with finite values rather than
 *  only under the board: set it here, flip to board, and the columns are already the ones you chose. */
export function GroupByField(props: { draft: PanelDraft }) {
  return (
    <Show when={props.draft.groupable().length}>
      <Field label="Group by" layout="split">
        <FieldSelect
          fields={props.draft.groupable()}
          value={props.draft.shaping().groupBy}
          ariaLabel="Group by"
          emptyLabel={props.draft.view().kind === 'board' ? undefined : 'No grouping'}
          onChange={(id) => props.draft.patch({ groupBy: id || undefined })}
        />
      </Field>
    </Show>
  )
}

/** Everything the chosen view kind asks for: a chart's shape and axes, the measure a stat and a chart
 *  share, and a stat's trend. Each gated on the kind that draws it, so no control is reachable when its
 *  view is not. */
export function ViewOptions(props: { draft: PanelDraft }) {
  const draft = () => props.draft
  return (
    <>
      {/* The chart's own two decisions. The SHAPE picker only lists shapes the schema can support,
          and the axis picker only lists fields of the type that shape needs — the same gate as the
          view list, one level down, so a chart that cannot draw is unrepresentable rather than
          validated. The measure below is shared with `stat`. */}
      <Show when={draft().view().kind === 'chart'}>
        <div class="dash-editor-pair">
          <Field label="Shape">
            <SegmentedControl<ChartShape>
              ariaLabel="Chart shape"
              size="sm"
              value={draft().shape()}
              onChange={draft().chooseShape}
              options={draft().shapes().map((entry) => ({ value: entry, label: SHAPE_LABELS[entry] }))}
            />
          </Field>
          <Field label={draft().shape() === 'line' ? 'Over' : 'By'}>
            <FieldSelect
              fields={chartAxisFields(draft().schema(), draft().shape())}
              value={draft().view().x}
              ariaLabel={draft().shape() === 'line' ? 'Time axis' : 'Category axis'}
              onChange={draft().setAxis}
            />
          </Field>
        </div>
        {/* Optional on both shapes, and the SAME key: a bar split by a second enum is the grouped
            bar, which is a third shape by arithmetic but not by config
            (docs/dashboards.md § Views are derived, not chosen from a menu). Offered only where the split is representable —
            any enum for a line, any enum but the category axis for a bar — so a schema with one enum
            never sees the control on a bar. */}
        <Show when={draft().seriesFields().length}>
          <Field
            label="Split into series"
            hint={draft().shape() === 'line'
              ? 'One line per value. Leave empty for a single line.'
              : 'One bar per value inside each category. Leave empty for a single bar.'}
          >
            <FieldSelect
              fields={draft().seriesFields()}
              value={draft().view().series}
              ariaLabel="Series"
              emptyLabel="No split"
              onChange={(id) => draft().setSeries(id || undefined)}
            />
          </Field>
        </Show>
      </Show>

      {/* One measure, two views: a stat draws it as a number and a chart draws it as a height, so
          flipping between them keeps what the panel is counting. */}
      <Show when={draft().view().kind === 'stat' || draft().view().kind === 'chart'}>
        <div class="dash-editor-pair">
          <Field label="Measure">
            <Select
              size="sm"
              aria-label="Aggregate"
              value={draft().view().aggregate ?? 'count'}
              onChange={(event) => draft().chooseAggregate(event.currentTarget.value as PanelAggregate)}
            >
              {/* Only `count` when there is no number to add up. Offering "Sum of" against a
                  collection of text fields is a choice that can only ever draw an em dash. */}
              <For each={draft().numbers().length ? AGGREGATES : AGGREGATES.slice(0, 1)}>
                {(option) => <option value={option.value}>{option.label}</option>}
              </For>
            </Select>
          </Field>
          {/* Only a number can be summed or averaged, so only number fields are offered — the same
              gate as the view list, one level down. */}
          <Show when={(draft().view().aggregate ?? 'count') !== 'count'}>
            <Field label="Field">
              <FieldSelect
                fields={draft().numbers()}
                value={draft().view().field}
                ariaLabel="Aggregated field"
                onChange={draft().setMeasureField}
              />
            </Field>
          </Show>
        </div>
      </Show>

      {/* The stat's trend (docs/dashboards.md § Trends). Offered per TIER, because the two are gated
          on different things: `Activity` needs a datetime to bucket the rows by, and `Recorded` needs
          only the node's sampler — an empty series is a cold state, not a reason to withhold the
          choice. The comparison hangs off `Recorded` alone: a delta is a lookback into the store, and
          a panel that records nothing has no baseline to find. */}
      <Show when={draft().view().kind === 'stat'}>
        <div class="dash-editor-pair">
          <Field
            label="Trend"
            hint={draft().view().trend === 'activity'
              ? 'When these rows last changed, by day.'
              : 'This number, recorded hourly from now on.'}
          >
            <SegmentedControl<'none' | NonNullable<PanelView['trend']>>
              ariaLabel="Trend"
              size="sm"
              value={draft().view().trend ?? 'none'}
              onChange={draft().chooseTrend}
              options={['none' as const, ...draft().trends()].map((entry) => ({ value: entry, label: TREND_LABELS[entry] }))}
            />
          </Field>
          <Show when={draft().view().trend === 'history'}>
            <Field label="Compare with">
              <SegmentedControl<'none' | NonNullable<PanelView['compare']>>
                ariaLabel="Compare with"
                size="sm"
                value={draft().view().compare ?? 'none'}
                onChange={draft().setCompare}
                options={(['none', 'day', 'week'] as const).map((entry) => ({ value: entry, label: COMPARE_LABELS[entry] }))}
              />
            </Field>
          </Show>
        </div>
        <Show when={draft().view().trend === 'history' && draft().view().compare}>
          <Field label="Which way is good?" hint="Leave neutral and the change is drawn in plain ink.">
            <SegmentedControl<'none' | NonNullable<PanelView['good']>>
              ariaLabel="Which way is good"
              size="sm"
              value={draft().view().good ?? 'none'}
              onChange={draft().setGood}
              options={(['none', 'up', 'down'] as const).map((entry) => ({ value: entry, label: GOOD_LABELS[entry] }))}
            />
          </Field>
        </Show>
      </Show>
    </>
  )
}

/** The mapping step, which appears when there is something to map. A single-collection panel is the same
 *  three-decision form it always was, and the columns and the per-source matrices show up on the second
 *  source, or when somebody invents a column over one. Confronting every user with a matrix to compose a
 *  list of their pull requests would be the generated editor's failure mode. */
export function MappingSection(props: { draft: PanelDraft }) {
  const draft = () => props.draft
  return (
    <Show when={draft().mapped()}>
      <SectionHeader
        level="sub"
        actions={(
          <>
            <Button size="xs" variant="ghost" onClick={draft().addColumn}>
              <Icon name="plus" /> Add column
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={!draft().columns().length}
              title="Map each source value onto the column whose name matches it"
              onClick={draft().suggestValues}
            >
              Suggest
            </Button>
          </>
        )}
      >
        Columns
      </SectionHeader>

      <Show when={draft().columns().length}>
        <ul class="dash-editor-fields">
          <Index each={draft().columns()}>
            {(column, index) => (
              <li class="dash-editor-row">
                <Input
                  size="sm"
                  aria-label="Column name"
                  value={column().label}
                  onInput={(event) => draft().editColumn(index, { label: event.currentTarget.value })}
                />
                <ToneSelect
                  ariaLabel={`${column().label} tone`}
                  value={column().tone}
                  onChange={(tone) => draft().editColumn(index, { tone })}
                />
                {removeButton('Remove column', () => draft().removeColumn(index))}
              </li>
            )}
          </Index>
        </ul>

        <Field label="Unmapped values" hint="A value no column claims still has to go somewhere.">
          <SegmentedControl<'catch-all' | 'hidden'>
            ariaLabel="Unmapped values"
            size="sm"
            value={draft().mapping().unmapped ?? 'catch-all'}
            onChange={draft().setUnmapped}
            options={[{ value: 'catch-all', label: 'Catch-all column' }, { value: 'hidden', label: 'Hidden' }]}
          />
        </Field>

        <Index each={draft().pages()}>
          {(page) => (
            <>
              <SectionHeader level="sub">{draft().nameOf(page().query)}</SectionHeader>
              <Show
                when={statusValuesOf(page(), draft().mapping()).length}
                fallback={<span class="dash-editor-note muted">No status values to map yet.</span>}
              >
                <div class="dash-editor-rows">
                  <Index each={statusValuesOf(page(), draft().mapping())}>
                    {(value) => (
                      <Field label={value().label} layout="split">
                        <ColumnSelect
                          ariaLabel={`${value().label} column`}
                          columns={draft().columns()}
                          value={mappedColumnId(draft().mapping(), panelSourceKey(page().query), value().id)}
                          onChange={(columnId) => draft().mapValue(panelSourceKey(page().query), value().id, columnId)}
                        />
                      </Field>
                    )}
                  </Index>
                </div>
              </Show>
            </>
          )}
        </Index>
      </Show>

      {/* Folded, because the role pre-fill is right almost always and a matrix nobody needs to touch
          should not be the first thing they see. */}
      <CollapsibleSection level="sub" label="Fields" persistKey="dashboards.field-mapping">
        {/* A `<details>` lays its children out in plain block flow, so everything inside a fold stacks
            at zero gap however carefully the rows themselves are spaced. One stack, and the fold reads
            like the rest of the form. */}
        <div class="dash-editor-stack">
          {/* THE ROLE CEILING'S RELEASE VALVE (model.ts § PanelFieldDef). The five roles are what the
              host can align without asking; anything else — github's repo, linear's identifier — the
              person names here and then answers for, per source, in the same matrix below. */}
          <SectionHeader
            level="sub"
            actions={(
              <Button size="xs" variant="ghost" onClick={draft().addField}>
                <Icon name="plus" /> Add field
              </Button>
            )}
          >
            Your own fields
          </SectionHeader>
          <Show when={draft().extraFields().length}>
            <ul class="dash-editor-fields">
              <Index each={draft().extraFields()}>
                {(field, index) => (
                  <li class="dash-editor-row">
                    <Input
                      size="sm"
                      aria-label="Field name"
                      value={field().label}
                      onInput={(event) => draft().editField(index, { label: event.currentTarget.value })}
                    />
                    <FieldTypeSelect
                      ariaLabel={`${field().label} type`}
                      value={field().type}
                      onChange={(type) => draft().editField(index, { type })}
                    />
                    {removeButton('Remove field', () => draft().removeField(index))}
                  </li>
                )}
              </Index>
            </ul>
          </Show>

          <Index each={draft().pages()}>
            {(page) => (
              <>
                <SectionHeader level="sub">{draft().nameOf(page().query)}</SectionHeader>
                <div class="dash-editor-rows">
                  <Index each={panelFieldsFor(draft().mapping())}>
                    {(field) => (
                      <Field label={field().name} layout="split">
                        <FieldSelect
                          fields={candidateFieldsFor(page(), field().id, draft().mapping())}
                          value={sourceFieldFor(page(), field().id, draft().mapping())}
                          ariaLabel={`${field().name} from ${draft().nameOf(page().query)}`}
                          emptyLabel="None"
                          onChange={(id) => draft().setSourceField(panelSourceKey(page().query), field().id, id)}
                        />
                      </Field>
                    )}
                  </Index>
                </div>
              </>
            )}
          </Index>
        </div>
      </CollapsibleSection>
    </Show>
  )
}

/** Filters, sort keys and the visible-field projection: everything that shapes the rows rather than
 *  choosing them or drawing them. All of it gated on there being a schema to shape against. */
export function ShapingSection(props: { draft: PanelDraft }) {
  const draft = () => props.draft
  return (
    <Show when={draft().schema().fields.length}>
      <SectionHeader
        level="sub"
        actions={(
          <Button
            size="xs"
            variant="ghost"
            onClick={() => draft().patch({ filters: [...draft().filters(), defaultFilterFor(draft().schema().fields[0])] })}
          >
            <Icon name="plus" /> Add filter
          </Button>
        )}
      >
        Filters
      </SectionHeader>
      <Index each={draft().filters()}>
        {(filter, index) => {
          const field = () => draft().fieldById(filter().field)
          return (
            <div class="dash-editor-row">
              <FieldSelect
                fields={draft().schema().fields}
                value={filter().field}
                ariaLabel="Filtered field"
                onChange={(id) => {
                  const next = draft().fieldById(id)
                  if (next) draft().editFilter(index, (current) => retargetFilter(current, next))
                }}
              />
              <OperatorSelect
                field={field()}
                value={filter().op}
                onChange={(op) => {
                  const on = field()
                  if (on) draft().editFilter(index, (current) => withOperator(current, on, op))
                }}
              />
              <Show when={operatorNeedsValue(filter().op) && field()}>
                {(on) => (
                  <ValueInput
                    field={on()}
                    value={filter().value}
                    onChange={(value) => draft().editFilter(index, (current) => ({ ...current, value }))}
                  />
                )}
              </Show>
              {removeButton(
                'Remove filter',
                () => draft().patch({ filters: draft().filters().filter((_, at) => at !== index) }),
              )}
            </div>
          )
        }}
      </Index>

      <SectionHeader
        level="sub"
        actions={(
          <Button
            size="xs"
            variant="ghost"
            onClick={() => draft().patch({
              sort: [...draft().sort(), { field: draft().schema().fields[0].id, direction: 'asc' }],
            })}
          >
            <Icon name="plus" /> Add sort
          </Button>
        )}
      >
        Sort
      </SectionHeader>
      <Index each={draft().sort()}>
        {(key, index) => (
          <div class="dash-editor-row">
            <FieldSelect
              fields={draft().schema().fields}
              value={key().field}
              ariaLabel="Sorted field"
              onChange={(id) => draft().editSort(index, (current) => ({ ...current, field: id }))}
            />
            <SegmentedControl<'asc' | 'desc'>
              ariaLabel="Direction"
              size="sm"
              value={key().direction}
              onChange={(direction) => draft().editSort(index, (current) => ({ ...current, direction }))}
              options={[{ value: 'asc', label: 'Asc' }, { value: 'desc', label: 'Desc' }]}
            />
            {removeButton('Remove sort key', () => draft().patch({ sort: draft().sort().filter((_, at) => at !== index) }))}
          </div>
        )}
      </Index>

      {/* Reorder is two buttons, not a drag list — the same trade the panel grid's own reorder makes.
          Keyboard- and screen-reader-operable by construction, where drag needs a parallel keyboard
          path built anyway to be usable at all. Upgrade path: pointer drag ON TOP of this. */}
      <SectionHeader level="sub">Fields</SectionHeader>
      <ul class="dash-editor-fields">
        <Index each={draft().visible()}>
          {(id, index) => (
            <li class="dash-editor-field">
              <Button size="xs" variant="ghost" iconOnly aria-label="Hide field" onClick={() => draft().toggleField(id(), false)}>
                <Icon name="eye" />
              </Button>
              <span class="dash-editor-field-name">{draft().fieldById(id())?.name ?? id()}</span>
              <Button
                size="xs"
                variant="ghost"
                iconOnly
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => draft().moveField(index, -1)}
              >
                <Icon name="chevron-up" />
              </Button>
              <Button
                size="xs"
                variant="ghost"
                iconOnly
                aria-label="Move down"
                disabled={index === draft().visible().length - 1}
                onClick={() => draft().moveField(index, 1)}
              >
                <Icon name="chevron-down" />
              </Button>
            </li>
          )}
        </Index>
        <Index each={draft().hidden()}>
          {(field) => (
            <li class="dash-editor-field" data-hidden="">
              <Button size="xs" variant="ghost" iconOnly aria-label="Show field" onClick={() => draft().toggleField(field().id, true)}>
                <Icon name="eye-off" />
              </Button>
              <span class="dash-editor-field-name muted">{field().name}</span>
            </li>
          )}
        </Index>
      </ul>
    </Show>
  )
}

// Both numbers say what empty means in the placeholder rather than in a line of prose under the input. It
// is the same sentence in a quarter of the space, it sits inside the control it is about, and it
// disappears the moment there is a value, which is when a hint has stopped being read anyway.

export function LimitField(props: { draft: PanelDraft }) {
  return (
    <Field label="Limit" layout="split">
      <Input
        size="sm"
        type="number"
        min="0"
        placeholder="All rows"
        value={props.draft.limitText()}
        onInput={(event) => props.draft.setLimitText(event.currentTarget.value)}
      />
    </Field>
  )
}

export function RefreshField(props: { draft: PanelDraft }) {
  return (
    <Field label="Refresh" layout="split">
      <Input
        size="sm"
        type="number"
        min="0"
        placeholder={refreshPlaceholder(props.draft.pages().map((page) => props.draft.entryFor(page.query)?.refresh))}
        value={props.draft.refreshText()}
        onInput={(event) => props.draft.setRefreshText(event.currentTarget.value)}
      />
    </Field>
  )
}

/** Each source polls at its own declared interval unless the panel overrides them all, so this names the
 *  range rather than pretending there is one number. */
function refreshPlaceholder(declared: readonly (number | undefined)[]): string {
  const seconds = [...new Set(declared.flatMap((value) => value ?? []))].sort((a, b) => a - b)
  return seconds.length ? `Every ${seconds.join(', ')}s` : 'Never'
}
