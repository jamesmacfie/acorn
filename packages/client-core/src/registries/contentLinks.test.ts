import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { consumePaneIntent, evictPendingIntents } from './clientEvents'
import {
  contentLinkRegistry,
  inAppPathFor,
  learnRefPrefixes,
  openContentTarget,
  openInAppUrl,
  openPluginContentTarget,
  parseInAppTarget,
  scanContentRefs,
  splitRefTokens,
} from './contentLinks'
import { paneRegistry } from './panes'
import { activeRefPanel, closeRefPanel, refPanelRegistry } from './refPanels'
import type { Disposable } from './registry'
import { sourceRegistry } from './sources'
import { setTaskLookup } from '../tasks/taskLookup'
import { selectedSource, setSelectedSource } from '../tasks/tasks'
import type { Task } from '../queries'

// A target's pane has to be registered (registries/contentLinks.ts § openPluginContentTarget), so the
// suite registers one before asserting on it.
let pane: Disposable
beforeEach(() => {
  pane = paneRegistry.register({ id: 'board', label: 'Board', glyph: 'kanban', order: 500, component: () => null })
})

afterEach(() => {
  pane.dispose()
  evictPendingIntents('task-1')
  closeRefPanel()
})

describe('declarative content-link resolution', () => {
  it('opens the declared pane and retains the captured item as its selection', () => {
    expect(openPluginContentTarget({ kind: 'board.card', pane: 'board', item: 'ENG-42' }, 'task-1')).toBe(true)
    expect(consumePaneIntent('task-1', 'board')).toEqual({ kind: 'plugin:select', item: 'ENG-42' })
  })

  it('leaves malformed or taskless targets for the browser', () => {
    expect(openPluginContentTarget({ kind: 'board.card', pane: 'board' }, 'task-1')).toBe(false)
    expect(openPluginContentTarget({ kind: 'board.card', pane: 'board', item: 'ENG-42' }, null)).toBe(false)
  })

  it('leaves a target naming something that is not a task pane for the browser', () => {
    // A surface that is not in the pane registry: not installed here, refused by this device, or
    // project-scoped and therefore living in the project-surface registry instead.
    expect(openPluginContentTarget({ kind: 'board.card', pane: 'board-card', item: 'ENG-42' }, 'task-1')).toBe(false)
    expect(consumePaneIntent('task-1', 'board-card')).toBeUndefined()
  })
})

describe('the provider stamp on a parsed target', () => {
  // `providerId` decides which plugin's reference panel a link opens, so it is the registry's to
  // write and never the recogniser's (registries/contentLinks.ts § claimFor).
  it('stamps the contributing plugin, overwriting whatever the recogniser claimed', () => {
    const board = contentLinkRegistry.register({
      id: 'board.card',
      providerId: 'board',
      // A recogniser trying to pass itself off as linear.
      parse: () => ({ kind: 'board.card', providerId: 'linear', item: 'ENG-42' }),
    })

    expect(parseInAppTarget('https://board.example/c/1')).toEqual({ kind: 'board.card', providerId: 'board', item: 'ENG-42' })
    board.dispose()
  })

  it('strips a claim from a recogniser that declared no provider at all', () => {
    const anon = contentLinkRegistry.register({ id: 'anon.card', parse: () => ({ kind: 'anon.card', providerId: 'linear', item: 'ENG-42' }) })

    expect(parseInAppTarget('https://anon.example/c/1')?.providerId).toBeUndefined()
    anon.dispose()
  })
})

