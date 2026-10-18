import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { capToolText, sweepToolOutput } from './toolOutput'
import { toolOutputDir } from './toolOutputDir'

// `os.tmpdir()` reads TMPDIR on every call, so pointing it at a scratch folder keeps these tests out of
// the real temp folder.
const realTmp = tmpdir()
const ambientTmpdir = process.env.TMPDIR
let scratch: string

beforeAll(() => {
  scratch = mkdtempSync(join(realTmp, 'acorn-tool-output-test-'))
  process.env.TMPDIR = scratch
})
afterEach(() => rmSync(join(scratch, 'acorn-tool-output'), { recursive: true, force: true }))
afterAll(() => {
  if (ambientTmpdir === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = ambientTmpdir
  rmSync(scratch, { recursive: true, force: true })
})

const BIG = 'x'.repeat(40 * 1024)

describe('capToolText', () => {
  it('returns a text that fits unchanged and saves nothing', () => {
    expect(capToolText('small', 't1', 'c1')).toBe('small')
    expect(existsSync(toolOutputDir('t1'))).toBe(false)
  })

  it('cuts a text with no line breaks between characters, never inside one', () => {
    // Three-byte characters after one ASCII byte, so neither cut point falls between characters.
    const text = `a${'€'.repeat(20_000)}`
    const [head, rest] = capToolText(text, 't1', 'wide').split('\n[acorn cut this result: ')
    const tail = rest!.split(']\n')[1]
    expect(head).toBe(`a${'€'.repeat(8191)}`)
    expect(tail).toBe('€'.repeat(2730))
    expect(readFileSync(join(toolOutputDir('t1'), 'wide.txt'), 'utf8')).toBe(text)
  })

  it('saves nothing when the root is a link, which another user could plant in a shared temp folder', () => {
    const elsewhere = mkdtempSync(join(scratch, 'elsewhere-'))
    symlinkSync(elsewhere, join(scratch, 'acorn-tool-output'))
    expect(capToolText(BIG, 't1', 'c1')).toContain('The full text could not be saved')
    expect(existsSync(join(elsewhere, 't1'))).toBe(false)
  })

  it('saves nothing when other users can open the root', () => {
    mkdirSync(join(scratch, 'acorn-tool-output'), { mode: 0o755 })
    expect(capToolText(BIG, 't1', 'c1')).toContain('must be a folder only this user can open')
    expect(existsSync(toolOutputDir('t1'))).toBe(false)
  })

  it('saves nothing when the task folder is a link', () => {
    const elsewhere = mkdtempSync(join(scratch, 'elsewhere-'))
    mkdirSync(join(scratch, 'acorn-tool-output'), { mode: 0o700 })
    symlinkSync(elsewhere, toolOutputDir('t1'))
    expect(capToolText(BIG, 't1', 'c1')).toContain('The full text could not be saved')
    expect(existsSync(join(elsewhere, 'c1.txt'))).toBe(false)
  })
})

describe('sweepToolOutput', () => {
  it('never follows a link out of the root', async () => {
    const outside = mkdtempSync(join(scratch, 'outside-'))
    const precious = join(outside, 'precious.txt')
    writeFileSync(precious, 'keep me')
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    utimesSync(precious, eightDaysAgo, eightDaysAgo)
    mkdirSync(join(scratch, 'acorn-tool-output'), { mode: 0o700 })
    symlinkSync(outside, toolOutputDir('linked'))
    await sweepToolOutput()
    expect(existsSync(precious)).toBe(true)
  })
})
