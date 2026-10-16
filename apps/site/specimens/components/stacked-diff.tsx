import { StackedDiff } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'StackedDiff',
  caption: "One file's patch: its head, a hunk, two lines added, and one removed.",
  terminal: { columns: 70, rows: 7 },
  width: 560,
}

export default function StackedDiffSpecimen() {
  return (
    <StackedDiff
      path="src/login.ts"
      patch={[
        '@@ -1,3 +1,4 @@',
        ' import { session } from "./session"',
        '-const next = "/"',
        '+const next = params.get("next") ?? "/"',
        '+if (!next.startsWith("/")) throw new Error("Bad redirect")',
        ' redirect(next)',
        '',
      ].join('\n')}
    />
  )
}
