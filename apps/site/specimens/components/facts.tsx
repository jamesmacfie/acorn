import { Facts } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Facts',
  caption: 'Four facts about a deploy, in two columns.',
  terminal: { columns: 60, rows: 4 },
  width: 480,
}

export default function FactsSpecimen() {
  return (
    <Facts
      items={[
        { label: 'Environment', value: 'staging' },
        { label: 'Commit', value: '3f9a2c1', mono: true },
        { label: 'Started', value: '12 minutes ago' },
        { label: 'Duration', value: '2m 14s' },
      ]}
    />
  )
}
