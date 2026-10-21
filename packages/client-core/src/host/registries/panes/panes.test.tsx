import { createResource, createSignal, ErrorBoundary, lazy, onCleanup, type Component } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TelemetryRecord, TelemetrySpan } from '@acorn/protocol/telemetry.ts'
import {
  PANE_PREFETCH_HOVER_MS,
  paneAvailable,
  paneRegistry,
  schedulePanePrefetch,
  type PaneContribution,
  type PaneLayoutContribution,
} from './panes'
import type { Task } from '../../../infra/queries'
import { _resetPaneModels } from './paneModels'
import {
  _resetClientTelemetry,
  flushTelemetry,
  setTelemetryEnabled,
  startClientTelemetry,
} from '../../../infra/telemetry/emitter'
import { evictScope } from '../shell/scopeEviction'
import { _resetLayoutState } from '../../layouts/state'
import { _resetLayouts, setRegionPlaceholder } from '../../layouts/table'

// The one thing the pane registry does beyond holding entries: it turns a declared layout into the
// component every consumer already expects (docs/panes/contributions.md § Contributions).

const task = { id: 't1', projectId: 'p1' } as unknown as Task

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the registry is heterogeneous by construction
const pane = (over: Partial<PaneLayoutContribution<any>> = {}): PaneLayoutContribution<any> => ({
  id: 'notes',
  label: 'Notes',
  glyph: 'notepad-text',
  order: 30,
  layout: 'list-detail',
  regions: { list: () => <span data-region="list" />, detail: () => <span data-region="detail" /> },
  ...over,
})

let host: HTMLElement
let dispose: (() => void) | undefined
let registered: { dispose: () => void }[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
const register = (entry: PaneLayoutContribution<any>) => {
  const held = paneRegistry.register(entry)
  registered.push(held)
  return held
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  _resetLayoutState()
  _resetPaneModels()
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  for (const entry of registered) entry.dispose()
  registered = []
  _resetClientTelemetry()
  _resetLayouts()
})

const until = async (done: () => boolean) => {
  for (let tries = 0; tries < 400 && !done(); tries++) await new Promise((resolve) => setTimeout(resolve, 5))
}

