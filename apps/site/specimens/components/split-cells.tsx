import { Inline, SplitCell } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'SplitCell',
  caption: 'One changed line as a split diff draws it: the old half beside the new. The terminal has no split diff.',
  terminal: { columns: 60, rows: 1 },
  width: 560,
}

const cell = (kind: 'insert' | 'delete', oldNo: number | null, newNo: number | null, raw: string) => ({
  kind,
  path: 'src/login.ts',
  oldNo,
  newNo,
  raw,
  toks: [{ content: raw, light: '', dark: '' }],
})

export default function SplitCells() {
  return (
    <Inline gap="none" even>
      <SplitCell r={cell('delete', 2, null, 'const next = "/"')} gutter={2} canAdd={false} />
      <SplitCell r={cell('insert', null, 2, 'const next = params.get("next") ?? "/"')} gutter={2} canAdd={false} />
    </Inline>
  )
}
