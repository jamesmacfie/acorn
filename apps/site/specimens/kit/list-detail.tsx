import { DetailColumn, Heading, ListColumn, ListDetail, Row, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'ListDetail with rows',
  caption: 'A list of rows beside the detail of the selected one.',
  terminal: { columns: 100, rows: 6 },
  width: 640,
}

export default function ListDetailSpecimen() {
  return (
    <ListDetail split listWidth="narrow">
      <ListColumn label="Issues">
        <Row density="compact" meta="ACO-12" selected>
          Redirect loop
        </Row>
        <Row density="compact" meta="ACO-14">
          Flaky upload
        </Row>
        <Row density="compact" meta="ACO-15">
          Slow first paint
        </Row>
      </ListColumn>
      <DetailColumn>
        <Heading level={2}>Redirect loop</Heading>
        <Text>Signing in from a deep link sends the browser back to the sign-in page.</Text>
      </DetailColumn>
    </ListDetail>
  )
}
