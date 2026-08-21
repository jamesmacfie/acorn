import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { contentLinkRegistry, openInAppUrl, parseInAppTarget } from '@acorn/client-core/registries/contentLinks.ts'
import { type Project, setProjectsLookup } from '@acorn/plugin-api/testkit/client'
import { activeRefPanel, closeRefPanel, refPanelRegistry } from '@acorn/client-core/registries/refPanels.ts'
import { githubContentLinkContributions, makeContentLinkHandler } from './contentLinks'

// Only github's own recognisers are asserted here. Linear's recogniser moved to plugins/linear with
// its contribution; a github test importing linear's client would cross the plugin boundary the arch
// suite refuses.
let dispose: (() => void)[] = []
beforeAll(() => {
  dispose = githubContentLinkContributions.map((c) => contentLinkRegistry.register(c).dispose)
})
afterAll(() => dispose.forEach((d) => d()))

describe('parseInAppTarget', () => {
  it('recognises GitHub PR links (ignoring trailing path)', () => {
    // `item`/`providerId` make the reference panel reachable (docs/plugins.md § Frame authoring and
    // the UI kit). The spelling matches the pulls collection's row id.
    expect(parseInAppTarget('https://github.com/runn/acorn/pull/42/files'))
      .toEqual({ kind: 'pr', providerId: 'github', owner: 'runn', repo: 'acorn', number: '42', item: 'runn/acorn#42' })
  })
  it('recognises bare GitHub repo links but not deep paths or profiles', () => {
    // No provider on this one: docs/github-integration.md § Content links explains why a repo has no
    // reference panel.
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

// These tests go through `allProjects`, like the code does, instead of a stub resolver. A stub that
// echoed back the same owner/repo the test wrote would agree with itself regardless of casing, which
// is why the case-insensitivity bug below survived earlier versions of this suite.
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
    // An untracked repo has no in-app route, so the click is left unhandled rather than swallowed
    // with nowhere to land (docs/github-integration.md § Content links).
    const navigate = vi.fn()
    const { event, preventDefault } = click(hrefAnchor('https://github.com/someone/untracked/pull/7'))

    makeContentLinkHandler(navigate)(event)

    expect(navigate).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

describe('bare ref anchors reaching the panel through github’s handler', () => {
  // The host mints these anchors (client-core § linkifyRefs) and covers prefix learning and
  // attribution in its own suite. What this pins is that github's handler wraps
  // `handlePluginContentLinkClick` rather than reimplementing it, so reordering its two branches
  // would break this test too.
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
    // The anchor has no href, so there is nothing to fall through to. The click is still consumed:
    // the shell must not be left showing an overlay no contribution can fill.
    const { event, preventDefault } = click({ dataset: { refProvider: 'linear', refItem: 'CRA-404' } })

    makeContentLinkHandler(vi.fn())(event)

    expect(activeRefPanel()).toBeNull()
    expect(preventDefault).toHaveBeenCalledOnce()
  })
})

// The dashboard-row path, end to end through github's own registered contribution rather than a
// stand-in. The host asks `openInAppUrl` before it opens a browser; everything github contributes to
// that answer is the `path` resolver: a project lookup, and the route minted from the pattern.
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

  // A dashboard row asks to go there and gets github's surface; a reader inside something else asks
  // to glance and gets github's panel. Same URL, same recogniser, different caller: this is why
  // `prefer` is the caller's choice rather than the target's.
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

  // The panel is a preference, not a guarantee, and an untracked repo has no route either. With both
  // rungs gone, the real github.com URL still opens.
  it('leaves a repo this install does not track to the browser', () => {
    // A second caller of the same fall-through. github declares no `providerId` on the repo
    // recogniser, so there is no reference panel to land on either.
    const navigate = vi.fn()

    expect(openInAppUrl('https://github.com/stranger/thing/pull/42', { navigate })).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

// Real casing, not an invented spelling: docs/github-integration.md § Content links covers why the
// comparison must be case-insensitive.
  it('matches owner and repo case-insensitively, as GitHub does', () => {
    setProjectsLookup(() => [project('proj-runn', 'runn-fast', 'runn')])
    const navigate = vi.fn()

    expect(openInAppUrl('https://github.com/Runn-Fast/runn/pull/8811', { navigate })).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/p/proj-runn/pulls/8811')
  })
})
