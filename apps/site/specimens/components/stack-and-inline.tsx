import { Badge, Inline, Stack, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Stack and Inline',
  caption: 'A stack of three lines, each an inline run spaced by the inline gap.',
  terminal: { columns: 50, rows: 3 },
  width: 400,
}

export default function StackAndInline() {
  return (
    <Stack gap="row">
      <Inline gap="inline">
        <Text emphasis="strong">build</Text>
        <Badge tone="ok">passed</Badge>
      </Inline>
      <Inline gap="inline">
        <Text emphasis="strong">test</Text>
        <Badge tone="warn">flaky</Badge>
      </Inline>
      <Inline gap="inline">
        <Text emphasis="strong">deploy</Text>
        <Badge>waiting</Badge>
      </Inline>
    </Stack>
  )
}
