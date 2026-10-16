import { MentionTextarea } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'MentionTextarea',
  caption: 'A comment field that completes @mentions from a list of names.',
  terminal: { columns: 50, rows: 4 },
  width: 400,
}

export default function MentionTextareaSpecimen() {
  return <MentionTextarea label="Comment" value="Can @sam take a look?" mentions={['alex', 'sam', 'kim']} rows={2} />
}
