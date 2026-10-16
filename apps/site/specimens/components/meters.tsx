import { Inline, Meter, Stack } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Meter',
  caption: 'A bar at 62 percent with a mark at 80, a warn bar, and a pie.',
  terminal: { columns: 40, rows: 3 },
  width: 360,
}

export default function Meters() {
  return (
    <Stack gap="row">
      <Meter label="Context used" value={0.62} mark={0.8} />
      <Meter label="Budget spent" value={0.91} tone="warn" />
      <Inline gap="inline">
        <Meter label="Checks done" value={0.5} shape="pie" />
      </Inline>
    </Stack>
  )
}
