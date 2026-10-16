import { Stack, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Text',
  caption: 'Text in each emphasis, and in the ok and danger tones.',
  terminal: { columns: 60, rows: 7 },
  width: 400,
}

export default function TextSpecimen() {
  return (
    <Stack gap="row">
      <Text emphasis="eyebrow">Pull request</Text>
      <Text emphasis="heading">Fix the redirect after sign-in</Text>
      <Text>Signing in from a deep link now returns to that link.</Text>
      <Text emphasis="muted">Opened by alex 2 hours ago</Text>
      <Text emphasis="mono">src/login.ts</Text>
      <Text tone="ok">All checks passed</Text>
      <Text tone="danger">Merge blocked</Text>
    </Stack>
  )
}
