import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { afterEach, expect, it, vi } from 'vitest'
import type { PanelSubject } from '../../plugins/http/src/tree/panelModel'
import type { SendSuccess } from '../../plugins/http/src/shared/model'

const api = vi.hoisted(() => ({ send: vi.fn(), update: vi.fn() }))
vi.mock('../../plugins/http/src/tree/httpClient', async original => ({
  ...await original<typeof import('../../plugins/http/src/tree/httpClient')>(),
  listRequests: async () => [], createRequest: vi.fn(), deleteRequest: vi.fn(), sendRequest: api.send, updateRequest: api.update,
}))
import { decodeBody } from '../../plugins/http/src/tree/httpClient'
import { _resetHttpPanelModel, httpPanelModel } from '../../plugins/http/src/tree/panelModel'

const records: Record<string, unknown>[] = []
const record = (name: string, values: Record<string, unknown>) => {
  records.push({ name, ...values })
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'
  const path = join(dirname(fileURLToPath(import.meta.url)), `13-http-${tag}.json`)
  if (tag.startsWith('before') && existsSync(path) && records.length === 1) throw new Error('Use another before tag.')
  writeFileSync(path, JSON.stringify({ runtime: process.version, owner: 'actual HTTP model/decode, synthetic API', records }, null, 2) + '\n')
}
const subject = (nodeId = 'node-a') => ({
  bridge: { context: { nodeId }, onSelect: () => () => {}, onSurfaceAction: () => () => {}, ui: { copy: async () => {} } },
  projectId: 'project', taskId: 'task', projectName: 'Synthetic',
} as unknown as PanelSubject)

afterEach(() => { _resetHttpPanelModel(); api.send.mockReset(); api.update.mockReset() })

it('records a response completing after the selected draft changes', async () => {
  const model = httpPanelModel(subject())
  model.patch({ url: 'https://a.invalid/' })
  let finish!: (response: SendSuccess) => void
  api.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const sending = model.fire()
  model.startNew()
  model.patch({ url: 'https://b.invalid/' })
  finish({ ok: true, url: 'https://a.invalid/', status: 200, statusText: 'OK', headers: [], bodyBase64: '',
    size: 0, truncated: false, durationMs: 1, timeline: [], redirected: false })
  await sending
  record('late-response', { currentDraftUrl: model.draft().url, responseUrl: model.result()?.url,
    expected: 'A response must remain bound to its sending draft/selection rather than attach to a newly selected request.' })
  expect(model.result()?.url).toBe('https://a.invalid/')
  expect(model.draft().url).toBe('https://b.invalid/')
})

it('records same subject IDs in a different Node realm', () => {
  const first = httpPanelModel(subject('node-a'))
  first.patch({ url: 'https://a.invalid/' })
  const second = httpPanelModel(subject('node-b'))
  record('subject-node-key', { reusedModelAcrossNodes: first === second, secondUrl: second.draft().url,
    note: 'Module-level characterization only; actual warmed worker reuse belongs to area16.' })
  expect(first).toBe(second)
})

it('measures capped response decoding', () => {
  for (const bytes of [1024 * 1024, 5 * 1024 * 1024]) {
    const encoded = Buffer.alloc(bytes, 120).toString('base64')
    const cpu = process.cpuUsage()
    const heap = process.memoryUsage().heapUsed
    const started = performance.now()
    const decoded = decodeBody(encoded)
    const used = process.cpuUsage(cpu)
    record('decode-body', { bytes, elapsedMs: performance.now() - started, cpuMs: (used.user + used.system) / 1000,
      decodedBytes: decoded.bytes.byteLength, textCharacters: decoded.text.length, heapDeltaBytes: process.memoryUsage().heapUsed - heap,
      note: 'Node/V8 and jsdom atob, not native WebKit. Heap is sampled transient allocation, not a leak.' })
    expect(decoded.bytes.byteLength).toBe(bytes)
    expect(decoded.text).toHaveLength(bytes)
  }
})
