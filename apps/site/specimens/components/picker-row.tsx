import { PickerRow, Stack } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'PickerRow',
  caption: 'Two rows as an open picker lists them, the first one active.',
  terminal: { columns: 50, rows: 2 },
  width: 400,
}

export default function PickerRows() {
  return (
    <Stack gap="none">
      <PickerRow label="Alex" description="alex@acme.dev" active onSelect={() => {}} />
      <PickerRow label="Sam" description="sam@acme.dev" onSelect={() => {}} />
    </Stack>
  )
}
