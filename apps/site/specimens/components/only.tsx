import { Only, Stack, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Only',
  caption: 'One line on both hosts, and one line each host draws on its own.',
  terminal: { columns: 50, rows: 2 },
  width: 400,
}

export default function OnlySpecimen() {
  return (
    <Stack gap="row">
      <Text>Deploys run on the Node.</Text>
      <Only hosts={['dom']}>
        <Text emphasis="muted">Drag a row to reorder it.</Text>
      </Only>
      <Only hosts={['tui']}>
        <Text emphasis="muted">Press Ctrl+Shift+Up to move a row.</Text>
      </Only>
    </Stack>
  )
}
