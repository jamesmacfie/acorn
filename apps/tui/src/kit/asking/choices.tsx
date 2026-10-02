/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, For, Show, type JSX } from 'solid-js'
import type { ButtonProps, SelectProps } from '@acorn/client-core/kit/components/primitives.tsx'
import type { PickerProps } from '@acorn/client-core/kit/components/inputs/Picker.tsx'
import type { Size } from '@acorn/client-core/kit/tokens'
import { COLLECTION_INTENTS, createCollectionIntents, type Intent } from '@acorn/client-core/kit/keys'
import { stop } from '../../keys/stops'
import { flatten, Line, slot } from '../cells'
import { litControl } from '../roles'
import { Menu } from '../grouping/menu'
import { Input } from './fields'

/** `[ value ▾ ]`, or a compact `value▾` for a bare control, opening a `Menu`. */
export function Select(props: SelectProps) {
  const current = () => props.options.find((option) => option.value === props.value)
  return (
    <Menu
      ariaLabel={props.label ?? 'Select'}
      disabled={() => !!props.disabled}
      trigger={(state) => (
        <Line {...litControl({ focused: state.focused(), disabled: props.disabled })}>
          {props.kind === 'bare' ? `${current()?.label ?? ''}▾` : `[ ${current()?.label ?? ''} ▾ ]`}
        </Line>
      )}
    >
      {(context) => (
        <For each={props.options}>
          {(option, index) => (
            <>
            <Show when={option.group && (index() === 0 || props.options[index() - 1]?.group !== option.group)}>
              <Line role="muted">{option.group}</Line>
            </Show>
            <Option
              label={option.label}
              chosen={option.value === props.value}
              disabled={option.disabled}
              onPress={() => {
                props.onChange?.(option.value)
                context.close()
              }}
            />
            </>
          )}
        </For>
      )}
    </Menu>
  )
}

/** One line of an open list: a stop, so `↓` and `↑` reach it and `activate` picks it.
 *
 *  Shared by `Select` and anything else that draws a plain list inside a `Menu`. The chosen row keeps
 *  the `match` role it has everywhere else in the kit; focus wins over it, because a reader moving
 *  through a list needs to see where they are more than what they had. */
function Option(props: { label: string; chosen?: boolean; disabled?: boolean; onPress: () => void }) {
  const control = stop({ onPress: () => props.onPress(), disabled: () => !!props.disabled })
  const lit = () => (control.focused()
    ? { role: 'strong' as const, tone: 'accent' as const }
    : { role: props.chosen ? 'match' as const : 'body' as const, tone: props.disabled ? 'muted' as const : undefined })
  return (
    <box flexDirection="row" flexShrink={0} ref={control.ref}>
      <Line {...lit()}>{props.label}</Line>
    </box>
  )
}

/** `[x] label`; Space toggles, through the `select` intent rather than through a key handler here. */
export function Checkbox(props: {
  label?: JSX.Element
  hint?: string
  checked?: boolean
  indeterminate?: boolean
  disabled?: boolean
  switch?: boolean
  size?: Size
  nested?: boolean
  ariaLabel?: string
  title?: string
  id?: string
  name?: string
  onChange?: (checked: boolean) => void
}) {
  const mark = () => (props.indeterminate ? '[-]' : props.checked ? '[x]' : '[ ]')
  const control = stop({
    onPress: () => props.onChange?.(!props.checked),
    disabled: () => !!props.disabled,
  })
  return (
    <box flexDirection="row" gap={1} flexShrink={0} ref={control.ref}>
      <Line {...litControl({ focused: control.focused(), disabled: props.disabled })}>{mark()}</Line>
      <Show when={props.label}><Line>{props.label}</Line></Show>
      <Show when={props.hint}><Line role="muted">{props.hint!}</Line></Show>
    </box>
  )
}

/** `[x] label`, the same two cells as a Checkbox, because in a terminal a switch is a checkbox that
 *  took a different route to the same state. */
export function ToggleButton(props: ButtonProps & { pressed: boolean; onPressedChange: (pressed: boolean) => void }) {
  const control = stop({
    onPress: () => props.onPressedChange(!props.pressed),
    disabled: () => !!props.disabled,
  })
  return (
    <box flexDirection="row" gap={1} flexShrink={0} ref={control.ref}>
      <Line {...litControl({ focused: control.focused(), disabled: props.disabled })}>{props.pressed ? '[x]' : '[ ]'}</Line>
      <Line {...litControl({ focused: control.focused(), disabled: props.disabled, tone: props.tone })}>
        {flatten(props.children) || props.label || ''}
      </Line>
    </box>
  )
}

