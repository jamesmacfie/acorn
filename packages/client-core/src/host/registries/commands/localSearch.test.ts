import { describe, expect, it } from 'vitest'
import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import type { CommandExecutionContext } from './commands'
import { localSearch } from './localSearch'

// The load-once adapter, which is what the two `paletteRows` contributions become when they migrate.
// What is worth pinning is the thing that makes it worth having: one fetch per session, whatever the
// reader types.

const CONTEXT: CommandExecutionContext = {
  host: 'desktop', nodeId: 'node-1', workspaceId: 'w-1', projectId: 'p-1', taskId: 't-1',
  paneId: null, surfaceId: null,
}

const item = (id: string, over: Partial<CommandSearchItem> = {}): CommandSearchItem => ({ id, title: id, ...over })

const signal = (): AbortSignal => new AbortController().signal

describe('a local search', () => {
  it('fetches once per session and filters the rest in here', async () => {
    let loads = 0
    const search = localSearch(() => {
      loads += 1
      return [item('dev', { subtitle: 'pnpm dev' }), item('build'), item('test')]
    })
    expect(search.minQueryLength).toBe(0)
    expect(search.debounceMs).toBe(0)

    expect((await search.query('', CONTEXT, signal())).map((row) => row.id)).toEqual(['dev', 'build', 'test'])
    expect((await search.query('bu', CONTEXT, signal())).map((row) => row.id)).toEqual(['build'])
    // The subtitle counts, so a target found by its command line is still found.
    expect((await search.query('pnpm', CONTEXT, signal())).map((row) => row.id)).toEqual(['dev'])
    expect(loads).toBe(1)
  })

  it('loads again for the next session, and after a failure', async () => {
    let loads = 0
    const search = localSearch(() => {
      loads += 1
      if (loads === 1) throw new Error('the node was not there')
      return [item('dev')]
    })

    await expect(search.query('', CONTEXT, signal())).rejects.toThrow('the node was not there')
    // Not cached: pressing Enter on the failure asks again rather than replaying the same rejection.
    expect((await search.query('', CONTEXT, signal())).map((row) => row.id)).toEqual(['dev'])
    expect(loads).toBe(2)

    await search.query('', { ...CONTEXT, taskId: 't-2' }, signal())
    expect(loads).toBe(3)
  })
})
