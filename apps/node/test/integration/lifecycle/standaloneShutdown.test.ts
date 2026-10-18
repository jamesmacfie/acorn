import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startStandalone, stopStandalone, type StandaloneNode } from '../../helpers/standalone'

// Generous relative to the 30s deadline the drain itself carries. The point is to catch a hang, not
// to police the drain's speed on a loaded runner (AGENTS.md § Test and lint quickly).
const EXIT_BUDGET_MS = 25_000

describe('a standalone node drains on SIGTERM', () => {
  let node: StandaloneNode | null = null
  let dataDir: string | null = null

  afterEach(() => {
    node?.child.kill('SIGKILL')
    node = null
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
    dataDir = null
  })

  it('exits cleanly, and releases the data root so the next start can take the lock', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-standalone-'))
    node = startStandalone(dataDir)
    await node.ready
    // A standalone Node has no keychain, so it says where its keys are (docs/security.md).
    expect(node.stderr()).toContain('agents it runs can read them')

    const code = await stopStandalone(node.child, EXIT_BUDGET_MS)
    expect(code).toBe(0)

    // The lock is the observable half of "the drain finished in the right order": openDataRoot refuses a
    // root whose recorded pid is still live, so a second node starting here proves the first let go.
    const second = startStandalone(dataDir)
    node = second
    await expect(second.ready).resolves.toMatchObject({ endpoint: expect.stringContaining('https://127.0.0.1:') })
    expect(await stopStandalone(second.child, EXIT_BUDGET_MS)).toBe(0)
    node = null
  }, 180_000)
})
