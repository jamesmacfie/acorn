import { ListColumn, Row, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Row',
  caption: 'Three rows in a list: a selected one, a plain one, and a stacked one with a second line.',
  terminal: { columns: 60, rows: 5 },
  width: 480,
}

export default function RowSpecimen() {
  return (
    <ListColumn label="Issues">
      <Row meta="ACO-12" selected>
        Redirect loop after sign-in
      </Row>
      <Row meta="ACO-14">Flaky upload test</Row>
      <Row variant="stacked" meta="ACO-15">
        <Text>Slow first paint</Text>
        <Text emphasis="muted">Opened by sam yesterday</Text>
      </Row>
    </ListColumn>
  )
}