describe('a pane that declares a layout', () => {
  it('draws the layout and fills its regions', async () => {
    register(pane())
    const Pane = paneRegistry.get('notes')!.component
    dispose = render(() => <Pane task={task} />, host)
    // `lazy` on the layout module, so the first paint is empty and the regions arrive once the
    // dynamic import settles. The budget is two seconds rather than a quarter of one: in a full
    // `pnpm test` a cold dynamic import competes with every other project's workers. A generous
    // ceiling on a condition poll costs nothing when it is met on the first try.
    for (let tries = 0; tries < 400 && !host.querySelector('[data-region]'); tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect([...host.querySelectorAll('[data-region]')].map((node) => node.getAttribute('data-region'))).toEqual([
      'list',
      'detail',
    ])
  })

  // At registration rather than at render: finding it when someone opens the pane means finding it in
  // front of a user.
  it('throws at registration for a missing required region', () => {
    expect(() => register(pane({ regions: { list: () => <span /> } }))).toThrow(/needs a detail region/)
    expect(paneRegistry.get('notes')).toBeUndefined()
  })

  it('throws at registration for a region the layout does not have', () => {
    expect(() =>
      register(pane({ layout: 'single', regions: { body: () => <span />, sidebar: () => <span /> } })),
    ).toThrow(/has no sidebar region/)
  })

  it('throws at registration for a layout this build does not draw', () => {
    expect(() => register(pane({ layout: 'carousel' as PaneLayoutContribution['layout'] }))).toThrow(/unknown layout/)
  })
})

// Two regions are two components the host mounts side by side, so whatever they share has to outlive
// both of them (./paneModels.ts, docs/panes/models.md § Pane models). Four compiled panes each kept their
// own root map before this seam existed.
describe('the model a pane’s regions share', () => {
  it('builds once per task and hands the same object to every region', async () => {
    let built = 0
    const seen: { id: number }[] = []
    const Region = (props: { model: { id: number } }) => {
      seen.push(props.model)
      return <span data-region="r" />
    }
    register(
      pane({
        model: () => ({ id: ++built }),
        regions: { list: Region, detail: Region },
      }),
    )
    const Pane = paneRegistry.get('notes')!.component
    dispose = render(() => <Pane task={task} />, host)
    // The layout module is behind `lazy`, so the regions arrive once the dynamic import settles. Same
    // generous poll as the test above, for the same reason.
    for (let tries = 0; tries < 400 && seen.length < 2; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(seen).toHaveLength(2)
    expect(built).toBe(1)
    expect(seen[1]).toBe(seen[0])
  })

  // The model outlives the pane, so it is told whether anyone is looking: the agent pane marks what
  // it shows as read, and doing that from a held model cleared "Needs you" on unseen sessions.
  it('tells the model whether its pane is drawing the task', async () => {
    let shown: (() => boolean) | undefined
    register(
      pane({
        model: (_task: Task, view: { shown: () => boolean }) => {
          shown = view.shown
          return {}
        },
        // Read, because the model is built when a region first asks for it.
        regions: {
          list: (props: { model: object }) => {
            void props.model
            return <span />
          },
          detail: () => <span />,
        },
      }),
    )
    const Pane = paneRegistry.get('notes')!.component
    const [open, setOpen] = createSignal(true)
    dispose = render(() => <>{open() ? <Pane task={task} /> : null}</>, host)
    for (let tries = 0; tries < 400 && !shown; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(shown?.()).toBe(true)
    setOpen(false)
    expect(shown?.()).toBe(false)
    setOpen(true)
    expect(shown?.()).toBe(true)
  })

  it('keeps the most recent tasks’ models, disposes the oldest past the limit, and disposes on eviction', async () => {
    const { DEFAULT_KEPT_TASKS, paneModel } = await import('./paneModels')
    const disposed: string[] = []
    const build = (id: string) => () => {
      onCleanup(() => disposed.push(id))
      return { id }
    }
    const t1 = paneModel('notes', 't1', build('t1'))
    expect(paneModel('notes', 't1', build('t1-again'))).toBe(t1)
    for (let n = 2; n <= DEFAULT_KEPT_TASKS; n++) paneModel('notes', `t${n}`, build(`t${n}`))
    // Going back to t1 makes it the most recent, so the next task pushes out t2 instead.
    expect(paneModel('notes', 't1', build('t1-again'))).toBe(t1)
    expect(disposed).toEqual([])
    paneModel('notes', 'next', build('next'))
    expect(disposed).toEqual(['t2'])
    evictScope({ scope: 'task', taskId: 't1' })
    expect(disposed).toEqual(['t2', 't1'])
  })
})

// A region draws under a `Suspense` of its own, and that boundary exists for one thing: a `lazy()`
// region renders as an empty string until its module lands (./panes.ts). Everything else under it
// shares the boundary, and `@tanstack/solid-query` suspends whenever `.data` is read on an empty cache.
// So a query that only starts once the region has drawn — a pull request's conflicts, the Linear issues
// found in its body — would take the whole region out of the document again for the length of its
// fetch: a rendered diff vanishes, and the virtualized scroller inside it comes back detached and at
// the top with no event to say so (docs/diff-rendering.md).
//
// Held by the solid-js patch rather than by anything here: a boundary that has drawn never swaps back
// to its fallback (patches/README.md). This is the test for it.
describe('a region that has already drawn', () => {
  it('stays in the document while a later query inside it is in flight', async () => {
    let releaseLate: () => void = () => {}
    const [lateStarted, startLate] = createSignal(false)
    register(
      pane({
        layout: 'single',
        regions: {
          body: () => {
            const [files] = createResource(async () => 'diff')
            const [late] = createResource(
              lateStarted,
              () =>
                new Promise<string>((resolve) => {
                  releaseLate = () => resolve('conflicts')
                }),
            )
            return (
              <span data-region="body">
                {files()}
                {lateStarted() ? late() : ''}
              </span>
            )
          },
        },
      }),
    )
    const Pane = paneRegistry.get('notes')!.component
    dispose = render(() => <Pane task={task} />, host)

    // Same generous poll as the tests above: the layout module is behind `lazy`.
    for (let tries = 0; tries < 400 && !host.querySelector('[data-region]'); tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(host.querySelector('[data-region]')?.textContent).toBe('diff')

    startLate(true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(host.querySelector('[data-region]')?.textContent).toBe('diff')

    releaseLate()
    for (let tries = 0; tries < 400 && host.querySelector('[data-region]')?.textContent !== 'diffconflicts'; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(host.querySelector('[data-region]')?.textContent).toBe('diffconflicts')
  })
})

// A region whose code is still loading draws the host's labelled placeholder, under its own boundary,
// so a region that is ready draws beside it (docs/ui-design/states.md § Loading).
describe('a region whose code is loading', () => {
  it('draws the host placeholder with the pane label while its neighbour draws', async () => {
    setRegionPlaceholder((props) => <span data-loading>{props.label}</span>)
    let arrive: (module: { default: Component }) => void = () => {}
    const Detail = lazy(
      () =>
        new Promise<{ default: Component }>((resolve) => {
          arrive = resolve
        }),
    )
    register(pane({ regions: { list: () => <span data-region="list" />, detail: Detail } }))
    const Pane = paneRegistry.get('notes')!.component
    dispose = render(() => <Pane task={task} />, host)

    await until(() => !!host.querySelector('[data-region]'))
    expect(host.querySelector('[data-region="list"]')).not.toBeNull()
    expect(host.querySelector('[data-loading]')?.textContent).toBe('Notes')

    arrive({ default: () => <span data-region="detail" /> })
    await until(() => !!host.querySelector('[data-region="detail"]'))
    expect(host.querySelector('[data-loading]')).toBeNull()
  })
})

// A settled hover on a task row loads the code of the panes that task opens with, and no other pane's
// (docs/panes/contributions.md § Contributions).
describe('a hover over a task row', () => {
  it('loads the code of the panes the task opens with', async () => {
    const loaded: string[] = []
    const region = (id: string) =>
      lazy(async () => {
        loaded.push(id)
        return { default: () => <span /> }
      })
    register(pane({ regions: { list: () => <span />, detail: region('notes') } }))
    register(pane({ id: 'other', label: 'Other', regions: { list: () => <span />, detail: region('other') } }))
    schedulePanePrefetch(task, {} as never, ['notes'])
    await new Promise((resolve) => setTimeout(resolve, PANE_PREFETCH_HOVER_MS + 20))
    expect(loaded).toEqual(['notes'])
  })
})

// Upstream `lazy()` keeps a rejected import, so a boundary's Try again threw the same error without
// loading anything. The solid-js patch forgets a failed import (patches/README.md). This is the test
// for it.
describe('a lazy import that failed', () => {
  it('loads again when its error boundary resets', async () => {
    let attempts = 0
    const Flaky = lazy(async () => {
      attempts++
      if (attempts === 1) throw new Error('Importing a module script failed')
      return { default: () => <span data-loaded /> }
    })
    let retry: () => void = () => {}
    dispose = render(
      () => (
        <ErrorBoundary
          fallback={(_error, reset) => {
            retry = reset
            return <span data-failed />
          }}
        >
          <Flaky />
        </ErrorBoundary>
      ),
      host,
    )
    await until(() => !!host.querySelector('[data-failed]'))
    retry()
    await until(() => !!host.querySelector('[data-loaded]'))
    expect(attempts).toBe(2)
    expect(host.querySelector('[data-loaded]')).not.toBeNull()
  })
})

// `keepAlive` was a field on this contract that promised the host would hold a pane's DOM across a
// task switch. One pane set it, nothing read it, and it is gone (docs/panes/contributions.md § Contributions). This
// is a compile-time test: `@ts-expect-error` fails `tsc --noEmit`, and therefore `pnpm lint`, on the
// day somebody puts the field back without wiring it up.
describe('the pane contract', () => {
  it('has no keepAlive for a contribution to declare', () => {
    const refused = {
      id: 'ghost',
      label: 'Ghost',
      glyph: 'ghost',
      order: 99,
      component: () => <span />,
      // @ts-expect-error -- the field is deleted; ./paneModels.ts and the query cache are the keep-alive.
      keepAlive: 'dom',
    } satisfies PaneContribution
    expect(refused.id).toBe('ghost')
  })
})

describe('paneAvailable', () => {
  // The gate the rail and the pane switcher both read (../../../features/tasks/TaskPaneHost.tsx).
  // The seam arm is what keeps the browser preview off a shell that ships without preview views:
  // `'desktop'` said yes to that shell, and the pane then rendered a dead end.
  afterEach(() => {
    delete (window as unknown as { acorn?: unknown }).acorn
  })

  it('a seam gate follows the host, not the shell', () => {
    const gated = pane({ id: 'preview', requires: { seam: 'preview' } })
    register(gated)
    const entry = paneRegistry.get('preview')!
    ;(window as unknown as { acorn?: unknown }).acorn = { desktop: true, platform: 'darwin' }
    expect(paneAvailable(entry)).toBe(false)
    ;(window as unknown as { acorn?: unknown }).acorn = {
      desktop: true,
      platform: 'darwin',
      preview: {
        ensure() {},
        setBounds() {},
        show() {},
        hide() {},
        load() {},
        command() {},
        evict() {},
        evictAll() {},
        onEvent: () => () => {},
      },
    }
    expect(paneAvailable(entry)).toBe(true)
  })

  describe('by form factor', () => {
    const availableOn = (factor: 'desktop' | 'narrow') => {
      document.documentElement.dataset.formFactor = factor
      return paneAvailable(paneRegistry.get('notes')!)
    }
    afterEach(() => {
      delete document.documentElement.dataset.formFactor
    })

    it('offers a pane that names no form factor on every one', () => {
      register(pane())
      expect([availableOn('desktop'), availableOn('narrow')]).toEqual([true, true])
    })

    it('leaves out a pane that does not list the host’s form factor', () => {
      register(pane({ formFactor: ['desktop'] }))
      expect([availableOn('desktop'), availableOn('narrow')]).toEqual([true, false])
    })
  })
})

// The two pane spans (docs/telemetry/renderer.md § Renderer seams). Here rather than beside the emitter because
// both are about when a region is actually on screen: a region is a `lazy()` under its own
// `Suspense`, and only a jsdom test can hold one suspended and then let it resolve.
describe('the pane spans', () => {
  let posted: TelemetryRecord[]
  const spansNamed = (name: string): TelemetrySpan[] =>
    posted.filter((record): record is TelemetrySpan => record.kind === 'span' && record.name === name)

  const collecting = () => {
    posted = []
    startClientTelemetry({ runtime: 'renderer', post: async (records) => void posted.push(...records) })
    setTelemetryEnabled(true)
  }

  /** A pane whose one region waits on a promise this test resolves. `asked` says the host has got
   *  as far as calling the region, which is the only visible sign of it: a suspended region draws
   *  nothing at all. */
  type Gate = { asked: boolean; resolve: () => void }
  const suspending = (gate: Gate) =>
    pane({
      layout: 'single',
      model: () => ({ built: true }),
      regions: {
        body: (props: { model: { built: boolean } }) => {
          gate.asked = true
          // Read, because the model is behind a getter on purpose: a pane that switches task hands its
          // regions the new task's model without remounting them, so nothing is built until a region
          // asks.
          const built = props.model.built
          const [ready] = createResource(async () => {
            await new Promise<void>((resolve) => {
              gate.resolve = resolve
            })
            return built ? 'drawn' : 'no model'
          })
          return <span data-region="body">{ready()}</span>
        },
      },
    })

  // The layout module is behind `lazy`, so nothing happens on the first paint. Same generous poll as
  // the tests above, for the same reason.
  const until = async (done: () => boolean) => {
    for (let tries = 0; tries < 400 && !done(); tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await flushTelemetry()
  }

  const draw = (gate: Gate, owner?: string) => {
    registered.push(paneRegistry.register(suspending(gate), owner))
    const Pane = paneRegistry.get('notes')!.component
    dispose = render(() => <Pane task={task} />, host)
  }

  it('ends pane.region when the suspended region draws, not when the host asked for it', async () => {
    collecting()
    const gate: Gate = { asked: false, resolve: () => {} }
    draw(gate, 'notes')

    await until(() => gate.asked)
    // Asked for, suspended on its resource, and nothing on screen. This is the whole reason the
    // span ends at the child's mount rather than where the host created the region.
    expect(host.querySelector('[data-region]')).toBeNull()
    expect(spansNamed('pane.region')).toEqual([])

    gate.resolve()
    await until(() => spansNamed('pane.region').length > 0)
    const [span] = spansNamed('pane.region')
    expect(span?.attrs).toMatchObject({
      'pane.id': 'notes',
      'pane.region': 'body',
      owner: 'notes',
      runtime: 'renderer',
    })
    expect(host.querySelector('[data-region]')?.textContent).toBe('drawn')
  })

  it('owns pane.model by the plugin whose pane it is, and covers the build once', async () => {
    collecting()
    const gate: Gate = { asked: false, resolve: () => {} }
    draw(gate, 'notes')
    await until(() => gate.asked)
    gate.resolve()
    await until(() => spansNamed('pane.model').length > 0)
    const models = spansNamed('pane.model')
    // Once, however many regions read it: a cache hit did no work, and timing it would average the
    // build that takes a second away to nothing.
    expect(models).toHaveLength(1)
    expect(models[0].attrs).toMatchObject({ 'pane.id': 'notes', 'task.id': 't1', owner: 'notes' })
  })

  it('files a core pane under core', async () => {
    collecting()
    const gate: Gate = { asked: false, resolve: () => {} }
    // No owner, which is how every one of core's own panes is registered.
    draw(gate)
    await until(() => gate.asked)
    gate.resolve()
    await until(() => spansNamed('pane.region').length > 0)
    expect(spansNamed('pane.region')[0].attrs.owner).toBe('core')
  })
})

// A narrow `list-detail` pushes the detail when the pane's selection changes, and the pane reports
// that selection from the model it already keeps (docs/panes/layout.md § Layout model).
describe('a pane’s selection', () => {
  afterEach(() => {
    delete document.documentElement.dataset.formFactor
  })

  it('reaches a narrow list-detail layout, which shows the detail when it changes', async () => {
    document.documentElement.dataset.formFactor = 'narrow'
    const [key, setKey] = createSignal<string | null>(null)
    register(pane({ model: () => ({ key }), selection: (_task, model) => model.key() }))
    const Pane = paneRegistry.get('notes')!.component
    dispose = render(() => <Pane task={task} />, host)
    const shown = () => [...host.querySelectorAll('[data-region]')].map((node) => node.getAttribute('data-region'))
    await until(() => shown().length > 0)
    expect(shown()).toEqual(['list'])
    setKey('one')
    expect(shown()).toEqual(['detail'])
  })
})