describe('scanning text for every provider at once', () => {
  // Two providers registered together, because the whole point of the scanner is that a surface asks
  // one question and gets everyone's answer, the thing github's `scanLinearRefs` import could never
  // do.
  let board: Disposable
  let tickets: Disposable
  beforeEach(() => {
    board = contentLinkRegistry.register({
      id: 'board.card',
      providerId: 'board',
      parse: (href) => {
        const match = /^https:\/\/board\.example\/c\/([A-Z]+-\d+)(?:\/[^/]+)?$/.exec(href)
        return match ? { kind: 'board.card', item: match[1] } : null
      },
    })
    tickets = contentLinkRegistry.register({
      id: 'ticket.issue',
      providerId: 'tickets',
      parse: (href) => {
        const match = /^https:\/\/tickets\.example\/i\/([A-Z]+-\d+)$/.exec(href)
        return match ? { kind: 'ticket.issue', item: match[1] } : null
      },
    })
  })
  afterEach(() => {
    board.dispose()
    tickets.dispose()
  })

  it('extracts both providers from one body and stamps each with its own', () => {
    const refs = scanContentRefs([
      'Fixes https://board.example/c/ENG-1 and https://tickets.example/i/OPS-9.',
      null,
      'Also see <a href="https://board.example/c/ENG-2">ENG-2</a>.',
    ])

    expect(refs).toEqual([
      { providerId: 'board', kind: 'board.card', item: 'ENG-1', url: 'https://board.example/c/ENG-1' },
      // The trailing full stop is prose, not URL.
      { providerId: 'tickets', kind: 'ticket.issue', item: 'OPS-9', url: 'https://tickets.example/i/OPS-9' },
      { providerId: 'board', kind: 'board.card', item: 'ENG-2', url: 'https://board.example/c/ENG-2' },
    ])
  })

  it('dedupes by what is referenced, not by URL, and keeps the first one seen', () => {
    // The two-entries-for-one-shape problem the exact-arity grammar creates: linear's issue and
    // issue-with-title-slug URLs are different strings naming the same ticket.
    const refs = scanContentRefs(['https://board.example/c/ENG-1', 'again: https://board.example/c/ENG-1/some-title'])

    expect(refs).toEqual([{ providerId: 'board', kind: 'board.card', item: 'ENG-1', url: 'https://board.example/c/ENG-1' }])
  })

  it('ignores near-misses, plain prose and URLs no recogniser claims', () => {
    expect(scanContentRefs([
      'ENG-1 on its own is not a URL',                    // bare id — task 03's problem, not this one
      'http://board.example/c/ENG-1',                     // http: refused by the grammar at compile time
      'https://board.example/card/ENG-1',                 // wrong path
      'https://unrelated.example/c/ENG-1',                // nobody claims it
      'https://board.example/c/eng-1',                    // wrong case
    ])).toEqual([])
  })

  it('leaves a claim that captured no item out, because it references nothing', () => {
    // github's `repo` target is exactly this: a real click destination with no identifier to enrich.
    const anon = contentLinkRegistry.register({ id: 'anon.repo', parse: () => ({ kind: 'repo', owner: 'runn' }) })

    expect(scanContentRefs(['https://anon.example/runn'])).toEqual([])
    anon.dispose()
  })
})

describe('bare tokens licensed by a prefix witnessed in the same surface', () => {
  const ref = (providerId: string | undefined, item: string) => ({ providerId, kind: 'x', item, url: `https://x/${item}` })

  it('licenses a bare id whose prefix arrived on a confirmed URL ref', () => {
    const prefixes = learnRefPrefixes([ref('board', 'ENG-1')])

    expect(splitRefTokens('Closes ENG-404 (uses UTF-8)', prefixes)).toEqual([
      { text: 'Closes ' },
      { text: 'ENG-404', ref: { providerId: 'board', item: 'ENG-404' } },
      // `UTF-8` is the near-miss that matters: an unlearned prefix, in a body full of learned ones.
      { text: ' (uses UTF-8)' },
    ])
  })

  it('leaves everything plain when nothing was witnessed', () => {
    // The cold-start case (registries/contentLinks.ts § "Bare tokens"): with no confirmed ref in the
    // surface, `ENG-404` is a token no provider has claimed, so it stays text.
    expect(splitRefTokens('Closes ENG-404', learnRefPrefixes([]))).toEqual([{ text: 'Closes ENG-404' }])
  })

  it('attributes two providers’ prefixes separately, first witness winning a contested one', () => {
    const prefixes = learnRefPrefixes([ref('board', 'ENG-1'), ref('tickets', 'OPS-2'), ref('tickets', 'ENG-9')])

    expect(prefixes).toEqual(new Map([['ENG', 'board'], ['OPS', 'tickets']]))
    expect(splitRefTokens('ENG-404 and OPS-7', prefixes)).toEqual([
      { text: 'ENG-404', ref: { providerId: 'board', item: 'ENG-404' } },
      { text: ' and ' },
      { text: 'OPS-7', ref: { providerId: 'tickets', item: 'OPS-7' } },
    ])
  })

  it('learns nothing from a ref with no provider or the wrong shape', () => {
    // A recogniser with no panel of its own (github's) licenses nothing, because there is no provider to
    // attribute a bare token to; and a captured item that is not `PREFIX-NUMBER` is not a prefix at all.
    expect(learnRefPrefixes([ref(undefined, 'ENG-1'), ref('board', 'some-slug'), ref('board', 'eng-1')])).toEqual(new Map())
  })
})

