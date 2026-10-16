import { Input, Stack } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Input',
  caption: 'A text input with a value, an empty one with a placeholder, and one marked invalid.',
  terminal: { columns: 50, rows: 3 },
  width: 400,
}

export default function Inputs() {
  return (
    <Stack gap="row">
      <Input label="Branch name" value="fix-login-redirect" />
      <Input label="Reviewer" placeholder="Search people" />
      <Input label="Port" value="70000" invalid />
    </Stack>
  )
}
