import { createPatch } from 'diff'
import { Stack, StackedDiff, Text } from '@acorn/plugin-api/ui'

/** A read-only comparison of a named disk snapshot and the live draft. */
export default function EditorComparison(props: { path: string; disk: string; draft: string }) {
  const patch = () => {
    const unified = createPatch(props.path, props.disk, props.draft, 'Disk snapshot', 'Live draft')
    const start = unified.indexOf('@@ ')
    return start < 0 ? '' : unified.slice(start)
  }
  return <Stack>
    <Text>Disk snapshot → Live draft</Text>
    <StackedDiff path={props.path} patch={patch()} />
  </Stack>
}
