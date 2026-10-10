import { createEffect, createSignal, Show, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CORE_LINK_PREVIEW_POINT } from '@acorn/protocol/extensionPoints.ts'
import { extensionRegistry, type ExtensionContribution } from '../registries/extensionPoints/extensionPoints'
import type { Disposable } from '../../kit/lib/state/registry'

// The link preview as a person meets it: hover a link in any of the three content paths, wait, read
// the preview, move on. The contributor's tree is the worker path, tested in TreeHost and workerHost;
// here a stand-in counts its mounts and records the props it is handed.

vi.mock('../../infra/node/hostCapabilities', () => ({ hasHostCapability: () => true }))
const prefs = vi.hoisted(() => ({ data: {} as Record<string, string> }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ get data() { return prefs.data } }) }))
vi.mock('../../infra/queries', () => ({ prefsOptions: () => ({}) }))

type TreeProps = { contribution: { pluginId: string }; props: () => { url: string; label?: string }; onFailed?: (reason: string) => void }
const trees = vi.hoisted(() => ({ mounts: [] as string[], urls: [] as string[], fail: undefined as undefined | (() => void) }))
vi.mock('../tree/RemoteTree', () => ({
  RemoteTree: (props: TreeProps) => {
    trees.mounts.push(props.contribution.pluginId)
    trees.fail = () => props.onFailed?.('worker died')
    createEffect(() => trees.urls.push(props.props().url))
    return <span>tree:{props.contribution.pluginId}</span>
  },
}))

const { LinkPreviewHost } = await import('./LinkPreviewHost')
const { closeLinkPreview, createLinkPreviewBoundary, HOVER_DWELL_MS, LEAVE_GRACE_MS, linkPreview } = await import('./linkPreview')
const { default: Markdown } = await import('../../kit/components/content/Markdown')
const { default: ProviderHtml } = await import('../components/ProviderHtml')
const { Link } = await import('../../kit/components/content/Link')
const { setActiveNode } = await import('../../infra/node/activeNode')

const registered: Disposable[] = []
const contributor = (pluginId: string, matches: string[]) =>
  registered.push(extensionRegistry.register({
    id: `plugin:${pluginId}:preview`, pluginId, point: CORE_LINK_PREVIEW_POINT, label: `${pluginId} preview`,
    order: 500, carrier: 'remote', entry: 'preview', hash: 'abc', matches,
  } as ExtensionContribution))

let dispose: (() => void) | undefined
const [taskId, setTaskId] = createSignal('task-1')
const mount = (content: () => JSX.Element) => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => {
    const boundary = createLinkPreviewBoundary(() => ({ taskId: taskId(), projectId: 'project-1' }))
    return <><div class="content" {...boundary}>{content()}</div><LinkPreviewHost /></>
  }, host)
  return host
}

const link = (text: string): HTMLAnchorElement =>
  [...document.querySelectorAll<HTMLAnchorElement>('.content a')].find((anchor) => anchor.textContent === text)!
const surface = () => document.querySelector<HTMLElement>('.link-preview')
const over = (target: Element, from?: Element) =>
  target.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: from ?? null }))
const out = (target: Element, to?: Element) =>
  target.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: to ?? null }))
const hover = (target: Element) => {
  over(target)
  vi.advanceTimersByTime(HOVER_DWELL_MS)
}

beforeEach(() => {
  vi.useFakeTimers()
  setActiveNode('node-a')
  trees.mounts = []
  trees.urls = []
})
afterEach(() => {
  closeLinkPreview()
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  for (const entry of registered.splice(0).reverse()) entry.dispose()
  prefs.data = {}
  setTaskId('task-1')
  setActiveNode(null)
  vi.useRealTimers()
})

const links = () => (
  <>
    <Markdown text="Read [the guide](https://docs.example.com/guide) first." />
    <ProviderHtml html={'<p>See <a href="https://docs.example.com/api">the API</a>.</p>'} />
    <Link href="https://other.example.com/page">a tree link</Link>
    <a href="http://plain.example.com/">not https</a>
  </>
)

