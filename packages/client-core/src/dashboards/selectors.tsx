import { For, Match, Show, Switch } from 'solid-js'
import type {
  PluginCollectionCell,
  PluginCollectionField,
  PluginCollectionParam,
} from '@acorn/protocol/collections.ts'
import { Checkbox, Input, Select } from '../ui/primitives'
import { operatorLabel, operatorsForField } from './editor'
import type { PanelFilterOp, PanelMappingColumnDef, PanelTone } from './model'

// SELECTORS: the typed, data-aware config inputs the generated editor is composed from
// (docs/future/dashboards/composition.md § The generated editor). Each one knows the schema it draws
// from, so the editor's choices are valid BY CONSTRUCTION — there is no control here that can
// produce an invalid panel and then complain about it.
//
// Native controls throughout. A `<select>` of eight fields, a `<input type=date>` and a checkbox are
// keyboard-operable, screen-reader-announced and locale-correct without a line of code, and a
// hand-rolled combobox is how a settings form stops being any of those. Everything below is one
// `Select`, `Input` or `Checkbox` plus the derivation that decided what to put in it — the
// derivations are in `editor.ts`, where they can be tested.

/** Pick a field, filtered by whatever the caller can use — "a field of type enum", "a number field".
 *  The filtering is the caller's, because which fields are eligible is a question about the JOB
 *  (group by, sort, aggregate) rather than about the picker. */
export function FieldSelect(props: {
  fields: readonly PluginCollectionField[]
  value: string | undefined
  onChange: (id: string) => void
  ariaLabel: string
  /** Offered as the first option when the job has a legitimate "no field" answer. */
  emptyLabel?: string
  size?: 'sm' | 'md'
  class?: string
}) {
  return (
    <Select
      class={props.class}
      size={props.size ?? 'sm'}
      aria-label={props.ariaLabel}
      value={props.value ?? ''}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    >
      <Show when={props.emptyLabel}>{(label) => <option value="">{label()}</option>}</Show>
      <For each={props.fields}>{(field) => <option value={field.id}>{field.name}</option>}</For>
    </Select>
  )
}

/** Pick a comparison. What is offered depends on the field's TYPE, so a text field is never given
 *  "is more than" and a date is never given "contains". */
export function OperatorSelect(props: {
  field: PluginCollectionField | undefined
  value: PanelFilterOp
  onChange: (op: PanelFilterOp) => void
}) {
  return (
    <Select
      size="sm"
      aria-label="Condition"
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value as PanelFilterOp)}
    >
      <For each={operatorsForField(props.field)}>
        {(op) => <option value={op}>{operatorLabel(op, props.field)}</option>}
      </For>
    </Select>
  )
}

/** `<input type=date>` speaks `yyyy-mm-dd` in the local zone, and the wire speaks epoch
 *  milliseconds. Both directions go through the local day so a person who picks the 3rd gets the
 *  3rd where they are, not wherever UTC happened to put it. */
const toDateInput = (value: PluginCollectionCell | undefined): string => {
  const at = Number(value)
  if (!Number.isFinite(at) || at === 0) return ''
  const local = new Date(at)
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
}

const fromDateInput = (raw: string): number => {
  const [year, month, day] = raw.split('-').map(Number)
  return raw && Number.isFinite(year) ? new Date(year, (month ?? 1) - 1, day ?? 1).getTime() : 0
}

/** The value half of a filter row, drawn by the field's SEMANTIC TYPE — the same vocabulary that
 *  decides how the cell renders (format.ts) decides how it is entered. A `datetime` gets a date
 *  picker, a `number` gets a spinner, a `boolean` gets a checkbox and an `enum` gets its own
 *  declared values, which is what makes "pick a value of that field" impossible to get wrong. */
