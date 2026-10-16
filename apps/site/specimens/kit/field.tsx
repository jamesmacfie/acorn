import { Field, Input } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Field with an Input',
  caption: 'A labelled text input with help under it.',
  terminal: { columns: 50, rows: 4 },
  width: 400,
}

export default function FieldSpecimen() {
  return (
    <Field label="Branch name" help="Letters, numbers, and dashes.">
      <Input value="fix-login-redirect" />
    </Field>
  )
}
