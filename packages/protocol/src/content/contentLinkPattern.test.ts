import { describe, expect, it } from 'vitest'
import {
  compileContentLinkPattern,
  CONTENT_LINK_PATTERN_MAX_CAPTURES,
  CONTENT_LINK_PATTERN_MAX_LENGTH,
} from './contentLinkPattern'

describe('content-link patterns', () => {
  it('matches a wildcard host and named single-segment capture', () => {
    const pattern = compileContentLinkPattern('https://*.atlassian.net/browse/{key}')
    expect(pattern.match('https://acme.atlassian.net/browse/ENG-42')).toEqual({ key: 'ENG-42' })
    expect(pattern.match('https://atlassian.net/browse/ENG-42')).toBeNull()
  })

  it('never lets a capture span a slash', () => {
    const pattern = compileContentLinkPattern('https://tracker.example/issues/{key}')
    expect(pattern.match('https://tracker.example/issues/ENG-42/comments')).toBeNull()
    expect(pattern.match('https://tracker.example/issues/ENG-42%2Fcomments')).toBeNull()
  })

  it('accepts one trailing slash and no more', () => {
    const pattern = compileContentLinkPattern('https://tracker.example/item/{id}')
    expect(pattern.match('https://tracker.example/item/42/')).toEqual({ id: '42' })
    expect(pattern.match('https://tracker.example/item/42//')).toBeNull()
  })

  it('rejects non-https, overlong patterns and too many captures without evaluating regex-like literals', () => {
    expect(() => compileContentLinkPattern('http://tracker.example/issues/{key}')).toThrow('https')
    expect(() => compileContentLinkPattern('https://tracker.example/issues/(a+)+')).not.toThrow()
    expect(() =>
      compileContentLinkPattern(`https://tracker.example/${'x'.repeat(CONTENT_LINK_PATTERN_MAX_LENGTH)}`),
    ).toThrow('characters')
    const captures = Array.from({ length: CONTENT_LINK_PATTERN_MAX_CAPTURES + 1 }, (_, index) => `{c${index}}`).join(
      '/',
    )
    expect(() => compileContentLinkPattern(`https://tracker.example/${captures}`)).toThrow('at most')
  })

  it('rejects regex metacharacters that would act as host/path wildcards', () => {
    expect(() => compileContentLinkPattern('https://tracker.*.example/issues/{key}')).toThrow('host')
    expect(() => compileContentLinkPattern('https://tracker.example/issues/*')).toThrow('literal')
  })

  it('takes one or more whole segments in a {capture+} before a literal', () => {
    const pattern = compileContentLinkPattern('https://gitlab.com/{path+}/-/merge_requests/{number}')
    expect(pattern.captures).toEqual(['path', 'number'])
    expect(pattern.match('https://gitlab.com/group/sub/api/-/merge_requests/12')).toEqual({
      path: 'group/sub/api',
      number: '12',
    })
    expect(pattern.match('https://gitlab.com/api/-/merge_requests/12')).toEqual({ path: 'api', number: '12' })
    expect(pattern.match('https://gitlab.com/-/merge_requests/12')).toBeNull()
    expect(pattern.match('https://gitlab.com/group/api/merge_requests/12')).toBeNull()
    expect(pattern.match('https://gitlab.com/group%2Fsub/api/-/merge_requests/12')).toBeNull()
    expect(pattern.match('https://gitlab.com/group/api/-/merge_requests/12/diffs')).toBeNull()
  })

  it('allows one {capture+}, only right before a literal', () => {
    expect(() => compileContentLinkPattern('https://gitlab.com/{path+}')).toThrow('before a literal')
    expect(() => compileContentLinkPattern('https://gitlab.com/{path+}/{number}')).toThrow('before a literal')
    expect(() => compileContentLinkPattern('https://gitlab.com/{a+}/-/{b+}/x')).toThrow('one {capture+}')
    expect(() => compileContentLinkPattern('https://gitlab.com/{bad name+}/-')).toThrow('invalid name')
  })
})
