import { DiffLine, NonCodeRow, Stack } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'DiffLine and NonCodeRow',
  caption: 'A hunk header, then an unchanged line, a removed one, and an added one.',
  terminal: { columns: 60, rows: 4 },
  width: 480,
}

// A diff line's text arrives as tokens, each with the color it takes in a light and a dark theme. An
// empty color leaves the line's own.
const line = (kind: 'normal' | 'insert' | 'delete', oldNo: number | null, newNo: number | null, raw: string) => ({
  kind,
  path: 'src/login.ts',
  oldNo,
  newNo,
  raw,
  toks: [{ content: raw, light: '', dark: '' }],
})

export default function DiffRows() {
  return (
    <Stack gap="none">
      <NonCodeRow row={{ kind: 'hunk', text: '@@ -1,3 +1,3 @@' }} />
      <DiffLine r={line('normal', 1, 1, 'import { session } from "./session"')} canAdd={false} />
      <DiffLine r={line('delete', 2, null, 'const next = "/"')} canAdd={false} />
      <DiffLine r={line('insert', null, 2, 'const next = params.get("next") ?? "/"')} canAdd={false} />
    </Stack>
  )
}
