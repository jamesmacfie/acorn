import { Checkbox, Stack } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Checkbox',
  caption: 'A checked box, an empty one with a hint, and a switch.',
  terminal: { columns: 50, rows: 4 },
  width: 400,
}

export default function Checkboxes() {
  return (
    <Stack gap="row">
      <Checkbox label="Run checks on push" checked />
      <Checkbox label="Notify reviewers" hint="Posts in the team channel." />
      <Checkbox label="Auto-deploy" switch checked />
    </Stack>
  )
}
