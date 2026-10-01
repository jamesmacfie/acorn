import { Show } from 'solid-js'
import { PROJECT_COLORS, resolveProjectColor } from '@acorn/protocol/projectColor.ts'
import { IconButton } from '../../kit/components/inputs/IconButton'
import './projects.css'

/** Named presets for a colour list, in the order `PROJECT_COLORS` holds them. */
export const PROJECT_COLOR_OPTIONS = Object.keys(PROJECT_COLORS).map((key) => ({
  value: key,
  label: key[0]!.toUpperCase() + key.slice(1),
}))

// A project's rail colour: the native colour well, which is the one control that offers any colour,
// and a clear button beside it once one is set. The kit has no colour node, and this is not a text
// entry, so it stays a raw input here rather than an Input wearing a colour type.
export function ProjectColorInput(props: {
  name: string
  color: string | null
  disabled?: boolean
  /** May return the write it started. When that resolves `false` the well shows the stored colour
   *  again, as a switch does (kit Checkbox): the stored value never moved, so nothing else would. */
  onChange: (color: string | null) => unknown
}) {
  return (
    <span class="ws-row-controls">
      <input
        class="ws-project-color"
        classList={{ 'ws-project-color-empty': !props.color }}
        type="color"
        aria-label={`Rail colour for ${props.name}`}
        data-tip={props.color ? 'Change rail colour' : 'Choose a rail colour'}
        value={resolveProjectColor(props.color) ?? PROJECT_COLORS.gray}
        disabled={props.disabled}
        onChange={(event) => {
          const well = event.currentTarget
          const write = props.onChange(well.value)
          if (write instanceof Promise) void write.then((saved) => { if (saved === false) well.value = resolveProjectColor(props.color) ?? PROJECT_COLORS.gray })
        }}
      />
      <Show when={props.color}>
        <IconButton
          icon="x"
          label={`Clear rail colour for ${props.name}`}
          title="Clear rail colour"
          disabled={props.disabled}
          onPress={() => props.onChange(null)}
        />
      </Show>
    </span>
  )
}
