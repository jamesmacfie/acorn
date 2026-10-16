import { Alert, Stack } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Alert',
  caption: 'Alerts in each tone, one with a title.',
  terminal: { columns: 60, rows: 6 },
  width: 480,
}

export default function AlertSpecimen() {
  return (
    <Stack gap="row">
      <Alert tone="ok">The branch is up to date.</Alert>
      <Alert tone="warn">Two checks are still running.</Alert>
      <Alert tone="danger" title="Push rejected">
        The remote has commits you don't have.
      </Alert>
    </Stack>
  )
}
