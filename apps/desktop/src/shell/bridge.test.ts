import { describe, expect, it, vi } from 'vitest'
import { SEAM_GROUPS, seamProblems, type SeamGroup } from '@acorn/client-core/infra/platform'

// The shell's half of the platform-seam contract (docs/testing/layers.md § Test
// layers).
// The bridge writes the global and the seam reads it, and nothing between them is type-checked, so
// this is the side that catches a renamed member or a dropped key.
//
// Every group is implemented. A group that stops resolving is a failure here rather than an
// affordance that quietly disappears in the product.

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => undefined),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

// The bridge opens no socket at import time, but it does name `WebSocket`, and this suite runs in node.
vi.stubGlobal('WebSocket', class {})
await import('./bridge')

const IMPLEMENTED: SeamGroup[] = SEAM_GROUPS

describe('the Tauri bridge satisfies the platform seam', () => {
  it('installs the host under the name the seam reads', () => {
    expect((globalThis as { acorn?: unknown }).acorn).toBeTypeOf('object')
  })

  it('implements every group in the seam', () => {
    vi.stubGlobal('window', { acorn: (globalThis as { acorn?: unknown }).acorn })
    expect(seamProblems(IMPLEMENTED)).toEqual([])
    // Nothing is exempt. A group added to the seam and not to this shell fails here rather than in the
    // product.
    expect(IMPLEMENTED).toHaveLength(SEAM_GROUPS.length)
  })
})

// A quit from the tray with the window closed opens a window and waits in the shell. The renderer
// collects it once its quit listener exists, and asks the person as for any other quit.
describe('a quit that arrived with no window', () => {
  const host = () => (globalThis as { acorn?: { onWillQuit(cb: () => boolean): () => void } }).acorn!

  it('asks once the quit listener exists, and gives the shell the answer', async () => {
    invoke.mockImplementation(async (command) => (command === 'take_pending_quit' ? true : undefined))
    const ask = vi.fn(() => true)
    host().onWillQuit(ask)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('quit_approved', { approved: true }))
    expect(ask).toHaveBeenCalledOnce()
  })

  it('asks nothing when no quit is waiting', async () => {
    invoke.mockReset()
    invoke.mockImplementation(async () => false)
    const ask = vi.fn(() => true)
    host().onWillQuit(ask)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('take_pending_quit'))
    expect(ask).not.toHaveBeenCalled()
  })
})
