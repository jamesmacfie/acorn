import { Inline, Kbd, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Kbd',
  caption: 'A key chord in a line of text.',
  terminal: { columns: 40, rows: 1 },
  width: 320,
}

export default function KbdSpecimen() {
  return (
    <Inline gap="inline">
      <Text>Press</Text>
      <Kbd>⌘K</Kbd>
      <Text>to open the palette.</Text>
    </Inline>
  )
}
