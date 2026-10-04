import { describe, expect, it } from 'vitest'
import { parseLocalWorktrees } from './localGitSources'

describe('local Git worktree roster', () => {
  it('keeps managed and unmanaged trees and detached heads', () => {
    const roster = 'worktree /checkout\0HEAD aaaa\0branch refs/heads/main\0\0'
      + 'worktree /extra\0HEAD bbbb\0branch refs/heads/topic\0\0'
      + 'worktree /detached\0HEAD cccc\0detached\0\0'
      + 'worktree /stale\0HEAD dddd\0prunable gitdir missing\0\0'
    expect(parseLocalWorktrees(roster)).toEqual([
      { path: '/checkout', branch: 'main', head: 'aaaa' },
      { path: '/extra', branch: 'topic', head: 'bbbb' },
      { path: '/detached', branch: null, head: 'cccc' },
    ])
  })
})
