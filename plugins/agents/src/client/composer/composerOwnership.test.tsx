import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import { afterEach, expect, it, vi } from 'vitest'
import { setActiveNode } from '@acorn/plugin-api/testkit/client'
import type { AgentContextContribution, AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import type { AgentAttachment, AgentSession } from '../../contract/wire.ts'
import { composerDraftState, clearComposerDrafts } from './composerState'
import { readComposerPayload } from './composerDraftStorage'

const contextFixture = vi.hoisted(() => ({ contributions: [] as AgentContextContribution[] }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@acorn/plugin-api/client')>()),
  agentContextContributions: () => contextFixture.contributions,
}))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: undefined }) }))
const api = vi.hoisted(() => ({ attachment: vi.fn(), uploadAttachment: vi.fn(), enqueue: vi.fn(), removeAttachment: vi.fn() }))
vi.mock('../sessions/managedClient', () => ({ managedAgentApi: api }))
// A contributor's replace action at the public attachment slot contract.
vi.mock('./AttachmentSlot', () => ({ AttachmentSlot: (props: { attachment: AgentAttachment; onReplace: (value: unknown) => Promise<void> }) =>
  <button onClick={() => void props.onReplace({ expectedAttachmentId: props.attachment.id, replacementAttachmentId: 'replacement' })}>Replace attachment</button>,
}))
import AgentComposer from './AgentComposer'
const disposals: (() => void)[] = []
const row = (id: string): AgentSession => ({ id, taskId: `task-${id}`, kind: 'workflow', config: {}, controller: 'acorn', runtimeState: 'ready' } as AgentSession)
const attachment = (id: string, taskId = 'task-same'): AgentAttachment => ({ id, taskId, filename: `${id}.txt`, mediaType: 'text/plain', byteSize: 1 } as AgentAttachment)
const deferred = <T,>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done }), resolve: (value: T) => resolve(value) } }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const mount = (session: () => AgentSession) => {
  const host = document.createElement('div'); document.body.append(host)
  disposals.push(render(() => <AgentComposer session={session()} onSent={() => {}} onSessionUpdated={() => {}} />, host))
  disposals.push(() => host.remove())
  return host
}
const button = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label))!
afterEach(() => { disposals.splice(0).forEach(dispose => dispose()); clearComposerDrafts(); localStorage.clear(); setActiveNode(null); vi.clearAllMocks(); contextFixture.contributions = []; delete window.acorn })

it('acknowledges the submitted draft while retaining edits and releasing only its shared send guard', async () => {
  setActiveNode('A')
  const a = composerDraftState('same')
  a.setText('submitted')
  a.setAttachments([attachment('submitted-attachment')])
  const sent = deferred<unknown>()
  api.enqueue.mockReturnValue(sent.promise)
  const [current, setCurrent] = createSignal(row('same'))
  const first = mount(current)
  const second = mount(current)
  await tick()
  button(first, 'Send').click()
  await vi.waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1))
  button(second, 'Send').click()
  expect(api.enqueue).toHaveBeenCalledTimes(1)
  a.setText('edited after send')
  a.setAttachments(items => [...items, attachment('added-during-send')])
  setCurrent(row('other'))
  const other = composerDraftState('other')
  other.setText('other unsent')
  sent.resolve({})
  await tick()
  expect(a.text()).toBe('edited after send')
  expect(a.sending()).toBe(false)
  expect(a.attachments().map(item => item.id)).toEqual(['added-during-send'])
  expect(other.text()).toBe('other unsent')
  expect(other.sending()).toBe(false)
  expect(api.enqueue.mock.calls[0][0]).toBe('same')
  expect(api.enqueue.mock.calls[0][1].input).toContainEqual({ type: 'attachment', attachmentId: 'submitted-attachment' })
  expect(api.enqueue.mock.calls[0][3]).toMatchObject({ nodeId: 'A' })
  expect(readComposerPayload('A', 'same').text).toBe('edited after send')
})

it('captures the native picker origin and keeps a held upload in the departing draft', async () => {
  setActiveNode('A')
  const picker = deferred<{ name: string; type: string; bytes: Uint8Array }[]>()
  const uploaded = deferred<AgentAttachment>()
  Object.assign(window, { acorn: { files: { pick: () => picker.promise } } })
  api.uploadAttachment.mockReturnValue(uploaded.promise)
  const host = mount(() => row('same'))
  const second = mount(() => row('same'))
  await tick()
  button(host, 'Attach').click()
  button(second, 'Attach').click()
  const a = composerDraftState('same', 'A')
  expect(a.uploading()).toBe(true)
  setActiveNode('B')
  const b = composerDraftState('same', 'B')
  picker.resolve([{ name: 'held.txt', type: 'text/plain', bytes: new Uint8Array([1]) }])
  await vi.waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledTimes(1))
  expect(api.uploadAttachment.mock.calls[0][2]).toMatchObject({ nodeId: 'A', session: { id: 'same' } })
  uploaded.resolve(attachment('held'))
  await tick()
  expect(a.attachments().map(item => item.id)).toEqual(['held'])
  expect(a.uploading()).toBe(false)
  expect(b.attachments()).toEqual([])
  expect(host.textContent).not.toContain('held.txt')
  clearComposerDrafts()
  expect(composerDraftState('same', 'A').attachmentIds()).toEqual(['held'])
})

