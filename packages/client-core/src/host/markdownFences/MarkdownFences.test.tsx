import { createSignal, onCleanup } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CORE_MARKDOWN_FENCE_POINT, MAX_MARKDOWN_FENCE_BYTES, type MarkdownFenceProps } from '@acorn/protocol/extensionPoints.ts'
import Markdown from '../../kit/components/content/Markdown'
import { extensionRegistry, type ExtensionContribution } from '../registries/extensionPoints/extensionPoints'
import type { Disposable } from '../../kit/lib/state/registry'
import { markdownFences } from './MarkdownFences'
import { MAX_FENCE_VIEWERS, type FenceScope } from './fenceViewers'

// Other plugins' viewers for code fences in host-owned Markdown. Every assertion is something a person
// or a contributor would see: which fences draw a viewer, which stay source, what the viewer is told,
// and that the source, its copy button and the blocks around it are left alone.

vi.mock('../../infra/node/hostCapabilities', () => ({ hasHostCapability: () => true }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: {} }) }))
vi.mock('../../infra/queries', () => ({ prefsOptions: () => ({}) }))
// A loaded viewer goes through the worker path, tested in TreeHost and workerHost. This one fails at
// once, the way a bundle that cannot load does.
vi.mock('../tree/RemoteTree', () => ({
  RemoteTree: (props: { onFailed?: (reason: string) => void }) => {
    queueMicrotask(() => props.onFailed?.('bundle refused'))
    return null
  },
}))
// The highlighter would replace each `<pre>`; these tests are about what stands beside it.
vi.mock('../../infra/highlight/shiki', () => ({ highlightToHtml: async () => null }))

const registered: Disposable[] = []
let events: string[] = []
let mounted: MarkdownFenceProps[] = []

// A compiled viewer that says what it was given and when it comes and goes.
const viewer = (pluginId = 'tables', matches: string[] = ['json']) => {
  const registration = extensionRegistry.register({
    id: `plugin:${pluginId}:fence`,
    pluginId,
    point: CORE_MARKDOWN_FENCE_POINT,
    label: `${pluginId} fence`,
    order: 500,
    carrier: 'component',
    matches,
    component: (props: MarkdownFenceProps) => {
      mounted.push(props)
      events.push(`mount ${props.blockId}`)
      onCleanup(() => {
        events.push(`unmount ${props.blockId}`)
        mounted = mounted.filter((entry) => entry !== props)
      })
      return <output>{`${pluginId}: ${props.text}`}</output>
    },
  } as ExtensionContribution)
  registered.push(registration)
  return registration
}

const draw = (initial: string, scope: FenceScope = { taskId: 'task-1' }) => {
  const [text, setText] = createSignal(initial)
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => {
    const fences = markdownFences(scope)
    return <Markdown text={text()} copy fences={fences} />
  }, host)
  return {
    host,
    setText,
    wraps: () => [...host.querySelectorAll<HTMLElement>('.ui-code-wrap')],
    toggles: () => [...host.querySelectorAll<HTMLButtonElement>('.markdown-fence-toggle button')],
    done: () => { dispose(); host.remove() },
  }
}

const fence = (body: string, language = 'json') => `\`\`\`${language}\n${body}\n\`\`\``
const settle = (check: () => void) => vi.waitFor(check, { timeout: 5_000 })

afterEach(() => {
  for (const registration of registered.reverse()) registration.dispose()
  registered.length = 0
  events = []
  mounted = []
  document.getSelection()?.removeAllRanges()
})

