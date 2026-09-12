import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandExecutionContext, ContributedCommand, SearchCommand } from '@acorn/plugin-api/client'

const mocks = vi.hoisted(() => ({
  containers: vi.fn(),
  refreshDocker: vi.fn(),
  fetchImages: vi.fn(),
  fetchVolumes: vi.fn(),
  fetchNetworks: vi.fn(),
  setSelectedSource: vi.fn(),
}))
vi.mock('./dockerStore', () => ({ containers: mocks.containers, refreshDocker: mocks.refreshDocker }))
vi.mock('./dockerClient', () => ({
  fetchImages: mocks.fetchImages, fetchVolumes: mocks.fetchVolumes, fetchNetworks: mocks.fetchNetworks,
}))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  setSelectedSource: mocks.setSelectedSource,
}))

import { dockerCommands } from './commands'
import { consumeDockerReveal } from './dockerViewStore'

// One search over the four things the daemon holds, and where picking one lands. What is pinned is the
// namespacing — a volume is keyed by its name and everything else by an id, so a bare id could collide
// — and that a pick names the rail source rather than the task pane, which only ever draws containers.

const context = (): CommandExecutionContext => ({
  host: 'desktop', nodeId: 'node-1', workspaceId: 'w-1', projectId: null, taskId: null, paneId: null, surfaceId: null,
})
const signal = (): AbortSignal => new AbortController().signal

const at = (id: string): ContributedCommand => dockerCommands.find((command) => command.id === id)!
const find = (): SearchCommand => at('docker.find') as SearchCommand

describe('the docker plugin catalogue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consumeDockerReveal()
    mocks.refreshDocker.mockResolvedValue(undefined)
    mocks.containers.mockReturnValue([
      { id: 'c1', name: 'acorn-db', image: 'postgres:16', composeProject: 'acorn', state: 'running' },
    ])
    mocks.fetchImages.mockResolvedValue([{ id: 'i1', repository: 'postgres', tag: '16', size: '400MB' }])
    mocks.fetchVolumes.mockResolvedValue([{ name: 'acorn_pgdata', driver: 'local' }])
    mocks.fetchNetworks.mockResolvedValue([{ id: 'n1', name: 'acorn_default', driver: 'bridge' }])
  })

  it('is one open action and one node-scoped search, both gated on the plugin', () => {
    expect(dockerCommands.map((command) => command.id)).toEqual(['source.docker.open', 'docker.find'])
    for (const command of dockerCommands) {
      expect(command.requires, command.id).toEqual({ plugin: 'docker' })
      expect(command.scope, command.id).toBe('none')
      expect(command.palette, command.id).toBe(true)
    }
    expect(find().debounceMs).toBe(0)
    expect(find().minQueryLength).toBe(0)
  })

  it('opens the rail source', () => {
    ;(at('source.docker.open') as { run: (c: CommandExecutionContext) => void }).run(context())
    expect(mocks.setSelectedSource).toHaveBeenCalledWith('docker')
  })

  it('lists all four kinds, each badged and namespaced by the list it came from', async () => {
    expect(await find().query('', context(), signal())).toEqual([
      { id: 'containers:c1', title: 'acorn-db', subtitle: 'postgres:16 · acorn', badge: 'container', ref: 'c1' },
      { id: 'images:i1', title: 'postgres:16', subtitle: '400MB', badge: 'image', ref: 'i1' },
      // A volume has no id of its own, so its name is both.
      { id: 'volumes:acorn_pgdata', title: 'acorn_pgdata', subtitle: 'local', badge: 'volume', ref: 'acorn_pgdata' },
      { id: 'networks:n1', title: 'acorn_default', subtitle: 'bridge', badge: 'network', ref: 'n1' },
    ])
  })

  it('reads the four lists once per frame, whatever gets typed', async () => {
    const world = context()
    await find().query('', world, signal())
    expect((await find().query('pgdata', world, signal())).map((row) => row.id)).toEqual(['volumes:acorn_pgdata'])
    expect(mocks.fetchImages).toHaveBeenCalledTimes(1)
    expect(mocks.refreshDocker).toHaveBeenCalledTimes(1)
  })

  it('names the rail source and leaves the browse surface something to land on', async () => {
    const world = context()
    const rows = await find().query('postgres', world, signal())
    const image = rows.find((row) => row.id === 'images:i1')!
    expect(find().select(image, world)).toEqual({ effect: 'close' })
    expect(mocks.setSelectedSource).toHaveBeenCalledWith('docker')
    expect(consumeDockerReveal()).toEqual({ scope: 'images', id: 'i1' })
    // Taken once: a later remount must not jump somewhere the reader has since navigated away from.
    expect(consumeDockerReveal()).toBeNull()
  })
})
