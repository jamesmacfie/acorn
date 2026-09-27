import type { JSX } from 'solid-js'
import { createCollection } from '../../keys/collection'

/* SegmentedControl and ToggleButton stay two components because the semantics differ. Segments
   switch a value (radiogroup, arrow keys); a toggle flips one boolean (aria-pressed). Neither is
   Tabs, which switches panels and gets tablist semantics. */
export function SegmentedControl<T extends string>(props: {
  options: readonly { value: T; label: JSX.Element; title?: string; disabled?: boolean }[]
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
    <div class="ui-segments" data-size={props.size ?? 'md'} aria-label={props.ariaLabel} {...collection.containerProps}>
      {/* Buttons, not Row: menus and segments are their own semantics (see Button's note). */}
      {props.options.map((option) => (
        <button
          {...collection.itemProps(option.value)}
          type="button"
          class="ui-segment"
          aria-checked={option.value === props.value}
          disabled={option.disabled}
          title={option.title}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
