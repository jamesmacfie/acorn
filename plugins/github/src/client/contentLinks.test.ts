import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { contentLinkRegistry, parseInAppTarget } from '@acorn/client-core/registries/contentLinks.ts'
import { githubContentLinkContributions, makeContentLinkHandler, splitLinearIds } from './contentLinks'

// Only github's own recognisers are asserted here. Linear's moved to plugins/linear with the
// contribution itself — a github test importing linear's client would be a plugin->plugin edge
// outside contract/, which the arch suite refuses, and rightly: that coupling is the thing finding 10
// is removing.
let dispose: (() => void)[] = []
beforeAll(() => {
  dispose = githubContentLinkContributions.map((c) => contentLinkRegistry.register(c).dispose)
})
afterAll(() => dispose.forEach((d) => d()))

describe('parseInAppTarget', () => {
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

describe('project-keyed content navigation', () => {
  it('resolves GitHub links through the project facet', () => {
    const navigate = vi.fn()
    const preventDefault = vi.fn()
    const anchor = {
      getAttribute: (name: string) => name === 'href' ? 'https://github.com/runn/acorn/pull/42' : null,
      dataset: {},
    }
    const handler = makeContentLinkHandler(navigate, vi.fn(), (owner, repo) => owner === 'runn' && repo === 'acorn' ? 'project-acorn' : null)

    handler({
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: { closest: () => anchor },
      preventDefault,
    } as unknown as MouseEvent)

    expect(navigate).toHaveBeenCalledWith('/p/project-acorn/pulls/42')
    expect(preventDefault).toHaveBeenCalledOnce()
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
