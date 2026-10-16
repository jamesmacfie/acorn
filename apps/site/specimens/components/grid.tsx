import { Grid } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Grid',
  caption: 'Three rows of query results, the second selected.',
  terminal: { columns: 60, rows: 5 },
  width: 480,
}

export default function GridSpecimen() {
  return (
    <Grid
      ariaLabel="Query results"
      columns={['id', 'email', 'plan']}
      rows={[
        ['1', 'alex@acme.dev', 'team'],
        ['2', 'sam@acme.dev', 'pro'],
        ['3', 'kim@acme.dev', 'free'],
      ]}
      selected={1}
    />
  )
}
