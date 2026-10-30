import { Button, DiffNote, Inline, StackedDiff, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'DiffNote',
  caption: 'A Risk note pinned under the line it describes, with its body and a button.',
  terminal: { columns: 70, rows: 10 },
  width: 560,
}

export default function DiffNoteSpecimen() {
  return (
    <StackedDiff
      path="src/login.ts"
      patch={[
        '@@ -1,3 +1,3 @@',
        ' import { session } from "./session"',
        '-const next = "/"',
        '+const next = params.get("next") ?? "/"',
        ' redirect(next)',
        '',
      ].join('\n')}
    >
      <DiffNote side="new" line={2} tone="danger" label="Risk" author="Claude Code" title="An open redirect">
        <Text>The query string sets next, so any site can send a reader here and on to itself.</Text>
        <Inline>
          <Button size="sm" variant="ghost">
            Show in diff
          </Button>
        </Inline>
      </DiffNote>
    </StackedDiff>
  )
}
