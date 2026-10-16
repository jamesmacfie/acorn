import { Card, Stack, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Card',
  caption: 'A plain card, one with a warn stripe, and a selected one you can press.',
  terminal: { columns: 50, rows: 14 },
  width: 400,
}

export default function Cards() {
  return (
    <Stack gap="row">
      <Card>
        <Text>A deep link sends you back to sign-in.</Text>
      </Card>
      <Card stripe="warn">
        <Text>Two checks are still running.</Text>
      </Card>
      <Card interactive selected onPress={() => {}}>
        <Text>ACO-12 · Redirect loop</Text>
      </Card>
    </Stack>
  )
}
