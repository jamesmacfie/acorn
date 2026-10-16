import { Inline, ToggleButton } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'ToggleButton',
  caption: 'Two toggles, one pressed in.',
  terminal: { columns: 40, rows: 1 },
  width: 320,
}

export default function ToggleButtons() {
  return (
    <Inline gap="inline">
      <ToggleButton label="Wrap lines" pressed />
      <ToggleButton label="Whitespace" pressed={false} />
    </Inline>
  )
}
