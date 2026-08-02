import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contentLinkRegistry, linearContentLinkContribution, parseInAppTarget, splitLinearIds } from './contentLinks'

let dispose: (() => void) | undefined
beforeAll(() => {
  const registered = contentLinkRegistry.register(linearContentLinkContribution)
  dispose = () => registered.dispose()
})
afterAll(() => dispose?.())

describe('parseInAppTarget', () => {
  it('recognises Linear issue links', () => {
    expect(parseInAppTarget('https://linear.app/acme/issue/CRA-275/some-slug')).toEqual({ kind: 'linear', identifier: 'CRA-275' })
  })
  it('recognises GitHub PR links (ignoring trailing path)', () => {
    expect(parseInAppTarget('https://github.com/runn/acorn/pull/42/files')).toEqual({ kind: 'pr', owner: 'runn', repo: 'acorn', number: '42' })
  })
  it('recognises bare GitHub repo links but not deep paths or profiles', () => {
    expect(parseInAppTarget('https://github.com/runn/acorn')).toEqual({ kind: 'repo', owner: 'runn', repo: 'acorn' })
    expect(parseInAppTarget('https://github.com/runn/acorn/issues')).toBeNull()
    expect(parseInAppTarget('https://github.com/octocat')).toBeNull()
  })
  it('ignores unrelated links', () => {
    expect(parseInAppTarget('https://example.com/x')).toBeNull()
    expect(parseInAppTarget('https://github.com/orgs/runn')).toBeNull()
  })
})

describe('splitLinearIds', () => {
  it('tags only ids whose prefix is known', () => {
    expect(splitLinearIds('Closes CRA-404 (uses UTF-8)', ['CRA'])).toEqual([
      { text: 'Closes ' },
      { text: 'CRA-404', id: 'CRA-404' },
      { text: ' (uses UTF-8)' },
    ])
  })
  it('returns the whole string when no prefixes are known', () => {
    expect(splitLinearIds('Closes CRA-404', [])).toEqual([{ text: 'Closes CRA-404' }])
  })
})
