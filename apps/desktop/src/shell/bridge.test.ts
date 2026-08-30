import { describe, expect, it, vi } from 'vitest'
import { SEAM_GROUPS, seamProblems, type SeamGroup } from '@acorn/client-core/infra/platform/contract.ts'

// The shell's half of the platform-seam contract (docs/testing.md § Test
// layers).
// The bridge writes the global and the seam reads it, and nothing between them is type-checked, so
// this is the side that catches a renamed member or a dropped key.
//
// Every group is implemented. A group that stops resolving is a failure here rather than an
// affordance that quietly disappears in the product.

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => undefined }))
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
    // Phase 3 closed the last two, so there is nothing left to exempt. A group added to the seam and
    // not to this shell fails here rather than in the product.
    expect(IMPLEMENTED).toHaveLength(SEAM_GROUPS.length)
  })
})
