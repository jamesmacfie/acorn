import { Textarea } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Textarea',
  caption: 'A three-line text area holding a commit message.',
  terminal: { columns: 50, rows: 5 },
  width: 400,
}

export default function TextareaSpecimen() {
  return (
    <Textarea label="Commit message" rows={3} value={'Fix the redirect after sign-in\n\nKeeps the next parameter.'} />
  )
}