/** `( a | [b] | c )`, the selected one in brackets. */
export function SegmentedControl<T extends string>(props: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  size?: Extract<Size, 'sm' | 'md'>
  ariaLabel: string
}) {
  const body = () => `( ${props.options.map((option) => (option.value === props.value ? `[${option.label}]` : option.label)).join(' | ')} )`
  // `NODE_FOCUS` calls `Grid` a collection, but its options are text with no renderable to focus.
  // The strip holds the keys. Shared collection intents move its value with arrows and paging keys.
  const keys = createCollectionIntents({
    id: () => props.ariaLabel,
    items: () => props.options.map((option) => ({ key: option.value, label: option.label })),
    orientation: 'horizontal',
    // Moving picks, which is what a segmented control is: there is nothing else its arrows could mean.
    selectOnMove: true,
    selected: () => props.value,
    onSelect: (key) => props.onChange(key as T),
    // Nothing to land on and nothing to activate: the strip is the one stop and the value is the caret.
    land: () => {},
    onItem: () => false,
  })
  const control = stop({
    on: Object.fromEntries(COLLECTION_INTENTS.map((intent) => [intent, () => keys.handle(intent)])) as
      Partial<Record<Intent, () => boolean>>,
  })
  return (
    <box flexDirection="row" flexShrink={0} ref={control.ref}>
      <Line {...litControl({ focused: control.focused() })}>{body()}</Line>
    </box>
  )
}

/** A field that opens a `Menu` filtered by typing. */
export function Picker<T>(props: PickerProps<T>) {
  const [query, setQuery] = createSignal('')
  // Each row carries its own pick, because the two forms this node takes identify a row differently:
  // the data form by id, the callback form by the caller's own opaque item. The DOM half maps an index
  // back to the item for the same reason; keeping the closure is the same answer with less arithmetic.
  const rows = () => {
    if (props.items) {
      const needle = query().trim().toLowerCase()
      return props.items
        .filter((item) => !needle || `${item.label} ${item.note ?? ''}`.toLowerCase().includes(needle))
        .map((item) => ({
          label: item.label,
          description: item.note,
          active: item.active,
          disabled: item.disabled,
          pick: () => props.onPick?.(item.id),
        }))
    }
    return (props.results?.(query()) ?? []).map((item) => ({
      label: props.rowLabel?.(item) ?? '',
      description: props.rowDescription?.(item),
      active: props.isActive?.(item) ?? false,
      disabled: props.isDisabled?.(item) ?? false,
      pick: () => props.onSelect?.(item),
    }))
  }
  return (
    <Menu
      ariaLabel={props.ariaLabel ?? flatten(props.label)}
      disabled={() => !!props.disabled}
      trigger={(state) => (
        <Line {...litControl({ focused: state.focused(), disabled: props.disabled })}>
          {`[ ${flatten(props.label)} ▾ ]`}
        </Line>
      )}
    >
      {(context) => (
        <box flexDirection="column">
          <Input kind="filter" placeholder={props.placeholder} value={query()} onInput={(value) => {
            setQuery(value)
            props.onSearch?.(value)
          }} />
          {slot(props.tools)}
          {slot(props.status)}
          <Show when={rows().length} fallback={<Line role="muted">{props.emptyText}</Line>}>
            <For each={rows()}>
              {(row) => (
                <PickerRow
                  label={row.label}
                  description={row.description}
                  active={row.active}
                  disabled={row.disabled}
                  onSelect={() => {
                    row.pick()
                    if (!props.keepOpen) context.close()
                  }}
                />
              )}
            </For>
          </Show>
        </box>
      )}
    </Menu>
  )
}

/** One line in that menu: label and dim hint. */
export function PickerRow(props: {
  label: string
  description?: string
  active?: boolean
  disabled?: boolean
  leading?: JSX.Element
  role?: 'option'
  onSelect: () => void
  onHover?: () => void
}) {
  // `NODE_FOCUS` calls this an item inside `Rows`. An open `Menu` has no collection, so its rows
  // become stops and the menu's arrows walk them (../../keys/regions.ts § walkStops).
  const control = stop({ onPress: () => props.onSelect(), disabled: () => !!props.disabled })
  return (
    <box flexDirection="row" gap={1} flexShrink={0} ref={control.ref}>
      <Line tone="accent">{control.focused() || props.active ? '›' : ' '}</Line>
      {slot(props.leading)}
      <Line {...litControl({ focused: control.focused(), disabled: props.disabled })}>{props.label}</Line>
      <Show when={props.description}><Line role="muted">{props.description!}</Line></Show>
    </box>
  )
}
