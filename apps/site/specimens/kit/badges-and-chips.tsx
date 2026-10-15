import { Badge, Chip, ChipRow, Inline, Stack } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Badge and Chip',
  caption: 'Badges in each tone, and a row of chips with one selected.',
  terminal: { columns: 60, rows: 3 },
  width: 480,
}

export default function BadgesAndChips() {
  return (
    <Stack gap="row">
      <Inline gap="inline">
        <Badge>draft</Badge>
        <Badge tone="accent">review</Badge>
        <Badge tone="ok">passing</Badge>
        <Badge tone="warn">flaky</Badge>
        <Badge tone="danger">failing</Badge>
      </Inline>
      <ChipRow>
        <Chip>frontend</Chip>
        <Chip selected>agents</Chip>
        <Chip tone="warn">needs triage</Chip>
      </ChipRow>
    </Stack>
  )
}
