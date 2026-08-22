import { describe, expect, it, vi } from 'vitest'
import { SEAM_GROUPS, seamProblems } from '@acorn/client-core/platform/contract.ts'

// The Electron half of the platform-seam contract (docs/future/tauri/testing.md): the real preload,
// loaded headless against a stub Electron, checked by the same checker client-core drives against a
// mock. This is the side that catches a renamed channel or a dropped key — the preload writes the
// global and the seam reads it, and nothing between them is type-checked.

const bridge = vi.hoisted(() => ({ exposed: {} as Record<string, unknown>, key: '' }))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: Record<string, unknown>) => {
      bridge.key = key
      bridge.exposed = value
    },
  },
  ipcRenderer: { on: () => {}, removeListener: () => {}, send: () => {}, invoke: async () => undefined },
}))

await import('./preload')

describe('the preload satisfies the platform seam', () => {
  it('exposes the host under the name the seam reads', () => {
    expect(bridge.key).toBe('acorn')
  })

  it('implements every group', () => {
    vi.stubGlobal('window', { acorn: bridge.exposed })
    // The Electron shell is the one host that implements all of them; a shell that drops a group
    // (docs/future/tauri/sequencing.md § Phase 2) passes a shorter list instead.
    expect(seamProblems(SEAM_GROUPS)).toEqual([])
    vi.unstubAllGlobals()
  })
})
