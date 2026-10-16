import { FindBar } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'FindBar',
  caption: 'A find bar on the third of twelve matches.',
  terminal: { columns: 50, rows: 1 },
  width: 400,
}

export default function FindBarSpecimen() {
  return <FindBar query="redirect" count={{ current: 3, total: 12 }} placeholder="Find in log" />
}
