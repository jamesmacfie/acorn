import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import type { PullFile, Thread } from '../../../../core/client/queries'
import {
  buildDiffRows,
  buildRenderableRows,
  estimateRowSize,
  estimateSplitBandSize,
  expandGap,
  gapId,
  plainTokenize,
  rowIdentityKeys,
  splitBandIdentityKeys,
  toBands,
  wordDiff,
  type CodeRow,
  type GapRow,
  type ParsedFile,
} from './model'

const pullFile = (path: string, patch: string | null): PullFile => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 1,
  sha: `sha-${path}`,
  viewed: false,
  patch,
})

const thread = (path: string, line: number, side: 'LEFT' | 'RIGHT' | null = 'RIGHT', resolved = false): Thread => ({
  threadId: `${path}:${line}:${side ?? 'RIGHT'}`,
  path,
  line,
  side,
  resolved,
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

    // Trailing 'gap' is the below-last-hunk expand affordance (size unknown until the body loads).
    expect(rows.map((row) => row.kind)).toEqual(['hunk', 'normal', 'delete', 'insert', 'normal', 'gap'])
    const del = rows.find((row): row is CodeRow => row.kind === 'delete')
    const ins = rows.find((row): row is CodeRow => row.kind === 'insert')
    expect(del?.words?.some((w) => w.kind === 'del')).toBe(true)
    expect(ins?.words?.some((w) => w.kind === 'add')).toBe(true)
  })

  it('injects top/mid/bottom gaps and expands them from the head body', () => {
    const rows = buildDiffRows(
      pullFile(
        'src/app.ts',
        ['@@ -10,1 +10,1 @@', '-x', '+y', '@@ -20,1 +20,1 @@', '-p', '+q'].join('\n'),
      ),
      plainTokenize,
    )
    const gaps = rows.filter((r): r is GapRow => r.kind === 'gap')
    expect(gaps.map((g) => g.side)).toEqual(['top', 'mid', 'bottom'])
    expect(gaps[0]).toMatchObject({ newStart: 1, count: 9 }) // lines 1..9 above the first hunk
    expect(gaps[1]).toMatchObject({ newStart: 11, count: 9 }) // lines 11..19 between hunks
    expect(gaps[2]).toMatchObject({ side: 'bottom', newStart: 21, count: null })

    const body = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n')
    const top = expandGap(gaps[0]!, body, plainTokenize)
    expect(top.map((r) => r.raw)).toEqual(Array.from({ length: 9 }, (_, i) => `line ${i + 1}`))
    expect(top[0]).toMatchObject({ oldNo: 1, newNo: 1 })
    const bottom = expandGap(gaps[2]!, body, plainTokenize) // count null → to EOF (lines 21..25)
    expect(bottom.map((r) => r.raw)).toEqual(['line 21', 'line 22', 'line 23', 'line 24', 'line 25'])

    const expanded = new Map([[gapId(gaps[0]!), top]])
    const rendered = buildRenderableRows([{ file: pullFile('src/app.ts', 'patch'), diff: rows }], [], expanded)
    expect(rendered.filter((r) => r.kind === 'normal' && r.raw === 'line 1')).toHaveLength(1)
  })

  it('interleaves review threads on expanded gap lines', () => {
    const rows = buildDiffRows(
      pullFile('src/app.ts', ['@@ -10,1 +10,1 @@', '-x', '+y'].join('\n')),
      plainTokenize,
    )
    const gap = rows.find((r): r is GapRow => r.kind === 'gap' && r.side === 'top')!
    const expanded = new Map([[gapId(gap), expandGap(gap, Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n'), plainTokenize)]])

    const rendered = buildRenderableRows(
      [{ file: pullFile('src/app.ts', 'patch'), diff: rows }],
      [thread('src/app.ts', 1, 'LEFT'), thread('src/app.ts', 2, 'RIGHT')],
      expanded,
    )
    const lineOne = rendered.findIndex((r) => r.kind === 'normal' && r.raw === 'line 1')
    const lineTwo = rendered.findIndex((r) => r.kind === 'normal' && r.raw === 'line 2')

    expect(rendered[lineOne + 1]).toMatchObject({ kind: 'thread', thread: { line: 1, side: 'LEFT' } })
    expect(rendered[lineTwo + 1]).toMatchObject({ kind: 'thread', thread: { line: 2, side: 'RIGHT' } })
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

  it('gives progressively hydrated rows distinct stable identities', () => {
    const summary = buildRenderableRows(
      [{ file: pullFile('src/app.ts', null), diff: [{ kind: 'load', file: pullFile('src/app.ts', null), status: 'loading' }] }],
      [],
    )
    const hydrated = buildRenderableRows(
      [
        {
          file: pullFile('src/app.ts', 'patch'),
          diff: buildDiffRows(
            pullFile(
              'src/app.ts',
              [
                '@@ -1,2 +1,2 @@',
                '-const a = 1',
                '+const a = 2',
                '@@ -10,2 +10,2 @@',
                '-const b = 1',
                '+const b = 2',
              ].join('\n'),
            ),
            plainTokenize,
          ),
        },
      ],
      [],
    )

    const summaryKeys = rowIdentityKeys(summary)
    const hydratedKeys = rowIdentityKeys(hydrated)

    expect(summaryKeys[1]).toBe('load:src/app.ts:loading')
    expect(hydratedKeys[1]).toBe('hunk:src/app.ts:@@ -1,2 +1,2 @@')
    expect(hydratedKeys).not.toContain(summaryKeys[1])
    expect(new Set(hydratedKeys).size).toBe(hydratedKeys.length)
  })

  it('gives split bands unique identities for repeated one-sided fallback rows', () => {
    const rows = buildRenderableRows(
      [
        {
          file: pullFile('src/fallback.txt', 'patch'),
          diff: [
            { kind: 'insert', path: 'src/fallback.txt', oldNo: null, newNo: null, toks: [], raw: 'same' },
            { kind: 'insert', path: 'src/fallback.txt', oldNo: null, newNo: null, toks: [], raw: 'same' },
          ],
        },
      ],
      [],
    )
    const keys = splitBandIdentityKeys(toBands(rows))

    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('pair:empty:code:src/fallback.txt:insert::')
    expect(keys).toContain('pair:empty:code:src/fallback.txt:insert:::1')
  })

  it('estimates split band sizes from full rows and paired cells', () => {
    const rows = buildRenderableRows(
      [
        {
          file: pullFile('src/app.ts', 'patch'),
          diff: [
            { kind: 'delete', path: 'src/app.ts', oldNo: 1, newNo: null, toks: [], raw: 'old' },
            { kind: 'insert', path: 'src/app.ts', oldNo: null, newNo: 1, toks: [], raw: 'new' },
          ],
        },
      ],
      [thread('src/app.ts', 1)],
    )
    const bands = toBands(rows)

    expect(estimateSplitBandSize(bands[0])).toBe(36)
    expect(estimateSplitBandSize(bands[1])).toBe(20)
    expect(estimateSplitBandSize(bands[2])).toBe(140)
  })

  it('estimates resolved thread rows at their collapsed height', () => {
    const openRow = { kind: 'thread' as const, thread: thread('src/app.ts', 1) }
    const resolvedRow = { kind: 'thread' as const, thread: thread('src/app.ts', 1, 'RIGHT', true) }

    expect(estimateRowSize(openRow)).toBe(140)
    expect(estimateRowSize(resolvedRow)).toBe(50)
    expect(estimateSplitBandSize({ kind: 'full', row: resolvedRow })).toBe(50)
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
