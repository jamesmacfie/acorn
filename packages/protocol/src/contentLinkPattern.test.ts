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

  it('rejects non-https, overlong patterns and too many captures without evaluating regex-like literals', () => {
    expect(() => compileContentLinkPattern('http://tracker.example/issues/{key}')).toThrow('https')
    expect(() => compileContentLinkPattern('https://tracker.example/issues/(a+)+')).not.toThrow()
    expect(() => compileContentLinkPattern(`https://tracker.example/${'x'.repeat(CONTENT_LINK_PATTERN_MAX_LENGTH)}`)).toThrow('characters')
    const captures = Array.from({ length: CONTENT_LINK_PATTERN_MAX_CAPTURES + 1 }, (_, index) => `{c${index}}`).join('/')
    expect(() => compileContentLinkPattern(`https://tracker.example/${captures}`)).toThrow('at most')
  })

  it('rejects regex metacharacters that would act as host/path wildcards', () => {
    expect(() => compileContentLinkPattern('https://tracker.*.example/issues/{key}')).toThrow('host')
    expect(() => compileContentLinkPattern('https://tracker.example/issues/*')).toThrow('literal')
  })
})
