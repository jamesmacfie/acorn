import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeRow, DiffSource } from '@acorn/plugin-api/ui/diff'
import { ChangeRequestDiff, type ChangeRequestDiffSource } from './ChangeRequestDiff'
import type { InlineDiffSurface } from './lineConversation'

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

type Mark = ReturnType<Parameters<NonNullable<DiffSource['inlineChat']>['render']>[1]>[number]
const noteMark: Mark = {
  key: {},
  pluginId: 'review-guide',
  severity: 'danger',
  text: 'This may overflow.',
  detail: { kind: 'markdown', value: 'Check **the cap**.' },
  note: { author: 'Claude Code', label: 'Risk' },
}

// Draws the diff, then the line under `row` with `marks`, and hands back what the card was given.
const drawLine = (marks: () => readonly Mark[]) => {
  const cards: { origin: unknown; notes: unknown }[] = []
  const inline: InlineDiffSurface = {
    prime: () => {},
    sessionsForTask: () => [],
    reportPatches: () => {},
    Card: (props) => {
      cards.push({ origin: props.origin, notes: props.notes?.map((note) => note.props) })
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
  disposers.push(render(() => chat.render(row, marks), host))
  return { chat, cards, host }
}

describe("the agent card on a change request's line", () => {
  it('opens on a line whose mark is a note, with the note as its opening message', () => {
    const { cards } = drawLine(() => [noteMark])
    expect(cards).toEqual([
      {
        origin: expect.objectContaining({
          path: 'src/a.ts',
          side: 'new',
          line: 4,
          patchKey: 'p1',
          quote: 'const cap = 10',
        }),
        notes: [
          {
            side: 'new',
            line: 4,
            tone: 'danger',
            title: 'This may overflow.',
            from: 'review-guide',
            author: 'Claude Code',
            label: 'Risk',
            body: 'Check **the cap**.',
          },
        ],
      },
    ])
  })

  it('draws nothing on a line with no note until ✦ opens it', () => {
    const { chat, cards } = drawLine(() => [])
    expect(cards).toEqual([])
    chat.open(row)
    expect(cards).toEqual([{ origin: expect.objectContaining({ line: 4 }), notes: [] }])
  })

  it('keeps the card when a note mark arrives on a line already open', () => {
    const [marks, setMarks] = createSignal<readonly Mark[]>([])
    const { chat, cards } = drawLine(marks)
    chat.open(row)
    setMarks([noteMark])
    // One card, mounted once: the same line's origin doesn't remount it.
    expect(cards).toHaveLength(1)
  })
})