export function ValueInput(props: {
  field: PluginCollectionField
  value: PluginCollectionCell | undefined
  onChange: (value: PluginCollectionCell) => void
}) {
  const text = () => (props.value === null || props.value === undefined ? '' : String(props.value))
  // An enum with no declared values is a query-shaped collection describing itself in its answer, so
  // there is nothing to offer and a free-text box is the honest fallback.
  const declared = () => (props.field.type === 'enum' ? props.field.values?.length ? props.field.values : undefined : undefined)

  return (
    <Switch
      fallback={(
        <Input
          size="sm"
          aria-label="Value"
          type={props.field.type === 'number' ? 'number' : 'text'}
          value={text()}
          onInput={(event) => props.onChange(
            props.field.type === 'number' ? Number(event.currentTarget.value) : event.currentTarget.value,
          )}
        />
      )}
    >
      <Match when={props.field.type === 'boolean'}>
        <Checkbox
          checked={!!props.value}
          label={props.value ? 'Yes' : 'No'}
          onChange={(event) => props.onChange(event.currentTarget.checked)}
        />
      </Match>
      <Match when={declared()}>
        {(values) => (
          <Select size="sm" aria-label="Value" value={text()} onChange={(event) => props.onChange(event.currentTarget.value)}>
            <For each={values()}>{(value) => <option value={value.id}>{value.label}</option>}</For>
          </Select>
        )}
      </Match>
      <Match when={props.field.type === 'datetime'}>
        <Input
          size="sm"
          aria-label="Value"
          type="date"
          value={toDateInput(props.value)}
          onInput={(event) => props.onChange(fromDateInput(event.currentTarget.value))}
        />
      </Match>
    </Switch>
  )
}

/** "Map these values onto those" — the selector the design names for the mapping step
 *  (composition.md § The generated editor), and the reason the whole matrix is one control repeated
 *  rather than a bespoke drag surface.
 *
 *  The empty option is a REAL destination, not a null state: a value that lands in no column goes
 *  wherever the panel's unmapped rule says it goes, which is a catch-all column or hidden. Never
 *  nowhere. */
export function ColumnSelect(props: {
  columns: readonly PanelMappingColumnDef[]
  value: string | undefined
  onChange: (columnId: string | undefined) => void
  ariaLabel: string
}) {
  return (
    <Select
      size="sm"
      aria-label={props.ariaLabel}
      value={props.value ?? ''}
      onChange={(event) => props.onChange(event.currentTarget.value || undefined)}
    >
      <option value="">Unmapped</option>
      <For each={props.columns}>{(column) => <option value={column.id}>{column.label}</option>}</For>
    </Select>
  )
}

/** A column's tone, from the host's own five (ui/primitives.tsx § StatusDot) — the same vocabulary a
 *  plugin's declared value picks from, so a user-invented column colours the same way a provider's
 *  does under every appearance pack. */
export function ToneSelect(props: {
  value: PanelTone | undefined
  onChange: (tone: PanelTone) => void
  ariaLabel: string
}) {
  return (
    <Select
      size="sm"
      aria-label={props.ariaLabel}
      value={props.value ?? 'muted'}
      onChange={(event) => props.onChange(event.currentTarget.value as PanelTone)}
    >
      <For each={TONES}>{(tone) => <option value={tone}>{TONE_LABELS[tone]}</option>}</For>
    </Select>
  )
}

const TONES: readonly PanelTone[] = ['muted', 'accent', 'ok', 'warn', 'bad']
const TONE_LABELS: Record<PanelTone, string> = {
  muted: 'Neutral',
  accent: 'Active',
  ok: 'Good',
  warn: 'Attention',
  bad: 'Bad',
}

/** A collection's declared param. The host renders the input and hands the value back OPAQUELY — the
 *  plugin owns what `repo` means, and the day it means something else this file does not change
 *  (Grafana's opaque-target lesson). Two forms, matching the two the wire declares. */
export function ParamInput(props: {
  param: PluginCollectionParam
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Show
      when={props.param.type === 'enum' && props.param.values?.length ? props.param.values : undefined}
      fallback={(
        <Input
          size="sm"
          aria-label={props.param.name}
          value={props.value}
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
      )}
    >
      {(values) => (
        <Select
          size="sm"
          aria-label={props.param.name}
          value={props.value}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        >
          {/* Empty is a real answer: a param the person has not set is a param the plugin defaults. */}
          <option value="">Any</option>
          <For each={values()}>{(value) => <option value={value}>{value}</option>}</For>
        </Select>
      )}
    </Show>
  )
}
