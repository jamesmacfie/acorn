import { Inline, StatusDot, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'StatusDot',
  caption: 'A dot in each tone, each beside the word it stands for.',
  terminal: { columns: 60, rows: 1 },
  width: 480,
}

export default function StatusDots() {
  return (
    <Inline gap="stack">
      <Inline gap="inline">
        <StatusDot tone="ok" label="Running" />
        <Text>running</Text>
      </Inline>
      <Inline gap="inline">
        <StatusDot tone="warn" label="Starting" />
        <Text>starting</Text>
      </Inline>
      <Inline gap="inline">
        <StatusDot tone="danger" label="Exited" />
        <Text>exited</Text>
      </Inline>
      <Inline gap="inline">
        <StatusDot tone="muted" label="Stopped" />
        <Text>stopped</Text>
      </Inline>
    </Inline>
  )
}
