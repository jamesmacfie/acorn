import { describe, expect, it } from 'vitest'
import { git, gitOrThrow } from './git'

describe('Git process seam', () => {
  it('runs Git reads when the selected Xcode Git is license-blocked', async () => {
    const cwd = process.cwd()
    const version = await git(['--version'], { cwd })
    expect(version.code).toBe(0)
    expect(version.stdout).toMatch(/^git version /)
    expect((await gitOrThrow(['rev-parse', '--is-inside-work-tree'], { cwd })).stdout.trim()).toBe('true')
  })
})
