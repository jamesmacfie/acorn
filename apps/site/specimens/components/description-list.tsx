import { DescriptionList, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'DescriptionList',
  caption: 'A description list holding text. A tree has no item node to put in it, so Facts is the usual choice.',
  terminal: { columns: 60, rows: 1 },
  width: 480,
}

export default function DescriptionListSpecimen() {
  return (
    <DescriptionList layout="facts">
      <Text>Deployed to staging by alex.</Text>
    </DescriptionList>
  )
}
