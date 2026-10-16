import { Button, ListColumn, Row, RowActions } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'RowActions',
  caption: 'A row with its actions. The desktop folds them behind a menu button, and the terminal draws them.',
  terminal: { columns: 60, rows: 1 },
  width: 480,
}

export default function RowActionsSpecimen() {
  return (
    <ListColumn label="Deploys">
      <Row meta="12m ago">
        staging
        <RowActions ariaLabel="Deploy actions">
          <Button label="Redeploy" />
        </RowActions>
      </Row>
    </ListColumn>
  )
}
