import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { contentLinkRegistry, openInAppUrl, parseInAppTarget } from '@acorn/client-core/registries/contentLinks.ts'
import { type Project, setProjectsLookup } from '@acorn/plugin-api/testkit/client'
import { activeRefPanel, closeRefPanel, refPanelRegistry } from '@acorn/client-core/registries/refPanels.ts'
import { githubContentLinkContributions, makeContentLinkHandler } from './contentLinks'

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
    // `item` and `providerId` are what make the reference panel reachable: the host looks a panel up by
    // provider and hands it `item` as the subject. The spelling matches the pulls collection's row id.
    expect(parseInAppTarget('https://github.com/runn/acorn/pull/42/files'))
      .toEqual({ kind: 'pr', providerId: 'github', owner: 'runn', repo: 'acorn', number: '42', item: 'runn/acorn#42' })
  })
  it('recognises bare GitHub repo links but not deep paths or profiles', () => {
    // No provider on this one, and it is not an oversight: a repository is a LIST, its destination is the
    // browse route, and there is nothing glance-sized to put in an overlay.
    expect(parseInAppTarget('https://github.com/runn/acorn')).toEqual({ kind: 'repo', providerId: undefined, owner: 'runn', repo: 'acorn' })
    expect(parseInAppTarget('https://github.com/runn/acorn/issues')).toBeNull()
    expect(parseInAppTarget('https://github.com/octocat')).toBeNull()
  })
  it('ignores unrelated links', () => {
    expect(parseInAppTarget('https://example.com/x')).toBeNull()
    expect(parseInAppTarget('https://github.com/orgs/runn')).toBeNull()
  })
})

// One click, with the three fields the handler actually reads. `dataset` carries the bare-id anchors the
// host mints out of GitHub's body HTML; `href` is the real-URL path.
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

// A project row as the client sees it. Only the GitHub facet is read by anything under test.
const project = (id: string, owner: string, name: string) => ({ id, github: { owner, name } }) as unknown as Project

