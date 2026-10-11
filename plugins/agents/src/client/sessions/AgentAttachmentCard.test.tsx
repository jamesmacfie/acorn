import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extensionPointRegistry,
  extensionRegistry,
  setActiveNode,
  type Disposable,
  type ExtensionContribution,
} from '@acorn/plugin-api/testkit/client'
import { AGENT_TRANSCRIPT_ATTACHMENT_POINT, type TranscriptMediaProps } from '../../contract/transcriptMedia.ts'
import type { AgentAttachment } from '../../contract/wire.ts'

// A sent attachment's tile and the `agents:transcript-attachment` point inside it. Slot arbitration is
// client-core's to test. What is this plugin's: the tile resolves the attachment before it picks a renderer,
// keys it by media type, hands over the transcript's own task and session, and keeps the filename, size and
// download outside whatever a plugin draws.

const attachment = vi.fn()
const attachmentPreview = vi.fn()
const attachmentContent = vi.fn()
const saveFile = vi.fn()

vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: {} }) }))
vi.mock('./managedClient', () => ({ managedAgentApi: { attachment, attachmentPreview, attachmentContent } }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@acorn/plugin-api/client')>()),
  saveFile,
}))

const { default: AgentAttachmentCard } = await import('./AgentAttachmentCard')

const row = (id: string, filename: string, mediaType: string): AgentAttachment => ({
  id,
  taskId: 'task-1',
  filename,
  mediaType,
  byteSize: 2048,
  createdAt: 1,
})

// The media leases are one cache for the module (./agentMediaStore.ts), so each test names its own ids.
const seen: TranscriptMediaProps[] = []
const registered: Disposable[] = []
const hosts: Array<() => void> = []

afterEach(() => {
  for (const dispose of hosts.splice(0).reverse()) dispose()
  for (const disposable of registered.splice(0).reverse()) disposable.dispose()
  seen.length = 0
  setActiveNode(null)
  vi.clearAllMocks()
})

const point = () =>
  registered.push(
    extensionPointRegistry.register({
      id: AGENT_TRANSCRIPT_ATTACHMENT_POINT,
      ownerId: 'agents',
      label: 'Sent attachment',
      kind: 'remote',
      mode: 'replace',
      max: 1,
    }),
  )

const contributor = (pluginId: string, matches: string[]) =>
  registered.push(
    extensionRegistry.register({
      id: `plugin:${pluginId}:transcript-attachment`,
      pluginId,
      point: AGENT_TRANSCRIPT_ATTACHMENT_POINT,
      label: `${pluginId} viewer`,
      order: 500,
      carrier: 'component',
      matches,
      component: (props: TranscriptMediaProps) => {
        seen.push({ ...props })
        return (
          <span>
            drawn by {pluginId} for {props.media.id}
          </span>
        )
      },
    } as ExtensionContribution),
  )

const draw = (attachmentId: () => string, transcript = true) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(
    () => (
      <AgentAttachmentCard
        attachmentId={attachmentId()}
        transcript={transcript ? { taskId: 'task-1', sessionId: 'session-1' } : undefined}
      />
    ),
    host,
  )
  hosts.push(() => {
    dispose()
    host.remove()
  })
  return host
}

describe('a sent attachment', () => {
  it('draws its own tile when nobody draws the type', async () => {
    attachment.mockResolvedValue(row('t0a', 'notes.txt', 'text/plain'))
    point()
    const host = draw(() => 't0a')
    await vi.waitFor(() => expect(host.textContent).toContain('notes.txt'))
    expect(host.querySelector('[title="notes.txt · 2 KiB"]')).not.toBeNull()
  })

  it('hands the body to a plugin and keeps the name, size and download outside it', async () => {
    attachment.mockResolvedValue(row('t1a', 'data.json', 'application/json'))
    attachmentContent.mockResolvedValue({
      bytes: Uint8Array.from([123, 125]),
      type: 'application/json',
      filename: 'data.json',
    })
    point()
    contributor('json', ['application/json'])
    const host = draw(() => 't1a')
    await vi.waitFor(() => expect(host.textContent).toContain('drawn by json for t1a'))
    expect(seen.at(-1)).toEqual({
      taskId: 'task-1',
      sessionId: 'session-1',
      media: { kind: 'attachment', id: 't1a', filename: 'data.json', mediaType: 'application/json', byteSize: 2048 },
    })
    expect(host.textContent).toContain('2 KiB · Download →')
    host.querySelector<HTMLElement>('[role="button"]')?.click()
    await vi.waitFor(() =>
      expect(saveFile).toHaveBeenCalledWith({
        bytes: Uint8Array.from([123, 125]),
        mimeType: 'application/json',
        suggestedName: 'data.json',
      }),
    )
  })

  it('fetches no thumbnail while a plugin draws an image', async () => {
    attachment.mockResolvedValue(row('t2a', 'shot.png', 'image/png'))
    point()
    contributor('pixels', ['image/png'])
    const host = draw(() => 't2a')
    await vi.waitFor(() => expect(host.textContent).toContain('drawn by pixels'))
    expect(attachmentPreview).not.toHaveBeenCalled()
  })

  // The queue's turns are still editable, and their attachments can change before they are sent.
  it('leaves the queue’s editable turns on the plain tile', async () => {
    attachment.mockResolvedValue(row('t3a', 'data.json', 'application/json'))
    point()
    contributor('json', ['application/json'])
    const host = draw(() => 't3a', false)
    await vi.waitFor(() => expect(host.textContent).toContain('data.json'))
    expect(host.textContent).not.toContain('drawn by')
  })

  // A replaced tile must not briefly draw the previous attachment's answer.
  it('drops a late answer for the attachment it no longer shows', async () => {
    let finishFirst!: (value: AgentAttachment) => void
    attachment.mockImplementation((id: string) =>
      id === 't4a'
        ? new Promise((resolve) => {
            finishFirst = resolve
          })
        : Promise.resolve(row('t4b', 'second.json', 'application/json')),
    )
    point()
    contributor('json', ['application/json'])
    const [id, setId] = createSignal('t4a')
    const host = draw(id)
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'))
    setId('t4b')
    await vi.waitFor(() => expect(host.textContent).toContain('drawn by json for t4b'))
    finishFirst(row('t4a', 'first.json', 'application/json'))
    await Promise.resolve()
    expect(host.textContent).not.toContain('t4a')
    expect(seen.every((props) => props.media.id === 't4b')).toBe(true)
  })

  it('reads the attachment again from the Node it switched to', async () => {
    attachment.mockImplementation((id: string, origin: { nodeId: string | null }) =>
      Promise.resolve(row(id, `${origin.nodeId}.json`, 'application/json')),
    )
    setActiveNode('node-A')
    point()
    contributor('json', ['application/json'])
    const host = draw(() => 't5a')
    await vi.waitFor(() => expect(seen.at(-1)?.media.filename).toBe('node-A.json'))
    setActiveNode('node-B')
    await vi.waitFor(() => expect(seen.at(-1)?.media.filename).toBe('node-B.json'))
    expect(host.textContent).toContain('node-B.json')
    expect(attachment.mock.calls.map(([, origin]) => origin.nodeId)).toEqual(['node-A', 'node-B'])
  })
})
