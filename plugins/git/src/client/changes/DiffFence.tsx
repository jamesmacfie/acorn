import { Index } from 'solid-js'
import type { MarkdownFenceProps } from '@acorn/protocol/extensionPoints.ts'
import { Stack, StackedDiff } from '@acorn/plugin-api/ui'

/** The heading of a fence that names no file, such as a bare `-`/`+` snippet. */
export const UNNAMED_FENCE_FILE = 'Proposed change'

const headerPath = (side: string): string | undefined =>
  side === '/dev/null' ? undefined : side.split('\t')[0]!.replace(/^[ab]\//, '')

/**
 * A `diff` fence as the files it covers, each as hunks from its first `@@` on, which is the shape
 * `StackedDiff` takes. A file starts at `diff --git` or at a `---` line followed by `+++`, since
 * `parsePatch` puts its own header in front and would attach every hunk to one file. Text with no file
 * header is one unnamed file, and anything before the first header is dropped.
 */
export function diffFenceFiles(text: string): { path: string; patch: string }[] {
  const lines = text.split('\n')
  const isPair = (i: number) => lines[i]!.startsWith('--- ') && !!lines[i + 1]?.startsWith('+++ ')
  if (!lines.some((line, i) => line.startsWith('diff --git ') || isPair(i)))
    return [{ path: UNNAMED_FENCE_FILE, patch: text }]
  const files: { path: string; lines: string[] }[] = []
  // Between a file's first header line and its first `@@`: index, mode and rename lines are skipped.
  let inHeader = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('diff --git ')) {
      files.push({ path: line.match(/ b\/(.+)$/)?.[1] ?? line.slice(11), lines: [] })
      inHeader = true
    } else if (isPair(i)) {
      // The new side names the file as it now stands, and the old side a file this deletes.
      const path = headerPath(lines[i + 1]!.slice(4)) ?? headerPath(line.slice(4)) ?? UNNAMED_FENCE_FILE
      if (inHeader) files.at(-1)!.path = path
      else files.push({ path, lines: [] })
      inHeader = true
      i++
    } else {
      if (line.startsWith('@@')) inHeader = false
      if (!inHeader) files.at(-1)?.lines.push(line)
    }
  }
  return files.map((file) => ({ path: file.path, patch: file.lines.join('\n').trimEnd() }))
}

// Loaded when a `diff` fence first opens, so the diff toolkit stays outside the client's startup graph.
export default function DiffFence(props: MarkdownFenceProps) {
  return (
    <Stack gap="row">
      <Index each={diffFenceFiles(props.text)}>
        {(file) => <StackedDiff path={file().path} patch={file().patch} lineNumbers={false} />}
      </Index>
    </Stack>
  )
}