// These used to hand the handler a STUB resolver, which is why the casing bug below survived them: the
// stub compared the two names the test had just written, so it agreed with itself no matter what the
// real lookup did. They go through `allProjects` now, like the code does.
describe('project-keyed content navigation', () => {
  afterEach(() => setProjectsLookup(() => []))

  it('resolves GitHub links through the project facet', () => {
    setProjectsLookup(() => [project('project-acorn', 'runn', 'acorn')])
    const navigate = vi.fn()
    const { event, preventDefault } = click(hrefAnchor('https://github.com/runn/acorn/pull/42'))

    makeContentLinkHandler(navigate)(event)

    expect(navigate).toHaveBeenCalledWith('/p/project-acorn/pulls/42')
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('leaves a PR in an untracked repo to the real browser URL', () => {
    // A DELIBERATE PRODUCT DECISION (see the comment on the branch itself), pinned so a later refactor
    // cannot quietly turn it into a swallowed click with nowhere to land.
    const navigate = vi.fn()
    const { event, preventDefault } = click(hrefAnchor('https://github.com/someone/untracked/pull/7'))

    makeContentLinkHandler(navigate)(event)

    expect(navigate).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

describe('bare ref anchors reaching the panel through github’s handler', () => {
  // The HOST mints these now (client-core § linkifyRefs), and owns both the split and the click rung —
  // its own suite covers prefix learning and attribution. What is worth pinning HERE is that github's
  // handler still lets them through: it wraps `handlePluginContentLinkClick` rather than reimplementing
  // it, and a wrapper that reordered its two branches would break this without breaking anything else.
  afterEach(() => closeRefPanel())

  it('opens the provider reference panel when that provider has one registered', () => {
    const panel = refPanelRegistry.register({ id: 'linear-ref', providerId: 'linear', component: () => null })
    const { event, preventDefault } = click({ dataset: { refProvider: 'linear', refItem: 'CRA-404' } })

    makeContentLinkHandler(vi.fn())(event)

    expect(activeRefPanel()).toEqual({ providerId: 'linear', displayId: 'CRA-404' })
    expect(preventDefault).toHaveBeenCalledOnce()
    panel.dispose()
  })

  it('opens nothing when that provider is not installed on this device', () => {
    // The anchor has no href, so there is nothing to fall through TO — the click is still consumed, and the
    // shell must not be left showing an overlay no contribution can fill.
    const { event, preventDefault } = click({ dataset: { refProvider: 'linear', refItem: 'CRA-404' } })

    makeContentLinkHandler(vi.fn())(event)

    expect(activeRefPanel()).toBeNull()
    expect(preventDefault).toHaveBeenCalledOnce()
  })
})

// The dashboard-row path, end to end through github's OWN registered contribution rather than a stand-in.
// The host asks `openInAppUrl` before it opens a browser, and everything github contributes to that
// answer is the `path` resolver below: a project lookup, and the route minted from the pattern.
describe('openInAppUrl over github rows', () => {
  afterEach(() => setProjectsLookup(() => []))

  it('routes a PR on a tracked repo to github’s own view', () => {
    setProjectsLookup(() => [project('proj-1', 'runn', 'acorn')])
    const navigate = vi.fn()

    expect(openInAppUrl('https://github.com/runn/acorn/pull/42', { navigate })).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/p/proj-1/pulls/42')
  })

  it('routes a bare repo URL to the browse list', () => {
    setProjectsLookup(() => [project('proj-1', 'runn', 'acorn')])
    const navigate = vi.fn()

    expect(openInAppUrl('https://github.com/runn/acorn', { navigate })).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/p/proj-1/pulls')
  })

  // THE PAIRING, in one test. A dashboard row asks to go there and gets github's surface; a reader inside
  // something else asks to glance and gets github's panel. Same URL, same recogniser, different caller —
  // which is the whole reason `prefer` exists rather than the target deciding.
  it('gives a dashboard the pull request surface and a reader the panel', () => {
    setProjectsLookup(() => [project('proj-1', 'runn', 'acorn')])
    const panel = refPanelRegistry.register({ id: 'github-pull', providerId: 'github', component: () => null })
    const navigate = vi.fn()
    const url = 'https://github.com/runn/acorn/pull/42'

    expect(openInAppUrl(url, { prefer: 'route', navigate })).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/p/proj-1/pulls/42')
    expect(activeRefPanel()).toBeNull()

    expect(openInAppUrl(url, { prefer: 'refPanel', navigate })).toBe(true)
    expect(activeRefPanel()).toEqual({ providerId: 'github', displayId: 'runn/acorn#42' })
    expect(navigate).toHaveBeenCalledTimes(1)

    closeRefPanel()
    panel.dispose()
  })

  // The panel is a preference, not a guarantee, and an untracked repo has no route either. Both rungs
  // gone means the real github.com URL still opens — the fall-through this plugin has always protected.
  it('leaves a repo this install does not track to the browser', () => {
    // The deliberate fall-through, now on a second caller. github declares no `providerId` and so has no
    // reference panel either, which is why there is nothing else for this to land on.
    const navigate = vi.fn()

    expect(openInAppUrl('https://github.com/stranger/thing/pull/42', { navigate })).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  // THE REAL-DATA CASE, and the one every test above was too tidy to catch. These are not invented
  // spellings: `projects.github_owner` holds `runn-fast` while the plugin's own `repos.owner` — and so
  // the URL on every row — holds GitHub's canonical `Runn-Fast`. An `===` between them matched nothing,
  // and because an unmatched repo legitimately falls through to the browser, the failure was invisible.
  it('matches owner and repo case-insensitively, as GitHub does', () => {
    setProjectsLookup(() => [project('proj-runn', 'runn-fast', 'runn')])
    const navigate = vi.fn()

    expect(openInAppUrl('https://github.com/Runn-Fast/runn/pull/8811', { navigate })).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/p/proj-runn/pulls/8811')
  })
})
