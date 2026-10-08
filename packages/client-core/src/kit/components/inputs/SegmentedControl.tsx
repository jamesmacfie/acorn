import { Show, type JSX } from 'solid-js'
import { createCollection } from '../../keys/collection'

/* SegmentedControl and ToggleButton stay two components because the semantics differ. Segments
   switch a value (radiogroup, arrow keys); a toggle flips one boolean (aria-pressed). Neither is
   Tabs, which switches panels and gets tablist semantics.

   An option with a `detail` draws it under its label, and the whole control becomes a row of tall
   segments with a radio mark in each head. It is the same radiogroup: one stop, arrows move the
   value. That is the shape for a choice that needs a picture to explain it. The picture is hidden
   from assistive technology, so the label alone is the option's name and must carry the choice. */
export function SegmentedControl<T extends string>(props: {
  options: readonly { value: T; label: JSX.Element; title?: string; disabled?: boolean; detail?: JSX.Element }[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  ariaLabel: string
}) {
  const collection = createCollection({
    id: () => `segments:${props.ariaLabel}`,
    items: () => props.options.map((option) => ({ key: option.value, disabled: option.disabled })),
    role: 'radiogroup',
    orientation: 'horizontal',
    selectOnMove: true,
    selected: () => props.value,
    onSelect: (value) => props.onChange(value as T),
  })
  return (
    <div
      class="ui-segments"
      data-size={props.size ?? 'md'}
      data-detail={props.options.some((option) => option.detail) ? '' : undefined}
      aria-label={props.ariaLabel} {...collection.containerProps}>
      {/* Buttons, not Row: menus and segments are their own semantics (see Button's note). */}
      {props.options.map((option) => (
        <button
          {...collection.itemProps(option.value)}
          type="button"
          class="ui-segment"
          aria-checked={option.value === props.value}
          disabled={option.disabled}
          data-tip={option.title}
          onClick={() => props.onChange(option.value)}
        >
          <Show when={option.detail} fallback={option.label}>
            <span class="ui-segment-head"><span class="ui-segment-radio" />{option.label}</span>
            <span class="ui-segment-detail" aria-hidden="true">{option.detail}</span>
          </Show>
        </button>
      ))}
    </div>
  )
}
