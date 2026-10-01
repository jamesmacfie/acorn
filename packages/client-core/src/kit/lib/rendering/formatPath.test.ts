import { describe, expect, it } from 'vitest'
import { formatPath } from './formatPath'

describe('formatPath', () => {
  it('keeps the last two folders of a deep path', () => {
    expect(formatPath('/Users/sam/Source/acorn/apps/web')).toBe('…/apps/web')
    expect(formatPath('/srv/projects/acorn/web')).toBe('…/acorn/web')
  })

  it('writes a short path under the home folder from ~', () => {
    expect(formatPath('/Users/sam/Source/acorn')).toBe('~/Source/acorn')
    expect(formatPath('/home/sam/acorn/')).toBe('~/acorn')
    expect(formatPath('/Users/sam')).toBe('~')
  })

  it('leaves a short path outside the home folder as it is', () => {
    expect(formatPath('/srv/acorn')).toBe('/srv/acorn')
    expect(formatPath('/')).toBe('/')
  })

  it('reads a Windows path', () => {
    expect(formatPath('C:\\Users\\sam\\code\\acorn')).toBe('~\\code\\acorn')
    expect(formatPath('C:\\Users\\sam\\code\\acorn\\web')).toBe('…\\acorn\\web')
  })
})
