import { For, Match, Switch } from 'solid-js'
import {
  COLLECTION_FIELD_TYPES,
  type PluginCollectionCell,
  type PluginCollectionField,
  type PluginCollectionFieldType,
  type PluginCollectionParam,
} from '@acorn/protocol/collections.ts'
import Picker from '../../kit/components/inputs/Picker'
import { Checkbox, Input, Select } from '../../kit/components/primitives'
import { operatorLabel, operatorsForField, toggleParamValue } from './editor'
import type { PanelFilterOp, PanelMappingColumnDef, PanelTone } from './model'

// Typed, data-aware config inputs the generated editor is composed from (docs/dashboards.md §
// The generated editor). Each one knows the schema it draws from, so the editor can only produce a
// valid panel.
//
// Native controls throughout, because a select, a date input, and a checkbox are keyboard-operable,
// announced, and locale-correct for free. The derivations that decide what goes in them live in
// editor.ts, where they can be tested.

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
}) {
  return (
    <Select
      size={props.size ?? 'sm'}
      label={props.ariaLabel}
      value={props.value ?? ''}
      options={[
        ...(props.emptyLabel ? [{ value: '', label: props.emptyLabel }] : []),
        ...props.fields.map((field) => ({ value: field.id, label: field.name })),
      ]}
      onChange={(value) => props.onChange(value)}
    />
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
      label="Condition"
      value={props.value}
      onChange={(value) => props.onChange(value as PanelFilterOp)} options={[...operatorsForField(props.field).map((op) => ({ value: op, label: operatorLabel(op, props.field) }))]} />
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

/** The value half of a filter row, drawn by the field's semantic type: the vocabulary that decides
 *  how the cell renders (format.ts) also decides how it is entered. A `datetime` gets a date
 *  picker, a `boolean` a checkbox, an `enum` its own declared values. */
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
          label="Value"
          type={props.field.type === 'number' ? 'number' : 'text'}
          value={text()}
          onInput={(value) => props.onChange(
            props.field.type === 'number' ? Number(value) : value,
          )}
        />
      )}
    >
      <Match when={props.field.type === 'boolean'}>
        <Checkbox
          checked={!!props.value}
          label={props.value ? 'Yes' : 'No'}
          onChange={(checked) => props.onChange(checked)}
        />
      </Match>
      <Match when={declared()}>
        {(values) => (
          <Select size="sm" label="Value" value={text()} onChange={(value) => props.onChange(value)} options={[...values().map((value) => ({ value: value.id, label: value.label }))]} />
        )}
      </Match>
      <Match when={props.field.type === 'datetime'}>
        <Input
          size="sm"
          label="Value"
          type="date"
          value={toDateInput(props.value)}
          onInput={(value) => props.onChange(fromDateInput(value))}
        />
      </Match>
    </Switch>
  )
}

/** "Map these values onto those", the mapping step's selector (docs/dashboards.md § The generated
 *  editor), which is why the matrix is one control repeated rather than a drag surface.
 *
 *  The empty option is a real destination, not a null state: a value in no column goes wherever the
 *  panel's unmapped rule says, never nowhere. */
export function ColumnSelect(props: {
  columns: readonly PanelMappingColumnDef[]
  value: string | undefined
  onChange: (columnId: string | undefined) => void
  ariaLabel: string
}) {
  return (
    <Select
      size="sm"
      label={props.ariaLabel}
      value={props.value ?? ''}
      onChange={(value) => props.onChange(value || undefined)} options={[{ value: '', label: 'Unmapped' }, ...props.columns.map((column) => ({ value: column.id, label: column.label }))]} />
  )
}

/** A column's tone, from the host's own five (ui/primitives.tsx § StatusDot). A plugin's declared
 *  value picks from the same vocabulary, so an invented column colours like a provider's. */
export function ToneSelect(props: {
  value: PanelTone | undefined
  onChange: (tone: PanelTone) => void
  ariaLabel: string
}) {
  return (
    <Select
      size="sm"
      label={props.ariaLabel}
      value={props.value ?? 'muted'}
      onChange={(value) => props.onChange(value as PanelTone)} options={[...TONES.map((tone) => ({ value: tone, label: TONE_LABELS[tone] }))]} />
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
 *  The wire's own seven rather than a reduced set, because an invented field renders, sorts,
 *  filters, and groups through the same machinery a declared one does. */
export function FieldTypeSelect(props: {
  value: PluginCollectionFieldType
  onChange: (type: PluginCollectionFieldType) => void
  ariaLabel: string
}) {
  return (
    <Select
      size="sm"
      label={props.ariaLabel}
      value={props.value}
      onChange={(value) => props.onChange(value as PluginCollectionFieldType)} options={[...COLLECTION_FIELD_TYPES.map((type) => ({ value: type, label: FIELD_TYPE_LABELS[type] }))]} />
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

/** A collection's declared param. The host renders the input and hands the value back opaquely, so
 *  the plugin owns what `repo` means and this file does not change the day it means something else.
 *
 *  The declaration plus whatever options the plugin resolved for this device
 *  (registries/collections.ts § paramOptions) picks the form: checkboxes for a multiple-choice
 *  enum, the shared searchable picker for any other closed list, a text box otherwise. A multiple
 *  selection crosses back as one comma-joined string, because a param's value is a string on the
 *  wire. */
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
          label={props.param.name}
          value={props.value}
          onInput={(value) => props.onChange(value)}
        />
      )}
    >
      <Match when={choices().length && props.param.multiple}>
        {/* Native checkboxes rather than `<select multiple>`, which needs a modifier key nobody
            discovers and shows two rows of a scroller. */}
        <span class="dash-param-choices">
          <For each={choices()}>
            {(choice) => (
              <Checkbox
                size="sm"
                label={choice.label}
                checked={selected().has(choice.id)}
                onChange={(checked) => props.onChange(toggleParamValue(
                  props.value,
                  choices().map((entry) => entry.id),
                  choice.id,
                  checked,
                ))}
              />
            )}
          </For>
        </span>
      </Match>
      <Match when={choices().length}>
        {/* The shared searchable picker rather than a bare `<select>`. A declared enum is three
            values and either would do, but a resolved one is however many repositories this person
            has, and a native select past sixty of them is unusable. */}
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
