import { render } from 'solid-js/web'
import { createEffect, createSignal, ErrorBoundary } from 'solid-js'
import { setContributionErrorHandler } from '../../kit/lib/telemetry/contributionErrors'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Slot } from './Slot'
import {
  extensionPointRegistry,
  extensionRegistry,
  type ExtensionContribution,
} from '../registries/extensionPoints/extensionPoints'
import type { Disposable } from '../../kit/lib/state/registry'

// A place in one plugin's tree where another plugin's tree may be grafted (docs/plugins/cooperative-extension-points.md §
// Cooperative extension points, the `remote` kind).
//
// The arbitration rule itself is unit-tested next door in `arbitration.test.ts`; what a render adds is
// the facts a person would see: the owner's default draws when nobody matches and while a tie is
// undecided, and a stack past `max` says how many were left out.

vi.mock('../../infra/node/hostCapabilities', () => ({ hasHostCapability: () => true }))
// What the user picked in Settings → Plugins. When the query is created is ./slotChoice.test.tsx's.
const prefs = vi.hoisted(() => ({ data: {} as Record<string, string> }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({
    get data() {
      return prefs.data
    },
  }),
}))
vi.mock('../../infra/queries', () => ({ prefsOptions: () => ({}) }))

// The tree itself is the worker path, tested in TreeHost/workerHost. Here it only has to be
// identifiable on screen.
vi.mock('./RemoteTree', () => ({
  RemoteTree: (props: {
    contribution: { pluginId: string }
    scope?: () => { taskId?: string }
    props?: () => unknown
  }) => {
    createEffect(() => {
      if ((props.props?.() as { fail?: boolean })?.fail) throw new Error('remote contribution failed')
    })
    return (
      <span>
        tree:{props.contribution.pluginId}
        {props.scope?.().taskId ? ` in ${props.scope!().taskId}` : ''}
      </span>
    )
  },
}))

const registered: Disposable[] = []

const point = (over: { id?: string; mode?: 'stack' | 'replace'; max?: number; actions?: string[] } = {}) =>
  registered.push(
    extensionPointRegistry.register({
      id: over.id ?? 'agents:attachment',
      ownerId: 'agents',
      label: 'Attachment',
      kind: 'remote',
      mode: over.mode ?? 'replace',
      max: over.max ?? 4,
      ...(over.actions ? { actions: over.actions } : {}),
    }),
  )

const contributor = (pluginId: string, pointId: string, matches?: string[]) =>
  registered.push(
    extensionRegistry.register({
      id: `plugin:${pluginId}:draw`,
      pluginId,
      point: pointId,
      label: `${pluginId} viewer`,
      order: 500,
      carrier: 'remote',
      entry: 'draw',
      hash: 'abc',
      ...(matches ? { matches } : {}),
    } as ExtensionContribution),
  )

const draw = (element: () => Parameters<typeof render>[0]) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(element(), host)
  const text = host.textContent ?? ''
  dispose()
  host.remove()
  return text
}

afterEach(() => {
  for (const disposable of registered.reverse()) disposable.dispose()
  registered.length = 0
  prefs.data = {}
})

describe('Slot', () => {
  it('draws the owner’s default when the point is not declared here', () => {
    expect(
      draw(() => () => (
        <Slot point="agents:attachment" key="image/png">
          default
        </Slot>
      )),
    ).toBe('default')
  })

  it('draws the owner’s default when nobody matches the key', () => {
    point()
    contributor('images', 'agents:attachment', ['image/*'])
    expect(
      draw(() => () => (
        <Slot point="agents:attachment" key="text/csv">
          default
        </Slot>
      )),
    ).toBe('default')
  })

  it('grafts the one contributor that matches', () => {
    point()
    contributor('images', 'agents:attachment', ['image/*'])
    expect(
      draw(() => () => (
        <Slot point="agents:attachment" key="image/png">
          default
        </Slot>
      )),
    ).toBe('tree:images')
  })

  it('draws the owner’s default while two contributors are tied and nobody has picked', () => {
    point()
    contributor('images', 'agents:attachment', ['image/*'])
    contributor('thumbs', 'agents:attachment', ['image/png'])
    expect(
      draw(() => () => (
        <Slot point="agents:attachment" key="image/png">
          default
        </Slot>
      )),
    ).toBe('default')
  })

  it('draws the contributor the user picked to settle a tie', () => {
    point()
    contributor('images', 'agents:attachment', ['image/*'])
    contributor('thumbs', 'agents:attachment', ['image/png'])
    prefs.data = { remote_slots: JSON.stringify({ 'agents:attachment': 'thumbs' }) }
    expect(
      draw(() => () => (
        <Slot point="agents:attachment" key="image/png">
          default
        </Slot>
      )),
    ).toBe('tree:thumbs')
  })

  it('stacks up to the owner’s ceiling and discloses the rest as a count', () => {
    point({ id: 'agents:composer-actions', mode: 'stack', max: 2 })
    for (const id of ['a', 'b', 'c']) contributor(id, 'agents:composer-actions')
    const text = draw(() => () => <Slot point="agents:composer-actions">default</Slot>)
    expect(text).toContain('tree:a')
    expect(text).toContain('tree:b')
    expect(text).not.toContain('tree:c')
    // A count and no names: the owner set the ceiling because it is the owner's screen.
    expect(text).toContain('1 more from other plugins')
  })

  it('hands the contributor’s tree the owner’s task, so a card drawn in a pane is not inert', () => {
    // Without a subject the tree's bridge has no `taskId`, and `openPane`, in-app `openUrl` and every
    // task-scoped key binding answer `undefined` (../frames/frameServices.ts). The owner's task, never
    // the ambient one: a project pane and a reference panel are not looking at a task even while one is
    // selected in the rail behind them.
    point()
    contributor('images', 'agents:attachment', ['image/png'])
    expect(
      draw(() => () => (
        <Slot point="agents:attachment" key="image/png" taskId="t-42">
          default
        </Slot>
      )),
    ).toBe('tree:images in t-42')
    // And an owner with no task to give says so rather than inventing one.
    expect(
      draw(() => () => (
        <Slot point="agents:attachment" key="image/png">
          default
        </Slot>
      )),
    ).toBe('tree:images')
  })

  it.each(['replace', 'stack'] as const)('contains a remote contribution update failure in a %s slot', (mode) => {
    point({ mode })
    contributor('images', 'agents:attachment')
    const [fail, setFail] = createSignal(false)
    const reports: unknown[] = []
    setContributionErrorHandler((report) => reports.push(report))
    const host = document.createElement('div')
    const dispose = render(
      () => (
        <ErrorBoundary fallback="pane crashed">
          <span>conversation</span>
          <Slot point="agents:attachment" props={() => ({ fail: fail() })}>
            default
          </Slot>
        </ErrorBoundary>
      ),
      host,
    )
    try {
      expect(host.textContent).toContain('tree:images')
      setFail(true)
      expect(host.textContent).toBe('conversationdefault')
      expect(reports).toEqual([expect.objectContaining({ contributionId: 'plugin:images:draw', owner: 'images' })])
      setFail(false)
      expect(host.textContent).toBe('conversationdefault')
    } finally {
      dispose()
      setContributionErrorHandler(null)
    }
  })

  it('resolves a slot in the owner’s default without nesting a contributor', () => {
    // A grafted contributor receives no host-minted chrome slot reference. What this holds is the
    // consequence — a slot in the *owner's* own default children is ordinary tree and still resolves,
    // because the owner is not a contributor to itself.
    point()
    point({ id: 'agents:tool-card' })
    contributor('cards', 'agents:tool-card', ['bash'])
    const text = draw(() => () => (
      <Slot point="agents:attachment" key="text/csv">
        <Slot point="agents:tool-card" key="bash">
          inner
        </Slot>
      </Slot>
    ))
    expect(text).toBe('tree:cards')
  })
})

