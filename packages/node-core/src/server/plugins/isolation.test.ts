import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { MessageChannel, Worker } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { isSupportedNodeRuntime, NODE_RUNTIME_RANGE } from '@acorn/protocol/nodeRuntime.ts'
import { isolateNodePlugin } from './isolation'
import { preparePluginDbFiles } from './storage'

vi.mock('node:fs', async (original) => ({
  ...await original<typeof import('node:fs')>(),
  existsSync: vi.fn(),
  realpathSync: vi.fn(),
}))
vi.mock('node:worker_threads', async (original) => ({
  ...await original<typeof import('node:worker_threads')>(),
  MessageChannel: vi.fn(),
  Worker: vi.fn(),
}))
vi.mock('./storage', () => ({ pluginDbPath: vi.fn(), preparePluginDbFiles: vi.fn() }))

const versionDescriptor = Object.getOwnPropertyDescriptor(process.versions, 'node')!
afterEach(() => {
  Object.defineProperty(process.versions, 'node', versionDescriptor)
  vi.clearAllMocks()
})

it.each(['22.23.1', '24.18.0', '26.5.0', '25.99.0', '28.0.0'])(
  'refuses loaded Node workers on %s before filesystem, storage, or realm side effects', async (version) => {
    Object.defineProperty(process.versions, 'node', { ...versionDescriptor, value: version })
    await expect(isolateNodePlugin({
      entrypoint: '/unresolved/plugin/index.mjs',
      pluginDir: '/unresolved/plugin',
      plugin: 'test',
      dataRoot: '/unresolved/data',
      migrationsFolder: '/unresolved/migrations',
      permissions: { core: [], capabilities: [], secrets: false, net: [], exec: false, sockets: false },
    })).rejects.toThrow('Upgrade Node before loading plugins')
    expect(existsSync).not.toHaveBeenCalled()
    expect(realpathSync).not.toHaveBeenCalled()
    expect(preparePluginDbFiles).not.toHaveBeenCalled()
    expect(MessageChannel).not.toHaveBeenCalled()
    expect(Worker).not.toHaveBeenCalled()
  },
)

it('keeps distributed runtime requirements aligned with the shared worker policy', () => {
  const root = JSON.parse(readFileSync(new URL('../../../../../package.json', import.meta.url), 'utf8'))
  const tui = JSON.parse(readFileSync(new URL('../../../../../apps/tui/package.json', import.meta.url), 'utf8'))
  const pin = JSON.parse(readFileSync(new URL('../../../../../node-runtime.json', import.meta.url), 'utf8'))
  expect(root.engines.node).toBe(NODE_RUNTIME_RANGE)
  expect(tui.engines.node).toBe(NODE_RUNTIME_RANGE)
  expect(pin.engines).toBe(NODE_RUNTIME_RANGE)
  expect(isSupportedNodeRuntime(pin.version)).toBe(true)
})
