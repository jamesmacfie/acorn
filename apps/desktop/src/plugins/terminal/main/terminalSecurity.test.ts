import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rendererBaseCheckout } from '../../../core/main/taskWorktree'

describe('terminal renderer cwd boundary', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  it('accepts only an existing absolute directory as a base-checkout candidate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acorn-terminal-cwd-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'nested'))
    expect(rendererBaseCheckout(dir)).toBe(dir)
    expect(rendererBaseCheckout('relative/repo')).toBeUndefined()
    expect(rendererBaseCheckout(join(dir, 'missing'))).toBeUndefined()
    expect(rendererBaseCheckout(undefined)).toBeUndefined()
  })
})