describe('a compiled contributor at a point with owner actions', () => {
  type Host = { invoke(name: string, payload?: unknown): Promise<unknown> }
  const hosts: (Host | undefined)[] = []
  const compiled = (pluginId: string, pointId: string) =>
    registered.push(
      extensionRegistry.register({
        id: `plugin:${pluginId}:button`,
        pluginId,
        point: pointId,
        label: pluginId,
        order: 500,
        carrier: 'component',
        component: (props: { host?: Host }) => {
          hosts.push(props.host)
          return <button type="button">{pluginId}</button>
        },
      } as ExtensionContribution),
    )

  let dispose = (): void => {}
  let host: HTMLDivElement
  const mount = (actions: Record<string, (payload: unknown, invocation: { byPerson: boolean }) => unknown>) => {
    host = document.createElement('div')
    document.body.append(host)
    // jsdom dispatches only untrusted events, so the trusted press is the real capturing listener the
    // slot registered, called with the browser's bit, as RemoteTree.grants.test.tsx does.
    const listen = vi.spyOn(HTMLElement.prototype, 'addEventListener')
    dispose = render(
      () => (
        <Slot point="preview:toolbar-actions" actions={actions}>
          <button type="button">owner</button>
        </Slot>
      ),
      host,
    )
    const presses = listen.mock.calls
      .filter(([type]) => type === 'pointerdown')
      .map(([, listener]) => listener as EventListener)
    listen.mockRestore()
    return { press: (index: number) => presses[index]!({ isTrusted: true } as Event) }
  }

  afterEach(() => {
    dispose()
    host?.remove()
    hosts.length = 0
  })

  it('asks the owner with byPerson false unless a person pressed inside that contributor', async () => {
    point({ id: 'preview:toolbar-actions', mode: 'stack', actions: ['reload'] })
    compiled('first', 'preview:toolbar-actions')
    compiled('second', 'preview:toolbar-actions')
    const seen: boolean[] = []
    const { press } = mount({
      reload: (_payload, invocation) => {
        seen.push(invocation.byPerson)
        return 'done'
      },
    })

    await expect(hosts[0]!.invoke('reload', {})).resolves.toBe('done')
    // A synthetic event proves nothing.
    host.querySelector('span button')?.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }))
    await hosts[0]!.invoke('reload', {})
    // A press in the other contributor isn't a press in this one.
    press(1)
    await hosts[0]!.invoke('reload', {})
    press(0)
    await hosts[0]!.invoke('reload', {})
    expect(seen).toEqual([false, false, false, true])
  })

  it('refuses an action the point does not declare, before the owner hears of it', async () => {
    point({ id: 'preview:toolbar-actions', mode: 'stack', actions: ['reload'] })
    compiled('first', 'preview:toolbar-actions')
    const load = vi.fn()
    mount({ reload: () => null, load })
    await expect(hosts[0]!.invoke('load', { url: 'https://example.com' })).rejects.toMatchObject({
      code: 'unknown_action',
    })
    expect(load).not.toHaveBeenCalled()
  })

  it('hands no host to a contributor at a point without actions', () => {
    point({ id: 'preview:toolbar-actions', mode: 'stack' })
    compiled('first', 'preview:toolbar-actions')
    mount({})
    expect(hosts).toEqual([undefined])
    expect(host.querySelector('span')).toBeNull()
  })
})
