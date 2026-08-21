import { For, Match, Show, Switch } from 'solid-js'
import {
  COLLECTION_FIELD_TYPES,
  type PluginCollectionCell,
  type PluginCollectionField,
  type PluginCollectionFieldType,
  type PluginCollectionParam,
} from '@acorn/protocol/collections.ts'
import Picker from '../ui/Picker'
import { Checkbox, Input, Select } from '../ui/primitives'
import { operatorLabel, operatorsForField, toggleParamValue } from './editor'
import type { PanelFilterOp, PanelMappingColumnDef, PanelTone } from './model'

// Typed, data-aware config inputs the generated editor is composed from (docs/dashboards.md §
// The generated editor). Each one knows the schema it draws from, so the editor can only produce
// a valid panel.
//
// Native controls throughout: a select, a date input and a checkbox are keyboard-operable,
// screen-reader-announced and locale-correct for free, which a hand-rolled combobox is not.
// Everything below is one Select, Input or Checkbox plus the derivation that decided what to put
// in it; the derivations live in editor.ts, where they can be tested.

/** Pick a field, filtered by whatever the caller can use: "a field of type enum", "a number field".
 *  The filtering is the caller's, because which fields are eligible is a question about the job
 *  (group by, sort, aggregate), not about the picker. */
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

/** Pick a comparison. What is offered depends on the field's type, so a text field is never given
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

/** The value half of a filter row, drawn by the field's semantic type: the same vocabulary that
 *  decides how the cell renders (format.ts) decides how it is entered. A `datetime` gets a date
 *  picker, a `number` gets a spinner, a `boolean` gets a checkbox and an `enum` gets its own
 *  declared values, so "pick a value of that field" cannot be got wrong. */
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

/** "Map these values onto those": the selector the design names for the mapping step
 *  (docs/dashboards.md § The generated editor), and the reason the whole matrix is one control
 *  repeated rather than a bespoke drag surface.
 *
 *  The empty option is a real destination, not a null state: a value that lands in no column goes
 *  wherever the panel's unmapped rule says it goes, a catch-all column or hidden, never nowhere. */
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

/** A column's tone, from the host's own five (ui/primitives.tsx § StatusDot): the same vocabulary a
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

/** The type of a field the user invented (model.ts § PanelFieldDef).
 *
 *  The wire's own seven, not a reduced set: an invented field renders, sorts, filters and groups
 *  through exactly the same machinery a declared one does, so narrowing the choice here would create
 *  a second class of field for no reason. It is the one place in the editor where a person picks a
 *  field type rather than a field, because there is no source to read it from. */
export function FieldTypeSelect(props: {
  value: PluginCollectionFieldType
  onChange: (type: PluginCollectionFieldType) => void
  ariaLabel: string
}) {
  return (
    <Select
      size="sm"
      aria-label={props.ariaLabel}
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value as PluginCollectionFieldType)}
    >
      <For each={COLLECTION_FIELD_TYPES}>{(type) => <option value={type}>{FIELD_TYPE_LABELS[type]}</option>}</For>
    </Select>
  )
}

const FIELD_TYPE_LABELS: Record<PluginCollectionFieldType, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Yes / no',
  datetime: 'Date',
  enum: 'Status',
  person: 'Person',
  link: 'Link',
}

/** One choice on a param, whether the plugin declared it or resolved it on the device. */
type ParamChoice = { id: string; label: string }

/** Empty is a real answer: a param the person has not set is a param the plugin defaults. */
const ANY_CHOICE: ParamChoice = { id: '', label: 'Any' }

/** A collection's declared param. The host renders the input and hands the value back opaquely: the
 *  plugin owns what `repo` means, and the day it means something else this file does not change
 *  (Grafana's opaque-target lesson).
 *
 *  Three forms now, and which one appears is decided by the declaration plus whatever options the
 *  plugin resolved for this device (registries/collections.ts § paramOptions): checkboxes for a
 *  multiple-choice enum, the shared searchable picker where there is any closed list to choose one
 *  from, a text box otherwise. A multiple selection crosses back as one comma-joined string, because
 *  a param's value is a string on the wire, and a second encoding for the same field would give
 *  every plugin two to read. */
export function ParamInput(props: {
  param: PluginCollectionParam
  value: string
/** Device-resolved choices. These win over the declared `values`: a plugin that resolved them asked
 *  for this list, and a stale declaration underneath is not a second list worth merging. */
  options?: readonly ParamChoice[]
  onChange: (value: string) => void
}) {
  const choices = (): ParamChoice[] =>
    props.options?.length
      ? [...props.options]
      : props.param.type === 'enum'
        ? (props.param.values ?? []).map((value) => ({ id: value, label: value }))
        : []

  const selected = () => new Set(props.value.split(',').filter(Boolean))

  return (
    <Switch
      fallback={(
        <Input
          size="sm"
          aria-label={props.param.name}
          value={props.value}
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
      )}
    >
      <Match when={choices().length && props.param.multiple}>
        {/* Native checkboxes rather than `<select multiple>`, which needs a modifier key nobody
            discovers and shows two rows of a scroller. Every choice is visible and each one is its own
            announced control. */}
        <span class="dash-param-choices">
          <For each={choices()}>
            {(choice) => (
              <Checkbox
                size="sm"
                label={choice.label}
                checked={selected().has(choice.id)}
                onChange={(event) => props.onChange(toggleParamValue(
                  props.value,
                  choices().map((entry) => entry.id),
                  choice.id,
                  event.currentTarget.checked,
                ))}
              />
            )}
          </For>
        </span>
      </Match>
      <Match when={choices().length}>
        {/* The shared searchable picker, not a bare `<select>`. A declared enum is three values and
            either would do; a RESOLVED one is however many repositories this person has, and scrolling
            a native select past sixty of them is the thing that made this control feel broken. One
            control for both cases rather than a threshold nobody can justify. */}
        <span class="dash-param-picker">
          <Picker<ParamChoice>
            label={choices().find((choice) => choice.id === props.value)?.label ?? ANY_CHOICE.label}
            ariaLabel={props.param.name}
            placeholder={`Filter ${props.param.name.toLowerCase()}`}
            emptyText="No match."
            results={(query) => {
              const needle = query.trim().toLowerCase()
              const matched = choices().filter((choice) => choice.label.toLowerCase().includes(needle))
// "Any" is the clear row, so it belongs at the top of the unfiltered list and nowhere in a
// filtered one: somebody typing a repository name is not looking for it.
              return needle ? matched : [ANY_CHOICE, ...matched]
            }}
            rowLabel={(choice) => choice.label}
            isActive={(choice) => choice.id === props.value}
            onSelect={(choice) => props.onChange(choice.id)}
          />
        </span>
      </Match>
    </Switch>
  )
}
