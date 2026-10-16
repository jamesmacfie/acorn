import { describe, expect, it } from 'vitest'
import { githubAvatarUrl } from './avatar'

describe('githubAvatarUrl', () => {
  it('builds the GitHub picture URL from a login', () => {
    expect(githubAvatarUrl('jamesmacfie')).toBe('https://github.com/jamesmacfie.png?size=36')
    expect(githubAvatarUrl('space user', 18)).toBe('https://github.com/space%20user.png?size=18')
  })

  it('has no picture without a login', () => {
    expect(githubAvatarUrl(null)).toBeUndefined()
    expect(githubAvatarUrl('  ')).toBeUndefined()
  })
})
