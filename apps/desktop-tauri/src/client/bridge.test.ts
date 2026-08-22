import { describe, expect, it, vi } from 'vitest'
import { SEAM_GROUPS, seamProblems, type SeamGroup } from '@acorn/client-core/platform/contract.ts'

// The Tauri half of the platform-seam contract, the counterpart to
// `apps/desktop/src/app/main/preload.test.ts` (docs/future/tauri/testing.md § Seam contract tests).
// The bridge writes the global and the seam reads it, and nothing between them is type-checked, so
// this is the side that catches a renamed member or a dropped key.
//
// It also pins what this shell does NOT implement. A group that resolves anyway is a failure, not a
// bonus: consumers probe the group and then call its members, so half a group is worse than none.

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => undefined }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

// The bridge opens no socket at import time, but it does name `WebSocket`, and this suite runs in node.
vi.stubGlobal('WebSocket', class {})
await import('./bridge')

const IMPLEMENTED: SeamGroup[] = ['desktop', 'transport', 'fleet', 'pairing', 'plugins', 'desktopExtras', 'folderPicker', 'recovery']

describe('the Tauri bridge satisfies the platform seam', () => {
  it('installs the host under the name the seam reads', () => {
    expect((globalThis as { acorn?: unknown }).acorn).toBeTypeOf('object')
  })

  it('implements every group except the two phase 3 owns', () => {
    vi.stubGlobal('window', { acorn: (globalThis as { acorn?: unknown }).acorn })
    expect(seamProblems(IMPLEMENTED)).toEqual([])
    // Named rather than derived, so adding preview or webviews to the bridge without adding them here
    // fails instead of silently widening what this shell claims.
    expect(SEAM_GROUPS.filter((group) => !IMPLEMENTED.includes(group))).toEqual(['preview', 'webviews'])
  })
})
