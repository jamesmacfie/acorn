import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import type { PullFile, Thread } from '../../queries'
import { buildDiffRows, buildRenderableRows, plainTokenize, toBands, wordDiff, type CodeRow, type ParsedFile } from './model'

const pullFile = (path: string, patch: string | null): PullFile => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 1,
  sha: `sha-${path}`,
  viewed: false,
  patch,
})

const thread = (path: string, line: number, side: 'LEFT' | 'RIGHT' | null = 'RIGHT'): Thread => ({
  threadId: `${path}:${line}:${side ?? 'RIGHT'}`,
  path,
  line,
  side,
  resolved: false,
  comments: [{ id: `${path}:${line}:c1`, databaseId: line, author: 'octo', body: 'note', createdAt: line }],
})

describe('diff model', () => {
  it('parses patch rows and attaches word diffs to paired changes', () => {
    const rows = buildDiffRows(
      pullFile(
        'src/app.ts',
        ['@@ -1,3 +1,3 @@', ' const a = 1', '-const name = "old"', '+const name = "new"', ' export { a }'].join('\n'),
      ),
      plainTokenize,
    )

    expect(rows.map((row) => row.kind)).toEqual(['hunk', 'normal', 'delete', 'insert', 'normal'])
    const del = rows.find((row): row is CodeRow => row.kind === 'delete')
    const ins = rows.find((row): row is CodeRow => row.kind === 'insert')
    expect(del?.words?.some((w) => w.kind === 'del')).toBe(true)
    expect(ins?.words?.some((w) => w.kind === 'add')).toBe(true)
  })

  it('interleaves threads by file and side without dropping no-diff files', () => {
    const parsed: ParsedFile[] = [
      {
        file: pullFile('src/app.ts', 'patch'),
        diff: [
          { kind: 'normal', path: 'src/app.ts', oldNo: 1, newNo: 1, toks: [], raw: 'same' },
          { kind: 'delete', path: 'src/app.ts', oldNo: 2, newNo: null, toks: [], raw: 'old' },
          { kind: 'insert', path: 'src/app.ts', oldNo: null, newNo: 2, toks: [], raw: 'new' },
        ],
      },
      { file: pullFile('image.png', null), diff: [] },
    ]

    const rows = buildRenderableRows(parsed, [thread('src/app.ts', 2, 'LEFT'), thread('src/app.ts', 2, 'RIGHT')])

    expect(rows.map((row) => row.kind)).toEqual(['file', 'normal', 'delete', 'thread', 'insert', 'thread', 'file', 'nodiff'])
  })

  it('creates split bands that preserve full-width rows and pair change runs', () => {
    const rows = buildRenderableRows(
      [
        {
          file: pullFile('src/app.ts', 'patch'),
          diff: [
            { kind: 'hunk', text: '@@ -1 +1 @@' },
            { kind: 'delete', path: 'src/app.ts', oldNo: 1, newNo: null, toks: [], raw: 'old' },
            { kind: 'insert', path: 'src/app.ts', oldNo: null, newNo: 1, toks: [], raw: 'new' },
          ],
        },
      ],
      [thread('src/app.ts', 1)],
    )

    expect(toBands(rows).map((band) => band.kind)).toEqual(['full', 'full', 'pair', 'full'])
  })

  it('keeps large row interleaving comfortably within the speed budget', () => {
    const parsed: ParsedFile[] = Array.from({ length: 1000 }, (_, i) => ({
      file: pullFile(`src/file-${i}.ts`, 'patch'),
      diff: [{ kind: 'normal', path: `src/file-${i}.ts`, oldNo: 1, newNo: 1, toks: [], raw: 'same' }],
    }))
    const threads = parsed.map(({ file }) => thread(file.path, 1))

    const start = performance.now()
    const rows = buildRenderableRows(parsed, threads)
    const elapsed = performance.now() - start

    expect(rows).toHaveLength(3000)
    expect(elapsed).toBeLessThan(250)
  })

  it('keeps word diff output byte-faithful on both sides', () => {
    const out = wordDiff('a  b', 'a   c')
    expect(out.del.map((t) => t.content).join('')).toBe('a  b')
    expect(out.add.map((t) => t.content).join('')).toBe('a   c')
  })
})
