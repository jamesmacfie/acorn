/** @jsxImportSource @acorn/tui/jsx */
import type { IconPickerProps } from '@acorn/client-core/kit/components/inputs'
import { Input } from './fields'
import { Button } from './buttons'

/** Icon names remain editable in cells; the terminal has no glyph previews. */
export function IconPicker(props: IconPickerProps) {
  return (
    <box flexDirection="row" gap={1}>
      <Input
        label={props.ariaLabel ?? 'Icon'}
        value={props.value ?? ''}
        placeholder={props.fallback}
        maxLength={200}
        disabled={props.disabled}
        onInput={(value) => props.onSelect(value.trim() || null)}
      />
      <Button disabled={props.disabled || !props.value} onPress={() => props.onSelect(null)}>
        Use the default icon
      </Button>
    </box>
  )
}
