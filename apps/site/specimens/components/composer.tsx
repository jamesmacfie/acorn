import { Composer } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Composer',
  caption: 'An empty composer with its placeholder and its send button.',
  terminal: { columns: 60, rows: 4 },
  width: 480,
}

export default function ComposerSpecimen() {
  return <Composer value="" placeholder="Ask about this deploy" submitLabel="Send" onSubmit={() => {}} />
}
