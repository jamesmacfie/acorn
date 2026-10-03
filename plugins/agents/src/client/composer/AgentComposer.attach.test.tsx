import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../contract/wire.ts'

// Attach, end to end through the platform seam. The stub is a host on `window.acorn` rather than a
// mocked module, so what this drives is the real `pickFiles` — the button, the seam's dispatch, and
// the upload the bytes end up in are all the shipped code.

vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: undefined }) }))

const uploadAttachment = vi.fn(async (_taskId: string, file: File) => ({
  id: 'att-1', filename: file.name, mediaType: file.type, byteSize: file.size,
}))
vi.mock('../sessions/managedClient', () => ({
  managedAgentApi: {
    uploadAttachment: (taskId: string, file: File) => uploadAttachment(taskId, file),
    attachment: async () => null,
    removeAttachment: async () => ({ removed: true }),
    patch: async () => ({}),
    cancel: async () => ({}),
  },
}))

// Every route the composer reads on its own, so a test can see which ones it asked for and when.
const readJson = vi.fn(async (_path: string): Promise<unknown> => [])
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@acorn/plugin-api/client')>()),
  readJson: (path: string) => readJson(path),
}))

const { default: AgentComposer } = await import('./AgentComposer')
const { clearComposerDrafts } = await import('./composerState')
const { selectManagedSession } = await import('../sessions/managedSelection')

const session = {
  id: 's1', taskId: 't1', title: 'A session', config: {}, runtimeState: 'ready', controller: 'acorn',
} as unknown as AgentSession

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose())
  vi.unstubAllGlobals()
  uploadAttachment.mockClear()
  readJson.mockClear()
  // The draft outlives the render now: it is the session's, in a module map (./composerState.ts), so
  // one test's attachment is the next one's starting state.
  clearComposerDrafts()
})

const mount = (options: { session?: () => AgentSession; autoFocus?: boolean; disabled?: boolean } = {}) => {
  const host = document.createElement('div')
  document.body.append(host)
  cleanups.push(render(() => (
    <AgentComposer session={options.session?.() ?? session} autoFocus={options.autoFocus}
      disabled={options.disabled} onSessionUpdated={() => {}} onSent={() => {}} />
  ), host))
  cleanups.push(() => host.remove())
  return host
}

const attachButton = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Attach'))!

describe('composer navigation focus', () => {
  it('focuses on entry and session changes without taking focus on metadata updates', async () => {
    const [current, setCurrent] = createSignal(session)
    const host = mount({ session: current, autoFocus: true })
    const field = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message agent"]')!
    await vi.waitFor(() => expect(document.activeElement).toBe(field))

    const attach = attachButton(host)
    attach.focus()
    setCurrent({ ...session, title: 'Updated title' })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(document.activeElement).toBe(attach)

    setCurrent({ ...session, id: 's2' })
    await vi.waitFor(() => expect(document.activeElement).toBe(field))
    attach.focus()
    selectManagedSession('t1', 's2')
    await vi.waitFor(() => expect(document.activeElement).toBe(field))
  })

  it('focuses when returning to a session while another surface shows its composer', async () => {
    mount()
    const host = mount({ autoFocus: true })
    const field = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message agent"]')!
    await vi.waitFor(() => expect(document.activeElement).toBe(field))
    cleanups.splice(0).forEach((dispose) => dispose())

    const returned = mount({ autoFocus: true })
    await vi.waitFor(() => expect(document.activeElement).toBe(returned.querySelector('textarea')))
  })

  it('leaves focus alone for a disabled composer', async () => {
    const focused = document.createElement('button')
    document.body.append(focused)
    cleanups.push(() => focused.remove())
    focused.focus()
    mount({ autoFocus: true, disabled: true })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(document.activeElement).toBe(focused)
  })
})

describe('attaching files', () => {
  it('keeps the message field focused after a pasted image finishes uploading', async () => {
    const host = mount()
    const field = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message agent"]')!
    field.focus()
    const image = new File(['image'], 'pasted.png', { type: 'image/png' })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: { files: [image] } })

    field.dispatchEvent(paste)

    await vi.waitFor(() => expect(host.textContent).toContain('pasted.png'))
    expect(document.activeElement).toBe(field)
  })

  it('uploads the bytes the host dialog returned', async () => {
    const pick = vi.fn(async (_options: { accept?: readonly string[] }) =>
      [{ name: 'notes.md', type: 'text/markdown', bytes: new Uint8Array([104, 105]) }])
    vi.stubGlobal('window', Object.assign(globalThis.window, { acorn: { files: { pick, save: vi.fn() } } }))

    const host = mount()
    attachButton(host).click()
    await vi.waitFor(() => expect(uploadAttachment).toHaveBeenCalled())

    // Bare extensions, no dots and no media types: the one spelling every host can honour.
    expect(pick.mock.calls[0]?.[0]).toMatchObject({ accept: expect.arrayContaining(['md', 'png', 'pdf']) })
    const [taskId, file] = uploadAttachment.mock.calls[0]!
    expect(taskId).toBe('t1')
    expect(file.name).toBe('notes.md')
    expect(file.type).toBe('text/markdown')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([104, 105]))
  })

  it('shows what one composer attached in every composer open on the session', async () => {
    const pick = vi.fn(async () =>
      [{ name: 'notes.md', type: 'text/markdown', bytes: new Uint8Array([104, 105]) }])
    vi.stubGlobal('window', Object.assign(globalThis.window, { acorn: { files: { pick, save: vi.fn() } } }))

    // What the Workflows run pane and the Agent pane are, side by side on one session.
    const first = mount()
    const second = mount()
    attachButton(first).click()

    await vi.waitFor(() => expect(second.textContent).toContain('notes.md'))
    expect(first.textContent).toContain('notes.md')
    // One upload, and one durable draft. Two component copies of the array meant two writers of the
    // session's localStorage key and an upload that vanished when the other pane saved.
    expect(uploadAttachment).toHaveBeenCalledTimes(1)
  })

  it('uploads nothing when the owner dismisses the dialog', async () => {
    vi.stubGlobal('window', Object.assign(globalThis.window, { acorn: { files: { pick: async () => [], save: vi.fn() } } }))
    const host = mount()
    attachButton(host).click()
    await Promise.resolve()
    expect(uploadAttachment).not.toHaveBeenCalled()
  })
})

describe('the worktree file list', () => {
  const fileReads = () => readJson.mock.calls.filter(([path]) => path.endsWith('/editor/files'))

  it('is not read until the field takes focus, and then once', async () => {
    const host = mount()
    await Promise.resolve()
    expect(fileReads()).toHaveLength(0)

    const field = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message agent"]')!
    field.focus()
    await vi.waitFor(() => expect(fileReads()).toHaveLength(1))
    field.blur()
    field.focus()
    await Promise.resolve()
    expect(fileReads()).toEqual([['/v1/p/editor/tasks/t1/editor/files']])
  })
})
