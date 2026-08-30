import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'

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

const { default: AgentComposer } = await import('./AgentComposer')

const session = {
  id: 's1', taskId: 't1', title: 'A session', config: {}, runtimeState: 'ready', controller: 'acorn',
} as unknown as AgentSession

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose())
  vi.unstubAllGlobals()
  uploadAttachment.mockClear()
})

const mount = () => {
  const host = document.createElement('div')
  document.body.append(host)
  cleanups.push(render(() => (
    <AgentComposer session={session} onSessionUpdated={() => {}} onSent={() => {}} />
  ), host))
  cleanups.push(() => host.remove())
  return host
}

const attachButton = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Attach'))!

describe('attaching files', () => {
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

  it('uploads nothing when the owner dismisses the dialog', async () => {
    vi.stubGlobal('window', Object.assign(globalThis.window, { acorn: { files: { pick: async () => [], save: vi.fn() } } }))
    const host = mount()
    attachButton(host).click()
    await Promise.resolve()
    expect(uploadAttachment).not.toHaveBeenCalled()
  })
})
