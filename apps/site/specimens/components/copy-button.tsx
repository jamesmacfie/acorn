import { CopyButton, Inline, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'CopyButton',
  caption: 'A commit hash and the button that copies it.',
  terminal: { columns: 40, rows: 1 },
  width: 320,
}

export default function CopyButtonSpecimen() {
  return (
    <Inline gap="inline">
      <Text emphasis="mono">3f9a2c1</Text>
      <CopyButton text="3f9a2c1" title="Copy the commit hash" always />
    </Inline>
  )
}