describe('the host ladder', () => {
  let panel: Disposable
  beforeEach(() => {
    panel = refPanelRegistry.register({ id: 'board-ref', providerId: 'board', component: () => null })
  })
  afterEach(() => panel.dispose())

  const target = { kind: 'board.card', providerId: 'board', pane: 'board', item: 'ENG-42' }

  it('prefers the pane by default, which is what a note and an agent transcript have always done', () => {
    expect(openContentTarget(target, { taskId: 'task-1' })).toBe('pane')
    expect(consumePaneIntent('task-1', 'board')).toEqual({ kind: 'plugin:select', item: 'ENG-42' })
    expect(activeRefPanel()).toBeNull()
  })

  it('falls to the reference panel when there is no task to open a pane in', () => {
    // Classic browse and a rail source have no task. Before the panel rung this was the end of the ladder.
    expect(openContentTarget(target, { taskId: null })).toBe('refPanel')
    expect(activeRefPanel()).toEqual({ providerId: 'board', displayId: 'ENG-42' })
  })

  it('prefers the reference panel when the clicking surface asks for it, task or no task', () => {
    expect(openContentTarget(target, { taskId: 'task-1', prefer: 'refPanel' })).toBe('refPanel')
    expect(activeRefPanel()).toEqual({ providerId: 'board', displayId: 'ENG-42' })
    expect(consumePaneIntent('task-1', 'board')).toBeUndefined()
  })

  it('falls back to the pane when the preferred panel is not installed here', () => {
    panel.dispose()
    expect(openContentTarget(target, { taskId: 'task-1', prefer: 'refPanel' })).toBe('pane')
    expect(consumePaneIntent('task-1', 'board')).toEqual({ kind: 'plugin:select', item: 'ENG-42' })
    // Re-registered so the shared afterEach dispose stays valid.
    panel = refPanelRegistry.register({ id: 'board-ref', providerId: 'board', component: () => null })
  })

  it('refuses a panel for a provider this device has none for, and says so', () => {
    // The other half of the ownership check: a target may name any provider, and only a provider with
    // a registered panel gets one. A panel may only be registered under its own plugin's name
    // (registries/plugin.ts § declaredProvider), so naming a stranger here can never produce one.
    const stranger = { kind: 'board.card', providerId: 'not-installed', item: 'ENG-42' }
    expect(openContentTarget(stranger, { taskId: 'task-1', prefer: 'refPanel' })).toBe('external')
    expect(activeRefPanel()).toBeNull()
  })

  it('falls through to the browser when the target’s plugin is stopped on this node', () => {
    // Both rungs exist on paper and neither can render: the pane's `when` is a plugin's per-node
    // presence gate, and a ref panel carries the same predicate. Before these gates the click was
    // claimed by whichever rung was asked first, `preventDefault` ran, and the reader watched nothing
    // happen.
    let running = false
    const stopped = paneRegistry.register({
      id: 'stopped', label: 'Stopped', glyph: 'kanban', order: 500,
      when: () => running, component: () => null,
    })
    const stoppedPanel = refPanelRegistry.register({
      id: 'stopped-ref', providerId: 'stopped-plugin', when: () => running, component: () => null,
    })
    setTaskLookup(() => ({ id: 'task-1' }) as Task)
    const target = { kind: 'x', providerId: 'stopped-plugin', pane: 'stopped', item: 'ENG-42' }

    expect(openContentTarget(target, { taskId: 'task-1' })).toBe('external')
    expect(openContentTarget(target, { taskId: 'task-1', prefer: 'refPanel' })).toBe('external')
    expect(consumePaneIntent('task-1', 'stopped')).toBeUndefined()
    expect(activeRefPanel()).toBeNull()

    // Started, and both rungs are destinations again. The gate is presence, not a permanent refusal.
    running = true
    expect(openContentTarget(target, { taskId: 'task-1' })).toBe('pane')
    expect(consumePaneIntent('task-1', 'stopped')).toEqual({ kind: 'plugin:select', item: 'ENG-42' })

    setTaskLookup(() => undefined)
    stoppedPanel.dispose()
    stopped.dispose()
  })

  // The third destination (docs/plugins.md § "Loaded plugins: the client half"): a target whose
  // plugin has a project-scoped route rather than a pane or a panel. The null case has to keep
  // working, since an untracked repo must still leave for the browser.
  it('resolves a route for a target whose plugin declares one, and null for one it cannot place', () => {
    const tracked = contentLinkRegistry.register({
      id: 'test.pull-request',
      parse: (href) => {
        const match = /^https:\/\/example\.com\/([^/]+)\/pull\/(\d+)/.exec(href)
        return match ? { kind: 'pr', repo: match[1], number: match[2] } : null
      },
      path: (target) => (target.repo === 'known' ? `/p/project-1/pulls/${String(target.number)}` : null),
    })

    expect(inAppPathFor('https://example.com/known/pull/9')).toBe('/p/project-1/pulls/9')
    expect(inAppPathFor('https://example.com/stranger/pull/9')).toBeNull()
    // Claimed by a recogniser that declares no route at all, and an href nobody claims.
    expect(inAppPathFor('https://example.com/nope')).toBeNull()

    tracked.dispose()
  })

  // The regression this suite exists for. `openInAppUrl` first asked only about `path`, one
  // provider's rung, so a provider that had shipped a reference panel instead still lost every click
  // to the browser. Each case below is a provider declaring a different one of the three
  // destinations, and none of them knows about the others.
  describe('openInAppUrl', () => {
    // The ranking: a provider that declared all three destinations, clicked from two surfaces that
    // want different things, which is the whole argument for `prefer` existing. The route used to be
    // tried first unconditionally, so a reader mid-review clicking a link got pulled out from under
    // them, and a dashboard row asking to go somewhere got a glance panel instead.
    it('honours the surface’s preference over every other rung', () => {
      const panel = refPanelRegistry.register({ id: 'triple-ref', providerId: 'triple', component: () => null })
      const source = sourceRegistry.register({
        id: 'triple-source', order: 10, label: 'Triple', glyph: 'circle', component: () => null,
        routes: [{ id: 'triple.detail', path: '/p/:projectId/triple/:item', order: 10 }],
      })
      const claimed = contentLinkRegistry.register({
        id: 'test.triple',
        providerId: 'triple',
        parse: (href) => (href === 'https://example.com/t/ENG-1' ? { kind: 'issue', item: 'ENG-1', pane: 'board' } : null),
        path: () => '/p/project-1/triple/ENG-1',
      })
      const navigated: string[] = []
      const navigate = (to: string) => void navigated.push(to)

      // A dashboard row: take me there.
      expect(openInAppUrl('https://example.com/t/ENG-1', { taskId: 'task-1', prefer: 'route', navigate })).toBe(true)
      expect(navigated).toEqual(['/p/project-1/triple/ENG-1'])
      expect(activeRefPanel()).toBeNull()
      expect(consumePaneIntent('task-1', 'board')).toBeUndefined()

      // A reader inside a panel: let me glance, and do not move me.
      expect(openInAppUrl('https://example.com/t/ENG-1', { taskId: 'task-1', prefer: 'refPanel', navigate })).toBe(true)
      expect(activeRefPanel()).toEqual({ providerId: 'triple', displayId: 'ENG-1' })
      expect(navigated).toHaveLength(1)

      // Nobody asked: the historical order, pane first, and the route is not taken.
      closeRefPanel()
      expect(openInAppUrl('https://example.com/t/ENG-1', { taskId: 'task-1', navigate })).toBe(true)
      expect(consumePaneIntent('task-1', 'board')).toEqual({ kind: 'plugin:select', item: 'ENG-1' })
      expect(navigated).toHaveLength(1)

      claimed.dispose()
      source.dispose()
      panel.dispose()
      setSelectedSource(null)
    })

    // A preference is a preference, not a demand. Every rung can be unavailable, and the fallback order
    // is what stops a surface having to know which of the three a provider actually installed.
    it('falls to the next rung when the preferred one is unavailable', () => {
      const claimed = contentLinkRegistry.register({
        id: 'test.route-only',
        parse: (href) => (href === 'https://example.com/r-only' ? { kind: 'issue' } : null),
        path: () => '/p/project-1/pulls/9',
      })

      // Asked for the panel; the provider has none and no pane, so the route takes it.
      const navigated: string[] = []
      expect(openInAppUrl('https://example.com/r-only', { prefer: 'refPanel', navigate: (to) => void navigated.push(to) })).toBe(true)
      expect(navigated).toEqual(['/p/project-1/pulls/9'])

      // Asked for the route with no navigator in scope: that rung is unreachable, and with nothing else
      // declared the caller is told to open the browser.
      expect(openInAppUrl('https://example.com/r-only', { prefer: 'route' })).toBe(false)

      claimed.dispose()
      setSelectedSource(null)
    })

    it('takes the route when the provider declared one', () => {
      const navigated: string[] = []
      const routed = contentLinkRegistry.register({
        id: 'test.routed',
        parse: (href) => (href === 'https://example.com/r' ? { kind: 'routed' } : null),
        path: () => '/p/project-1/pulls/9',
      })

      expect(openInAppUrl('https://example.com/r', { navigate: (to) => navigated.push(to) })).toBe(true)
      expect(navigated).toEqual(['/p/project-1/pulls/9'])
      // No navigator in scope. The route is unreachable, so it is not a destination and the caller
      // must still be told to open the browser.
      expect(openInAppUrl('https://example.com/r')).toBe(false)

      routed.dispose()
    })

    // Navigating is only half of arriving (docs/dashboards.md § "Taking a route also selects the rail
    // source that owns it"): the shell draws from the rail selection, not the location, so a route
    // taken while another source is selected moves the URL and leaves the previous surface on screen.
    // That is exactly how this shipped once, as a click that did nothing at all.
    it('selects the rail source that owns the route before navigating', () => {
      setSelectedSource('home')
      const source = sourceRegistry.register({
        id: 'pulls-source', order: 10, label: 'Pulls', glyph: 'git-pull-request', component: () => null,
        routes: [{ id: 'pulls.detail', path: '/p/:projectId/pulls/:number', order: 10 }],
      })
      const routed = contentLinkRegistry.register({
        id: 'test.routed-source',
        parse: (href) => (href === 'https://example.com/s' ? { kind: 'routed' } : null),
        path: () => '/p/project-1/pulls/9',
      })

      expect(openInAppUrl('https://example.com/s', { navigate: () => {} })).toBe(true)
      expect(selectedSource()).toBe('pulls-source')

      routed.dispose()
      source.dispose()
      setSelectedSource(null)
    })

    it('leaves the rail alone for a path no source claims', () => {
      setSelectedSource('home')
      const routed = contentLinkRegistry.register({
        id: 'test.routed-core',
        parse: (href) => (href === 'https://example.com/c' ? { kind: 'routed' } : null),
        // A core route. Core's own paths are not rail sources, and hijacking the rail for one would be
        // a worse bug than the one this branch fixes.
        path: () => '/settings/projects',
      })

      expect(openInAppUrl('https://example.com/c', { navigate: () => {} })).toBe(true)
      expect(selectedSource()).toBe('home')

      routed.dispose()
      setSelectedSource(null)
    })

    it('falls to the provider’s reference panel when it declared a panel and no route', () => {
      const panel = refPanelRegistry.register({ id: 'panelled-ref', providerId: 'panelled', component: () => null })
      const claimed = contentLinkRegistry.register({
        id: 'test.panelled',
        providerId: 'panelled',
        parse: (href) => (href === 'https://example.com/i/ENG-1' ? { kind: 'issue', item: 'ENG-1' } : null),
      })

      // A navigator is present and irrelevant: there is no route to take, and the panel needs neither
      // it nor a task. This is the case a dashboard row for a Linear ticket hits.
      expect(openInAppUrl('https://example.com/i/ENG-1', { prefer: 'refPanel', navigate: () => {} })).toBe(true)
      expect(activeRefPanel()).toEqual({ providerId: 'panelled', displayId: 'ENG-1' })

      claimed.dispose()
      panel.dispose()
    })

    it('leaves a URL with no in-app destination to the browser', () => {
      // Recognised, and nowhere to put it: no route, no panel registered for the provider, no task for
      // a pane. A false here is what keeps the real URL opening.
      const orphan = contentLinkRegistry.register({
        id: 'test.orphan',
        providerId: 'nobody',
        parse: (href) => (href === 'https://example.com/o' ? { kind: 'issue', item: 'X-1' } : null),
      })

      expect(openInAppUrl('https://example.com/o', { prefer: 'refPanel', navigate: () => {} })).toBe(false)
      expect(openInAppUrl('https://example.com/unclaimed')).toBe(false)
      expect(activeRefPanel()).toBeNull()

      orphan.dispose()
    })
  })

  it('reports external when neither rung can take the target', () => {
    // The deliberate browser fall-through: a named outcome rather than a boolean
    // (registries/contentLinks.ts § ContentLinkOutcome), because the boolean it replaced is how
    // `preventDefault` reached branches that had not handled anything.
    expect(openContentTarget({ kind: 'github.pull-request', owner: 'runn', repo: 'acorn' }, { taskId: 'task-1' })).toBe('external')
    expect(activeRefPanel()).toBeNull()
  })
})