describe('link previews', () => {
  it('opens after the dwell, with the owner fallback when nobody previews the site', () => {
    mount(links)
    over(link('the guide'))
    vi.advanceTimersByTime(HOVER_DWELL_MS - 1)
    expect(surface()).toBeNull()
    vi.advanceTimersByTime(1)
    expect(surface()!.textContent).toContain('the guide')
    expect(surface()!.textContent).toContain('https://docs.example.com/guide')
    expect(surface()!.querySelector('button')!.textContent).toBe('Open')
    // Hovering never takes focus.
    expect(document.activeElement).toBe(document.body)
  })

  it('reaches the same controller from Markdown, provider HTML and a kit link', () => {
    contributor('docs', ['https://docs.example.com/*'])
    contributor('other', ['https://other.example.com/*'])
    mount(links)
    hover(link('the guide'))
    expect(linkPreview()).toMatchObject({ url: 'https://docs.example.com/guide', label: 'the guide', scope: { taskId: 'task-1', projectId: 'project-1' } })
    hover(link('the API'))
    expect(linkPreview()?.url).toBe('https://docs.example.com/api')
    hover(link('a tree link'))
    expect(surface()!.textContent).toContain('tree:other')
    expect(surface()!.textContent).toContain('From other')
    hover(link('not https'))
    expect(linkPreview()?.url).toBe('https://other.example.com/page')
  })

  it('starts no tree for a link nobody hovered, and none for a pointer that left before the dwell', () => {
    contributor('docs', ['https://docs.example.com/*'])
    mount(links)
    over(link('the guide'))
    vi.advanceTimersByTime(HOVER_DWELL_MS - 10)
    out(link('the guide'))
    vi.advanceTimersByTime(HOVER_DWELL_MS)
    expect(surface()).toBeNull()
    expect(trees.mounts).toEqual([])
  })

  it('keeps the contributor’s tree across links and hands it each new URL', () => {
    contributor('docs', ['https://docs.example.com/*'])
    mount(links)
    hover(link('the guide'))
    out(link('the guide'))
    hover(link('the API'))
    expect(trees.mounts).toEqual(['docs'])
    expect(trees.urls).toEqual(['https://docs.example.com/guide', 'https://docs.example.com/api'])
  })

  it('stays open while the pointer crosses into the preview, and closes after the grace once it leaves', () => {
    mount(links)
    hover(link('the guide'))
    out(link('the guide'), surface()!)
    surface()!.dispatchEvent(new MouseEvent('pointerenter'))
    vi.advanceTimersByTime(LEAVE_GRACE_MS * 2)
    expect(surface()).not.toBeNull()
    surface()!.dispatchEvent(new MouseEvent('pointerleave'))
    vi.advanceTimersByTime(LEAVE_GRACE_MS)
    expect(surface()).toBeNull()
  })

  it('draws the owner fallback while two contributors are tied, and the one the person picked', () => {
    contributor('docs', ['https://docs.example.com/*'])
    contributor('mirror', ['https://docs.example.com/guide'])
    mount(links)
    hover(link('the guide'))
    expect(surface()!.textContent).toContain('https://docs.example.com/guide')
    expect(trees.mounts).toEqual([])
    closeLinkPreview()
    prefs.data = { remote_slots: JSON.stringify({ [CORE_LINK_PREVIEW_POINT]: 'mirror' }) }
    hover(link('the guide'))
    expect(surface()!.textContent).toContain('tree:mirror')
  })

  it('falls back to the owner when the contributor’s tree fails or the plugin is disabled', () => {
    contributor('docs', ['https://docs.example.com/*'])
    mount(links)
    hover(link('the guide'))
    expect(surface()!.textContent).toContain('tree:docs')
    trees.fail!()
    expect(surface()!.textContent).toContain('https://docs.example.com/guide')
    expect(surface()!.textContent).not.toContain('From docs')
    closeLinkPreview()
    registered.pop()!.dispose()
    hover(link('the guide'))
    expect(surface()!.textContent).not.toContain('tree:')
  })

  it('closes on Escape, an outside press, a task change, a node change and the link leaving the page', async () => {
    mount(links)
    hover(link('the guide'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(surface()).toBeNull()

    hover(link('the guide'))
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(surface()).toBeNull()

    hover(link('the guide'))
    setTaskId('task-2')
    expect(surface()).toBeNull()

    hover(link('the guide'))
    setActiveNode('node-b')
    expect(surface()).toBeNull()

    hover(link('the guide'))
    link('the guide').remove()
    await vi.waitFor(() => expect(surface()).toBeNull())
  })

  it('previews from the link menu, takes focus, and gives it back on close', async () => {
    mount(links)
    const anchor = link('the guide')
    anchor.focus()
    anchor.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }))
    const items = [...document.querySelectorAll<HTMLButtonElement>('.ui-menu-item')]
    expect(items.map((item) => item.textContent)).toEqual(['Preview', 'Open link', 'Copy link'])
    items[0]!.click()
    await vi.waitFor(() => expect(document.activeElement).toBe(surface()))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(surface()).toBeNull()
    expect(document.activeElement).toBe(anchor)
  })

  it('leaves a right-click with Option to the platform, and never touches a click', () => {
    mount(links)
    const anchor = link('the guide')
    const optionClick = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, altKey: true })
    anchor.dispatchEvent(optionClick)
    expect(optionClick.defaultPrevented).toBe(false)
    const plain = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(true)
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    link('the API').dispatchEvent(modified)
    expect(modified.defaultPrevented).toBe(false)
  })

  it('closes a preview its owner no longer draws', () => {
    const [shown, setShown] = createSignal(true)
    const host = document.createElement('div')
    document.body.append(host)
    dispose = render(() => (
      <>
        <Show when={shown()}>
          {(() => {
            const boundary = createLinkPreviewBoundary(() => ({ taskId: 'task-1' }))
            return <div class="content" {...boundary}><Link href="https://docs.example.com/x">owned</Link></div>
          })()}
        </Show>
        <LinkPreviewHost />
      </>
    ), host)
    hover(link('owned'))
    expect(surface()).not.toBeNull()
    setShown(false)
    expect(surface()).toBeNull()
  })
})