it('shares hydration and a held replacement guard across surfaces without swapping the incoming draft', async () => {
  setActiveNode('A')
  const hydrated = deferred<AgentAttachment>()
  const replacement = deferred<AgentAttachment>()
  localStorage.setItem('acorn.agent-attachments.replace-shared', '["original"]')
  api.attachment.mockImplementation((id: string) => id === 'original' ? hydrated.promise : replacement.promise)
  api.removeAttachment.mockResolvedValue({ removed: true })
  const [current, setCurrent] = createSignal(row('replace-shared'))
  const first = mount(current); const second = mount(current)
  expect(api.attachment).toHaveBeenCalledTimes(1)
  hydrated.resolve(attachment('original', 'task-replace-shared'))
  await tick()
  const a = composerDraftState('replace-shared')
  button(first, 'Replace').click()
  expect(a.replacing()).toBe('original')
  a.setText('cannot send during replacement')
  button(second, 'Send').click()
  expect(api.enqueue).not.toHaveBeenCalled()
  setCurrent(row('other'))
  replacement.resolve({ ...attachment('replacement', 'task-replace-shared'), mediaType: 'image/png' })
  await tick()
  expect(a.attachments().map(item => item.id)).toEqual(['replacement'])
  expect(a.replacing()).toBe('')
  expect(composerDraftState('other').attachments()).toEqual([])
  expect(api.removeAttachment.mock.calls[0]).toEqual(['original', expect.objectContaining({ nodeId: 'A' })])
})

it('retains attachment ids after an offline hydration and retries on the next surface', async () => {
  setActiveNode('A')
  localStorage.setItem('acorn.agent-attachments.offline-draft', '["offline-attachment"]')
  api.attachment.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(attachment('offline-attachment'))
  mount(() => row('offline-draft'))
  await tick()
  expect(composerDraftState('offline-draft').attachmentIds()).toEqual(['offline-attachment'])
  mount(() => row('offline-draft'))
  await tick()
  expect(composerDraftState('offline-draft').attachments().map(item => item.id)).toEqual(['offline-attachment'])
})

it('does not reattach consumed fork context when an empty composer remounts', async () => {
  setActiveNode('A')
  const session = { ...row('fork'), config: { pendingForkContext: {
    type: 'context', contextId: 'fork-context', label: 'Fork context', content: 'Prior conversation',
  } } } as AgentSession
  api.enqueue.mockResolvedValue({})
  const first = mount(() => session)
  await tick()
  const state = composerDraftState('fork')
  expect(state.contexts()).toHaveLength(1)
  state.setText('Continue')
  button(first, 'Send').click()
  await vi.waitFor(() => expect(state.contexts()).toEqual([]))
  disposals.splice(0).forEach(dispose => dispose())
  mount(() => session)
  await tick()
  expect(composerDraftState('fork').contexts()).toEqual([])
  expect(api.enqueue).toHaveBeenCalledTimes(1)
})


it('keeps a held automatic capture with its originating session and discards it after a Node switch', async () => {
  setActiveNode('A')
  const first = deferred<AgentContextSnapshot[]>()
  const second = deferred<AgentContextSnapshot[]>()
  const capture = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  contextFixture.contributions = [{
    id: 'acorn-task-context', source: 'context.task', label: 'Task context',
    options: async () => [], capture,
  }]
  const [current, setCurrent] = createSignal({ ...row('first'), kind: 'interactive' as const })
  mount(current)
  expect(capture).toHaveBeenCalledWith({ taskId: 'task-first' })
  setCurrent({ ...row('second'), kind: 'interactive' })
  expect(capture).toHaveBeenCalledWith({ taskId: 'task-second' })
  first.resolve([{ type: 'context', contextId: 'first', label: 'First', content: 'first', source: 'context.task', capturedAt: 1 }])
  await tick()
  expect(composerDraftState('first', 'A').contexts()).toHaveLength(1)
  expect(composerDraftState('second', 'A').contexts()).toEqual([])
  setActiveNode('B')
  second.resolve([{ type: 'context', contextId: 'second', label: 'Second', content: 'second', source: 'context.task', capturedAt: 1 }])
  await tick()
  expect(composerDraftState('second', 'A').contexts()).toEqual([])
  expect(composerDraftState('second', 'B').contexts()).toEqual([])
})
