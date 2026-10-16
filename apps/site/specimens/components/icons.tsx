import { Icon, Inline, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Icon',
  caption: 'Four state icons in their tones, each with the word it stands for.',
  terminal: { columns: 60, rows: 1 },
  width: 480,
}

export default function Icons() {
  return (
    <Inline gap="stack">
      <Inline gap="inline">
        <Icon name="circle-check" tone="ok" />
        <Text>passed</Text>
      </Inline>
      <Inline gap="inline">
        <Icon name="triangle-alert" tone="warn" />
        <Text>flaky</Text>
      </Inline>
      <Inline gap="inline">
        <Icon name="circle-alert" tone="danger" />
        <Text>failed</Text>
      </Inline>
      <Inline gap="inline">
        <Icon name="clock" tone="muted" />
        <Text>queued</Text>
      </Inline>
    </Inline>
  )
}
