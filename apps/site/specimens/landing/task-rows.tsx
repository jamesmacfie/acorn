import { ListColumn, Row } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Tasks',
  caption: 'Three tasks on one project, each on its own branch.',
  terminal: { columns: 80, rows: 3 },
  width: 480,
}

export default function TaskRows() {
  return (
    <ListColumn label="Tasks">
      <Row density="compact" meta="retry-failed-webhooks">
        Retry failed webhooks
      </Row>
      <Row density="compact" meta="add-eu-vat">
        Add VAT to EU invoices
      </Row>
      <Row density="compact" meta="speed-up-the-overdue-invoices-query">
        Speed up the overdue invoices query
      </Row>
    </ListColumn>
  )
}
