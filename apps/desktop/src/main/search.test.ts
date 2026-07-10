import { describe, expect, it } from 'vitest'
import { parseRgJson } from './search'

// A `rg --json` line for a match. Mirrors the real event shape (see searchIpc.ts RgEvent).
const begin = (path: string) => JSON.stringify({ type: 'begin', data: { path: { text: path } } })
const match = (path: string, line: number, text: string, start: number, end: number) =>
  JSON.stringify({ type: 'match', data: { path: { text: path }, lines: { text }, line_number: line, submatches: [{ start, end }] } })
const end = (path: string) => JSON.stringify({ type: 'end', data: { path: { text: path } } })

describe('parseRgJson', () => {
  it('groups matches by file and maps offsets to 1-based columns', () => {
    const out = parseRgJson([begin('./src/a.ts'), match('./src/a.ts', 12, 'const foo = 1\n', 6, 9), end('./src/a.ts')].join('\n'))
    expect(out.truncated).toBe(false)
    expect(out.files).toEqual([{ path: 'src/a.ts', hits: [{ line: 12, col: 7, endCol: 10, preview: 'const foo = 1' }] }])
  })

  it('strips the ./ prefix rg adds when searching path `.`', () => {
    const out = parseRgJson([begin('./deep/b.ts'), match('./deep/b.ts', 1, 'x\n', 0, 1), end('./deep/b.ts')].join('\n'))
    expect(out.files[0].path).toBe('deep/b.ts')
  })

  it('trims the trailing newline and clamps very long preview lines', () => {
    const long = 'a'.repeat(500)
    const out = parseRgJson([begin('c.ts'), match('c.ts', 1, long + '\n', 0, 1), end('c.ts')].join('\n'))
    expect(out.files[0].hits[0].preview.length).toBe(300)
  })

  it('drops empty/non-JSON lines and files with no surviving hits', () => {
    const out = parseRgJson(['', 'not json', begin('empty.ts'), end('empty.ts')].join('\n'))
    expect(out.files).toEqual([])
  })

  it('caps total hits and flags truncation', () => {
    const lines = [begin('big.ts')]
    for (let i = 1; i <= 2100; i++) lines.push(match('big.ts', i, 'hit\n', 0, 3))
    lines.push(end('big.ts'))
    const out = parseRgJson(lines.join('\n'))
    expect(out.truncated).toBe(true)
    expect(out.files[0].hits.length).toBe(2000)
  })
})
