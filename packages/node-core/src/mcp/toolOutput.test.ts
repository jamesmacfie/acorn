import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { capToolText } from './toolOutput'

describe('capToolText', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-tool-output-test-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('returns a text that fits unchanged and saves nothing', () => {
    expect(capToolText('small', join(dir, 'small.txt'))).toBe('small')
  })

  it('cuts a text with no line breaks between characters, never inside one', () => {
    // Three-byte characters after one ASCII byte, so neither cut point falls between characters.
    const text = `a${'€'.repeat(20_000)}`
    const file = join(dir, 'wide.txt')
    const [head, rest] = capToolText(text, file).split('\n[acorn cut this result: ')
    const tail = rest!.split(']\n')[1]
    expect(head).toBe(`a${'€'.repeat(8191)}`)
    expect(tail).toBe('€'.repeat(2730))
    expect(readFileSync(file, 'utf8')).toBe(text)
  })
})
