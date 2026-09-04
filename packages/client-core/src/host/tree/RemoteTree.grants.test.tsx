import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreeHostRequest, TreeHostResult } from './workerHost'

// Who is allowed to ask this host for what (docs/plugins.md § Asking the host).
//
// The routing and the limits are workerHost's and are tested in hostRequests.test.ts. What is tested
// here is the pair of grants, which is the part a security review reads: an action has to be in both
// the point owner's published declaration and this particular slot's handler map, and an overlay has to
// be the one this contribution's own manifest descriptor named. Neither is something the sandbox says.

let handler: ((request: TreeHostRequest) => Promise<TreeHostResult>) | null = null

vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))
vi.mock('@tanstack/solid-query', () => ({ useQueryClient: () => ({}) }))
// A button rather than a span: the overlay grant asks whether focus is inside this tree, and only a
// focusable element can answer yes.
vi.mock('./TreeHost', () => ({ TreeHost: () => <button type="button">tree</button> }))
vi.mock('../frames/frameServices', () => ({ createFrameServices: () => ({}) }))
vi.mock('../frames/broker', () => ({ createFrameBridge: () => ({}), postSelect: vi.fn(), postSurfaceAction: vi.fn() }))
vi.mock('./workerHost', () => ({
  acquireTreeWorker: () => ({
    transport: () => ({}),
    mount: () => {},
    unmount: () => {},
    release: () => {},
    bridgePort: () => null,
    onHostRequest: (_slot: string, bound: (request: TreeHostRequest) => Promise<TreeHostResult>) => {
      handler = bound
      return () => { handler = null }
    },
  }),
}))
// The roster row this device resolved, which is where the host looks up whether a named overlay is a
// surface this plugin actually declared.
vi.mock('../plugins/contributions', () => ({
  eligiblePlugins: () => [{
    pluginId: 'markup',
    installed: {
      permissions: { api: [], events: [] },
      contributions: { frames: [{ id: 'editor', target: 'overlay', label: 'Image markup' }] },
    },
  }],
  isTaskPane: () => false,
}))

const { RemoteTree } = await import('./RemoteTree')
const { pluginOverlayInvocation, closePluginOverlayWith, closePluginOverlay } = await import('../frames/overlays')

const CONTRIBUTION = { id: 'markup:preview', pluginId: 'markup', hash: 'a'.repeat(64), entry: 'attachmentPreview', overlay: 'editor' }

let dispose: (() => void) | null = null
let host: HTMLDivElement

const mount = (over: Partial<Parameters<typeof RemoteTree>[0]> = {}) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <RemoteTree
        contribution={CONTRIBUTION}
        props={() => ({})}
        actions={() => ({ replace: async (payload: unknown) => ({ replaced: payload }) })}
        declaredActions={() => ['replace']}
        {...over}
      />
    ),
    host,
  )
}

/** Focus something inside the tree, which is what a click on a contributor's button would have done. */
const focusInside = (): void => host.querySelector('button')?.focus()

const ask = (request: TreeHostRequest) => handler!(request)

beforeEach(() => {
  handler = null
})

afterEach(() => {
  closePluginOverlay()
  dispose?.()
  dispose = null
  host?.remove()
})

describe('invoking an owner action', () => {
  it('calls the handler this slot bound and hands back its answer', async () => {
    mount()
    await expect(ask({ op: 'owner.invoke', name: 'replace', payload: 'a2' }))
      .resolves.toEqual({ ok: true, body: { replaced: 'a2' } })
  })

  // The point's declaration is the owner plugin's published contract. A `Slot` that binds something the
  // point never declared has bound nothing, or the narrower of the two lists would be decorative.
  it('refuses an action the extension point does not declare, even when the slot bound one', async () => {
    mount({ declaredActions: () => [] })
    await expect(ask({ op: 'owner.invoke', name: 'replace', payload: null }))
      .resolves.toMatchObject({ ok: false, error: { code: 'unknown_action' } })
  })

  it('refuses an action the point declares but this slot did not bind', async () => {
    mount({ actions: () => ({}), declaredActions: () => ['replace'] })
    await expect(ask({ op: 'owner.invoke', name: 'replace', payload: null }))
      .resolves.toMatchObject({ ok: false, error: { code: 'unknown_action' } })
  })

  it('measures the owner’s answer too, so an action cannot become a data channel', async () => {
    mount({ actions: () => ({ replace: async () => 'x'.repeat(70_000) }) })
    await expect(ask({ op: 'owner.invoke', name: 'replace', payload: null }))
      .resolves.toMatchObject({ ok: false, error: { code: 'too_large' } })
  })
})

describe('opening a companion overlay', () => {
  it('refuses any overlay but the one this contribution declared', async () => {
    mount()
    focusInside()
    await expect(ask({ op: 'overlay.open', name: 'settings', payload: null }))
      .resolves.toMatchObject({ ok: false, error: { code: 'unknown_overlay' } })
  })

  it('refuses a contribution that declared none at all', async () => {
    mount({ contribution: { ...CONTRIBUTION, overlay: undefined } })
    focusInside()
    await expect(ask({ op: 'overlay.open', name: 'editor', payload: null }))
      .resolves.toMatchObject({ ok: false, error: { code: 'unknown_overlay' } })
  })

  // A modal is a person's act, so a bundle cannot put one in front of a reader from a timer.
  it('refuses when focus is not inside this tree', async () => {
    mount()
    document.body.focus()
    await expect(ask({ op: 'overlay.open', name: 'editor', payload: null }))
      .resolves.toMatchObject({ ok: false, error: { code: 'needs_focus' } })
  })

  it('presents the overlay with its input and resolves with what it closed with', async () => {
    mount()
    focusInside()
    const asked = ask({ op: 'overlay.open', name: 'editor', payload: { attachmentId: 'a1' } })
    await Promise.resolve()

    expect(pluginOverlayInvocation()).toMatchObject({ pluginId: 'markup', surface: 'editor', input: { attachmentId: 'a1' } })
    closePluginOverlayWith({ replacementAttachmentId: 'a2' })

    await expect(asked).resolves.toEqual({ ok: true, body: { replacementAttachmentId: 'a2' } })
  })

  it('resolves with null when the reader dismissed it, rather than leaving the tree waiting', async () => {
    mount()
    focusInside()
    const asked = ask({ op: 'overlay.open', name: 'editor', payload: null })
    await Promise.resolve()
    closePluginOverlay()
    await expect(asked).resolves.toEqual({ ok: true, body: null })
  })

  it('throttles a second opening, so a tree cannot reopen a modal a reader keeps dismissing', async () => {
    mount()
    focusInside()
    const first = ask({ op: 'overlay.open', name: 'editor', payload: null })
    await Promise.resolve()
    closePluginOverlay()
    await first

    await expect(ask({ op: 'overlay.open', name: 'editor', payload: null }))
      .resolves.toMatchObject({ ok: false, error: { code: 'throttled' } })
  })

  // An overlay outliving the tree that asked for it is a modal nobody can answer: the composer has gone.
  it('dismisses its own overlay when the tree unmounts', async () => {
    mount()
    focusInside()
    const asked = ask({ op: 'overlay.open', name: 'editor', payload: null })
    await Promise.resolve()
    dispose?.()
    dispose = null

    await expect(asked).resolves.toEqual({ ok: true, body: null })
    expect(pluginOverlayInvocation()).toBeNull()
  })
})
