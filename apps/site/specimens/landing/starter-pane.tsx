import { Button, Card, Heading, Stack, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

// The pane `npm create acorn-plugin` scaffolds (packages/create-acorn-plugin/index.mjs), for a plugin
// named Hello.
export const meta: SpecimenMeta = {
  title: 'Hello',
  caption: 'The pane a new plugin starts with, from the entry beside it.',
  terminal: { columns: 60, rows: 7 },
  width: 480,
}

export default function StarterPane() {
  return (
    <Card>
      <Stack gap="row">
        <Heading>Hello</Heading>
        <Text>Ask the Node for a greeting</Text>
        <Button variant="solid" label="Say hello" />
      </Stack>
    </Card>
  )
}
