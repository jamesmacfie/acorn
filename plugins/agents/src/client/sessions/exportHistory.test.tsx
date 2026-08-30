import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'
import type { Task } from '@acorn/plugin-api/client'

// Exporting a transcript, end to end through the platform seam. Like the composer's attach test, the
// stub is a host on `window.acorn` rather than a mocked module, so the real `saveFile` is what runs.

const exportSession = vi.fn(async (_sessionId: string, _format: string) => ({ content: '# A session\n' }))
vi.mock('./managedClient', () => ({
  managedAgentApi: {
    export: (sessionId: string, format: string) => exportSession(sessionId, format),
    providers: async () => [],
  },
}))

const { createAgentPaneModel } = await import('./agentPaneModel')
const { managedAgentStore } = await import('./managedStore')

const session = {
  id: 's1',
  taskId: 't1',
  // Spaces and a slash, so the sanitiser has something to do.
  title: 'Fix the login/logout flow',
  config: {},
  createdAt: 1,
  controller: 'acorn',
  runtimeState: 'ready',
} as unknown as AgentSession

const saveSpy = () => vi.fn(async (_request: { bytes: Uint8Array; suggestedName: string; mimeType: string }) => true)

afterEach(() => {
  vi.unstubAllGlobals()
  exportSession.mockClear()
})

const runExport = async (id: 'export-markdown' | 'export-json') =>
  await new Promise<void>((resolve) => {
    createRoot((dispose) => {
      managedAgentStore.upsertSession(session)
      const model = createAgentPaneModel({ id: 't1' } as Task)
      model.sessionActions().find((entry) => entry.id === id)!.run()
      queueMicrotask(() => { dispose(); resolve() })
    })
  })

describe('exporting a session transcript', () => {
  it('hands the host the bytes, the type, and a filesystem-safe name', async () => {
    const save = saveSpy()
    vi.stubGlobal('window', { acorn: { files: { pick: vi.fn(), save } } })

    await runExport('export-markdown')
    await vi.waitFor(() => expect(save).toHaveBeenCalled())

    const request = save.mock.calls[0]![0]
    expect(new TextDecoder().decode(request.bytes)).toBe('# A session\n')
    expect(request.mimeType).toBe('text/markdown')
    expect(request.suggestedName).toBe('Fix-the-login-logout-flow.md')
  })

  it('names the JSON export for its own format', async () => {
    const save = saveSpy()
    vi.stubGlobal('window', { acorn: { files: { pick: vi.fn(), save } } })

    await runExport('export-json')
    await vi.waitFor(() => expect(save).toHaveBeenCalled())

    const request = save.mock.calls[0]![0]
    expect(request.mimeType).toBe('application/json')
    expect(request.suggestedName).toBe('Fix-the-login-logout-flow.json')
  })
})
