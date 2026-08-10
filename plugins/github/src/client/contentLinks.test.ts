import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { contentLinkRegistry, parseInAppTarget } from '@acorn/client-core/registries/contentLinks.ts'
import { activeRefPanel, closeRefPanel, refPanelRegistry } from '@acorn/client-core/registries/refPanels.ts'
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

// One click, with the three fields the handler actually reads. `dataset` carries the bare-id anchors this
// file mints out of GitHub's body HTML; `href` is the real-URL path.
const click = (anchor: { getAttribute?: (name: string) => string | null; dataset: Record<string, string> }) => {
  const preventDefault = vi.fn()
  return {
    preventDefault,
    event: {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: { closest: () => anchor },
      preventDefault,
    } as unknown as MouseEvent,
  }
}
const hrefAnchor = (href: string) => ({ getAttribute: (name: string) => (name === 'href' ? href : null), dataset: {} })

describe('project-keyed content navigation', () => {
  it('resolves GitHub links through the project facet', () => {
    const navigate = vi.fn()
    const { event, preventDefault } = click(hrefAnchor('https://github.com/runn/acorn/pull/42'))
    const handler = makeContentLinkHandler(navigate, (owner, repo) => owner === 'runn' && repo === 'acorn' ? 'project-acorn' : null)

    handler(event)

    expect(navigate).toHaveBeenCalledWith('/p/project-acorn/pulls/42')
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('leaves a PR in an untracked repo to the real browser URL', () => {
    // A DELIBERATE PRODUCT DECISION (see the comment on the branch itself), pinned so a later refactor
    // cannot quietly turn it into a swallowed click with nowhere to land.
    const navigate = vi.fn()
    const { event, preventDefault } = click(hrefAnchor('https://github.com/someone/untracked/pull/7'))

    makeContentLinkHandler(navigate, () => null)(event)

    expect(navigate).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

describe('bare Linear ids', () => {
  // github injects these anchors itself (linkifyLinearIds), so no recogniser can claim them and the host's
  // URL ladder never sees them. They go straight to the provider's reference panel.
  afterEach(() => closeRefPanel())

  it('opens the provider reference panel when that provider has one registered', () => {
    const panel = refPanelRegistry.register({ id: 'linear-ref', providerId: 'linear', component: () => null })
    const { event, preventDefault } = click({ dataset: { linearId: 'CRA-404' } })

    makeContentLinkHandler(vi.fn())(event)

    expect(activeRefPanel()).toEqual({ providerId: 'linear', displayId: 'CRA-404' })
    expect(preventDefault).toHaveBeenCalledOnce()
    panel.dispose()
  })

  it('opens nothing when Linear is not installed on this device', () => {
    // The anchor has no href, so there is nothing to fall through TO — the click is still consumed, and the
    // shell must not be left showing an overlay no contribution can fill.
    const { event, preventDefault } = click({ dataset: { linearId: 'CRA-404' } })

    makeContentLinkHandler(vi.fn())(event)

    expect(activeRefPanel()).toBeNull()
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
