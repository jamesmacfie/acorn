import { Inline, Spinner, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Spinner',
  caption: 'A spinner beside the work it stands for.',
  terminal: { columns: 40, rows: 1 },
  width: 320,
}

export default function SpinnerSpecimen() {
  return (
    <Inline gap="inline">
      <Spinner label="Loading deploys" />
      <Text emphasis="muted">Loading deploys</Text>
    </Inline>
  )
}
