import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeRow, DiffSource } from '@acorn/plugin-api/ui/diff'
import { ChangeRequestDiff, type ChangeRequestDiffSource, type InlineDiffSurface } from './ChangeRequestDiff'

// The source the diff shell is handed is what this view adds, so the shell is stood in for to catch it.
const shell = vi.hoisted(() => ({ source: undefined as DiffSource | undefined }))
vi.mock('@acorn/plugin-api/ui', async (original) => ({
  ...(await original<typeof import('@acorn/plugin-api/ui')>()),
  DiffPane: (props: { source: DiffSource }) => {
    shell.source = props.source
    return null
  },
}))

const row: CodeRow = { kind: 'insert', path: 'src/a.ts', oldNo: null, newNo: 4, toks: [], raw: 'const cap = 10' }

const disposers: (() => void)[] = []
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()))

// Draws the diff, then the card under `row`, and hands back how the card loads its context.
const drawCard = (open: (chat: NonNullable<DiffSource['inlineChat']>) => void) => {
  let loadContext: (() => Promise<string>) | undefined
  const inline: InlineDiffSurface = {
    prime: () => {},
    sessionsForTask: () => [],
    reportPatches: () => {},
    Card: (props) => {
      loadContext = props.loadContext
      return null
    },
  }
  const source = {
    topology: () => ({ files: [{ path: 'src/a.ts', patchKey: 'p1', segments: [] }] }),
    threads: () => [],
  } as unknown as ChangeRequestDiffSource
  const host = document.createElement('div')
  disposers.push(
    render(
      () => (
        <ChangeRequestDiff
          source={source}
          taskId="task-1"
          pull={{ owner: 'acme', repo: 'shop', number: '7' }}
          inline={() => inline}
          warning={() => null}
          annotations="github:diff-line"
        />
      ),
      host,
    ),
  )
  const chat = shell.source!.inlineChat!
  open(chat)
  disposers.push(render(() => chat.render(row), host))
  return loadContext
}

describe("the agent card on a change request's line", () => {
  it("starts its context with the note it was opened with, then the line's code", async () => {
    const loadContext = drawCard((chat) => chat.open(row, { note: 'This may overflow.\n\nCheck the cap.' }))
    expect(await loadContext!()).toBe(
      "The reader asked from a plugin's note on this line. The plugin wrote it, not the reader:\nThis may overflow.\n\nCheck the cap.\n\nconst cap = 10",
    )
  })

  it("gives only the line's code when opened with no note", async () => {
    const loadContext = drawCard((chat) => chat.open(row))
    expect(await loadContext!()).toBe('const cap = 10')
  })
})
