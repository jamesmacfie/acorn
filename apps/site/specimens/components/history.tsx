import { HistoryMark, Inline, Stack, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'HistoryMark',
  caption: 'Two commits on one lane, each mark beside its message.',
  terminal: { columns: 50, rows: 2 },
  width: 400,
}

export default function History() {
  return (
    <Stack gap="none">
      <Inline gap="inline">
        <HistoryMark
          slot={{
            id: 'b2c4e6f',
            lane: 0,
            lanes: 1,
            edges: [{ from: 0, to: 0, start: 'center', end: 'bottom', continuation: false }],
            continuation: false,
            disconnected: false,
          }}
        />
        <Text>Fix the redirect after sign-in</Text>
      </Inline>
      <Inline gap="inline">
        <HistoryMark
          slot={{
            id: '3f9a2c1',
            lane: 0,
            lanes: 1,
            edges: [{ from: 0, to: 0, start: 'top', end: 'center', continuation: false }],
            continuation: false,
            disconnected: false,
          }}
        />
        <Text>Add the sign-in page</Text>
      </Inline>
    </Stack>
  )
}
