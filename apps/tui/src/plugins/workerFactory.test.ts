import { existsSync, realpathSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { _setWorkerFactory } from '@acorn/client-core/host/tree/workerHost.ts'
import { installPluginWorkers } from './workerFactory'
import { bundlePath } from './custody'

vi.mock('node:fs', async (original) => ({
  ...await original<typeof import('node:fs')>(),
  existsSync: vi.fn(),
  realpathSync: vi.fn(),
}))
vi.mock('node:worker_threads', () => ({ Worker: vi.fn() }))
vi.mock('@acorn/client-core/host/tree/workerHost.ts', () => ({ _setWorkerFactory: vi.fn() }))
vi.mock('./custody', () => ({ bundlePath: vi.fn() }))

const versionDescriptor = Object.getOwnPropertyDescriptor(process.versions, 'node')!
afterEach(() => {
  Object.defineProperty(process.versions, 'node', versionDescriptor)
  vi.clearAllMocks()
})

it.each(['22.23.1', '24.18.0', '26.5.0', '25.99.0', '28.0.0'])(
  'refuses loaded TUI workers on %s before custody, filesystem, or realm side effects', (version) => {
    Object.defineProperty(process.versions, 'node', { ...versionDescriptor, value: version })
    installPluginWorkers()
    const factory = vi.mocked(_setWorkerFactory).mock.calls[0]![0]
    if (!factory) throw new Error('The terminal plugin worker factory was not installed')
    expect(() => factory('/plugins/client/hash.js')).toThrow('Upgrade Node before loading plugins')
    expect(bundlePath).not.toHaveBeenCalled()
    expect(existsSync).not.toHaveBeenCalled()
    expect(realpathSync).not.toHaveBeenCalled()
    expect(Worker).not.toHaveBeenCalled()
  },
)
