import { Fold, Stack, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Fold',
  caption: 'An open fold with a count, and a closed one.',
  terminal: { columns: 50, rows: 4 },
  width: 400,
}

export default function FoldSpecimen() {
  return (
    <Stack gap="row">
      <Fold label="Changed files" count={2} defaultOpen>
        <Text>src/login.ts</Text>
        <Text>src/session.ts</Text>
      </Fold>
      <Fold label="Commits" count={4}>
        <Text>Fix the redirect after sign-in</Text>
      </Fold>
    </Stack>
  )
}
