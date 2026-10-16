import { Card, Text, Timeline } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Timeline',
  caption: 'A sequence of turns, each a card.',
  terminal: { columns: 60, rows: 14 },
  width: 480,
}

export default function TimelineSpecimen() {
  return (
    <Timeline ariaLabel="Review">
      <Card>
        <Text>Opened the pull request.</Text>
      </Card>
      <Card>
        <Text>Asked for a test that covers the redirect.</Text>
      </Card>
      <Card>
        <Text>Added the test and pushed.</Text>
      </Card>
    </Timeline>
  )
}
