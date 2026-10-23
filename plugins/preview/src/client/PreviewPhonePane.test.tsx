import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/plugin-api/client'
import { paneRegistry, type Disposable } from '@acorn/plugin-api/testkit/client'

// The phone's pane: which address it opens, what it frames, and what it does when the frame says the
// browser held back the cookie. It is drawn through the pane registry, as the shell draws it.

const write = vi.fn(async (_url: string, _init: { body?: string; nodeId?: string | null }): Promise<unknown> => ({}))
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => 'node-a',
  writeJson: (url: string, init: { body?: string; nodeId?: string | null }) => write(url, init),
}))
vi.mock('@acorn/plugin-api/ui', () => ({
  Button: (props: { onPress: () => void; disabled?: boolean; children?: unknown }) => (
    <button disabled={props.disabled} onClick={props.onPress}>
      {props.children as string}
    </button>
  ),
  EmptyState: (props: { title: string; action?: unknown; children?: unknown }) => (
    <section class="empty">
      <h2>{props.title}</h2>
      {props.children as string}
      {props.action as never}
    </section>
  ),
  Rectangle: (props: { mount: (element: HTMLElement) => void }) => <div ref={props.mount} />,
  Spinner: (props: { label: string }) => <span class="spinner">{props.label}</span>,
}))
vi.mock('./configuredStore', () => ({ previewConfigured: () => true }))

const { previewPhonePaneContribution } = await import('./paneContribution')

const ADDRESS = 'https://abc.def.preview.example/__acorn/preview?key=k'
const task = { id: 't1', status: 'active' } as Task
let host: HTMLElement
let registration: Disposable
const disposers: (() => void)[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  registration = paneRegistry.register(previewPhonePaneContribution)
  write.mockReset().mockResolvedValue({ url: ADDRESS })
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  registration.dispose()
  host.remove()
  vi.restoreAllMocks()
})

function draw() {
  const Pane = paneRegistry.get('preview-phone')!.component
  disposers.push(render(() => <Pane task={task} />, host))
}
const frame = () => host.querySelector('iframe')
const shown = (text: string) => vi.waitFor(() => expect(host.textContent).toContain(text), { timeout: 5_000 })

it('is the narrow form of Preview, for a task that has an address', () => {
  expect(previewPhonePaneContribution).toMatchObject({ formFactor: ['narrow'], requires: { plugin: 'preview' } })
})

it('asks the Node for an address framed by this app, and frames it with no way to navigate the app', async () => {
  draw()
  await vi.waitFor(() => expect(frame()).not.toBeNull(), { timeout: 5_000 })
  expect(write).toHaveBeenCalledWith(
    '/v1/p/preview/tasks/t1/proxy/__acorn/open',
    expect.objectContaining({
      method: 'POST',
      nodeId: 'node-a',
      body: JSON.stringify({ ancestor: window.location.origin }),
    }),
  )
  expect(frame()!.getAttribute('src')).toBe(ADDRESS)
  const sandbox = frame()!.getAttribute('sandbox')!
  expect(sandbox).not.toContain('allow-top-navigation')
  expect(sandbox).not.toContain('allow-popups')
  expect(frame()!.referrerPolicy).toBe('no-referrer')
})

it('offers the preview as a page of its own when the frame says its cookie was refused', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  draw()
  await vi.waitFor(() => expect(frame()).not.toBeNull(), { timeout: 5_000 })
  const message = (init: { data: string; origin: string; source: Window | null }) =>
    window.dispatchEvent(new MessageEvent('message', init))

  // Another page, or the right page's other window, is ignored.
  message({ data: 'acorn-preview:cookie-blocked', origin: 'https://evil.example', source: frame()!.contentWindow })
  message({ data: 'acorn-preview:cookie-blocked', origin: 'https://abc.def.preview.example', source: window })
  expect(frame()).not.toBeNull()

  write.mockResolvedValue({ url: 'https://other.def.preview.example/__acorn/preview?key=second' })
  message({
    data: 'acorn-preview:cookie-blocked',
    origin: 'https://abc.def.preview.example',
    source: frame()!.contentWindow,
  })
  await shown('Open it as a page of its own')
  // The second address is for a page nothing frames, and is already in hand when the person taps.
  await vi.waitFor(() => expect(host.querySelector('button')!.disabled).toBe(false))
  expect(write).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ body: '{}' }))
  host.querySelector('button')!.click()
  expect(open).toHaveBeenCalledWith(
    'https://other.def.preview.example/__acorn/preview?key=second',
    '_blank',
    'noopener,noreferrer',
  )
})

it("says what the Node said when it can't open a preview, and when there is nothing to open", async () => {
  write.mockRejectedValueOnce(Object.assign(new Error('This Node is still getting its certificate.'), { status: 503 }))
  draw()
  await shown('This Node is still getting its certificate.')
  write.mockResolvedValue({ url: ADDRESS })
  host.querySelector('button')!.click()
  await vi.waitFor(() => expect(frame()).not.toBeNull())

  for (const dispose of disposers.splice(0)) dispose()
  write.mockRejectedValueOnce(Object.assign(new Error('no_preview'), { status: 404 }))
  draw()
  await shown('No preview address')
})
