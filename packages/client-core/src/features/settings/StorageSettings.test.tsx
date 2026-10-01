import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeStorageReport } from '@acorn/protocol/api.ts'

// The page polls while it is open and stops when it closes, and Clear cache clears the node the
// settings header names. What clearing does to the cache is fleet.test.ts's; this pins that the
// button reaches it.
const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  saved: vi.fn(),
  clear: vi.fn(async () => {}),
}))
vi.mock('../../infra/node/nodeStorage', () => ({ nodeStorageReport: mocks.report }))
vi.mock('../../infra/node/fleet', () => ({
  ORIGIN_NODE_ID: 'origin',
  nodes: () => [{ nodeId: 'node-1', label: 'Studio', endpoint: '', local: true }],
  persistedCacheSize: mocks.saved,
  clearNodeCache: mocks.clear,
}))

import StorageSettings from './StorageSettings'

const REPORT: NodeStorageReport = {
  rssBytes: 300 * 1024 * 1024,
  coreDatabaseBytes: 5 * 1024 * 1024,
  pluginDatabases: [{ plugin: 'agents', bytes: 1300 * 1024 * 1024 }],
  blobCacheBytes: 40 * 1024 * 1024,
}

let host: HTMLElement
let dispose: () => void

const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  mocks.report.mockReset().mockResolvedValue(REPORT)
  mocks.saved.mockReset().mockResolvedValue({ bytes: 1_300_000, entries: 143 })
  mocks.clear.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <StorageSettings nodeId="node-1" />, host)
})

afterEach(() => {
  dispose()
  host.remove()
  vi.useRealTimers()
})

describe('Settings → Storage and memory', () => {
  it('draws the node\'s numbers and this device\'s saved cache', async () => {
    await settle()
    const text = host.textContent ?? ''
    expect(text).toContain('about 300 MB')
    expect(text).toContain('agents plugin')
    expect(text).toContain('1.3 GB')
    expect(text).toContain('40 MB')
    expect(text).toContain('143')
  })

  it('reads every five seconds while open, and stops when the page closes', async () => {
    await settle()
    expect(mocks.report).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(mocks.report).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.report).toHaveBeenCalledTimes(2)
    dispose()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.report).toHaveBeenCalledTimes(2)
    dispose = () => {}
  })

  it('clears the cache of the node on screen and reads the sizes again', async () => {
    await settle()
    mocks.saved.mockResolvedValue(null)
    const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes("Clear this node's copy"))!
    button.click()
    await settle()
    expect(mocks.clear).toHaveBeenCalledWith('node-1')
    expect(host.textContent).toContain('Nothing is saved for this node.')
  })
})