describe('Markdown fence viewers', () => {
  it('starts no viewer while a fence streams, and one with its props once it closes', async () => {
    viewer()
    const view = draw('Intro\n\n```JSON\n{"a": 1')
    try {
      await Promise.resolve()
      expect(view.toggles()).toHaveLength(0)
      expect(mounted).toHaveLength(0)
      view.setText('Intro\n\n```JSON\n{"a": 1}\n```')
      await settle(() => expect(mounted).toHaveLength(1))
      expect(mounted[0]).toEqual({ blockId: 'fence-1', language: 'JSON', text: '{"a": 1}', revision: 2, taskId: 'task-1' })
      const wrap = view.wraps()[0]
      expect(wrap.hasAttribute('data-preview')).toBe(true)
      // The wrapper keeps what a selection action reads, and the source stays for Copy and Source.
      expect(wrap.dataset.language).toBe('JSON')
      expect(wrap.querySelector('pre')?.textContent).toBe('{"a": 1}')
      expect(wrap.querySelector('.copy-btn')).not.toBeNull()
      expect(view.toggles()[0].getAttribute('aria-pressed')).toBe('true')
    } finally { view.done() }
  })

  it('gives a fence with no hint, no match, or text over the cap no viewer', async () => {
    viewer()
    const view = draw([fence('plain', ''), fence('a,b', 'csv'), fence('x'.repeat(MAX_MARKDOWN_FENCE_BYTES + 1))].join('\n\n'))
    try {
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(view.wraps()).toHaveLength(3)
      expect(view.toggles()).toHaveLength(0)
      expect(view.host.querySelector('[data-preview]')).toBeNull()
      expect(mounted).toHaveLength(0)
    } finally { view.done() }
  })

  it('opens four viewers on its own and makes room for a fifth only when asked', async () => {
    viewer()
    const view = draw(Array.from({ length: 5 }, (_, at) => fence(`${at}`)).join('\n\n'))
    try {
      await settle(() => expect(mounted.map((props) => props.text)).toEqual(['0', '1', '2', '3']))
      expect(view.toggles()).toHaveLength(5)
      expect(view.wraps()[4].hasAttribute('data-preview')).toBe(false)
      view.toggles()[4].click()
      await settle(() => expect(mounted.map((props) => props.text).sort()).toEqual(['1', '2', '3', '4']))
      expect(mounted).toHaveLength(MAX_FENCE_VIEWERS)
      // The earliest open fence went back to its source to make room.
      expect(view.wraps()[0].hasAttribute('data-preview')).toBe(false)
    } finally { view.done() }
  })

  it('goes back to source and copies it whoever draws the fence', async () => {
    viewer()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const view = draw(fence('{"copied": true}'))
    try {
      await settle(() => expect(mounted).toHaveLength(1))
      view.wraps()[0].querySelector<HTMLButtonElement>('.copy-btn')!.click()
      expect(writeText).toHaveBeenCalledWith('{"copied": true}')
      view.toggles()[0].click()
      await settle(() => expect(mounted).toHaveLength(0))
      expect(view.wraps()[0].hasAttribute('data-preview')).toBe(false)
      expect(view.toggles()[0].getAttribute('aria-pressed')).toBe('false')
    } finally { view.done() }
  })

  it('disposes the old viewer before a changed fence gets its own', async () => {
    viewer()
    const view = draw(fence('{"v": 1}'))
    try {
      await settle(() => expect(mounted).toHaveLength(1))
      view.setText(fence('{"v": 2}'))
      await settle(() => expect(mounted.map((props) => props.text)).toEqual(['{"v": 2}']))
      expect(events).toEqual(['mount fence-1', 'unmount fence-1', 'mount fence-2'])
      expect(mounted[0].revision).toBe(2)
    } finally { view.done() }
  })

  it('gives two equal fences a viewer each and keeps both across an insertion and a removal', async () => {
    viewer()
    const same = fence('{"same": true}')
    const view = draw(`${same}\n\n${same}`)
    try {
      await settle(() => expect(mounted.map((props) => props.blockId)).toEqual(['fence-1', 'fence-2']))
      view.setText(`A new paragraph first.\n\n${same}\n\n${same}`)
      await Promise.resolve()
      expect(events).toEqual(['mount fence-1', 'mount fence-2'])
      view.setText(`A new paragraph first.\n\n${same}`)
      await settle(() => expect(mounted).toHaveLength(1))
      expect(events).toHaveLength(3)
    } finally { view.done() }
  })

  it('keeps a selection in the paragraph above while a fence opens and toggles', async () => {
    viewer()
    const view = draw('A paragraph somebody is reading.\n\n```json\n{"a": 1')
    try {
      const paragraph = view.host.querySelector('p')!
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      document.getSelection()!.addRange(range)
      view.setText('A paragraph somebody is reading.\n\n```json\n{"a": 1}\n```')
      await settle(() => expect(mounted).toHaveLength(1))
      view.toggles()[0].click()
      await settle(() => expect(mounted).toHaveLength(0))
      expect(view.host.querySelector('p')).toBe(paragraph)
      expect(document.getSelection()!.toString()).toBe('A paragraph somebody is reading.')
    } finally { view.done() }
  })

  it('falls back to source when the viewer’s plugin goes away or its tree fails', async () => {
    const registration = viewer()
    const view = draw(fence('{"a": 1}'))
    try {
      await settle(() => expect(mounted).toHaveLength(1))
      registration.dispose()
      await settle(() => expect(mounted).toHaveLength(0))
      expect(view.toggles()).toHaveLength(0)
      expect(view.wraps()[0].hasAttribute('data-preview')).toBe(false)
      expect(view.wraps()[0].querySelector('pre')?.textContent).toBe('{"a": 1}')
      expect(view.wraps()[0].querySelector('.copy-btn')).not.toBeNull()
    } finally { view.done() }

    registered.push(extensionRegistry.register({
      id: 'plugin:broken:fence', pluginId: 'broken', point: CORE_MARKDOWN_FENCE_POINT, label: 'Broken',
      order: 500, carrier: 'remote', entry: 'fence', hash: 'abc', matches: ['json'],
    } as ExtensionContribution))
    const broken = draw(fence('{"a": 1}'))
    try {
      await settle(() => expect(broken.toggles()).toHaveLength(0))
      expect(broken.wraps()[0].hasAttribute('data-preview')).toBe(false)
      expect(broken.wraps()[0].querySelector('pre')).not.toBeNull()
    } finally { broken.done() }
  })

  it('leaves a fence as source while two plugins tie and nobody has picked', async () => {
    viewer('tables')
    viewer('charts')
    const view = draw(fence('{"a": 1}'))
    try {
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(view.toggles()).toHaveLength(0)
      expect(mounted).toHaveLength(0)
    } finally { view.done() }
  })
})
