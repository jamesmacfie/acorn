import { afterEach, describe, expect, it } from 'vitest'
import { capabilities } from '@acorn/client-core/capabilities.ts'
import { taskBridge } from '@acorn/client-core/tasks/taskBridge.ts'
import { terminalApi } from '@acorn/plugin-terminal/client/terminalClient.ts'

// The desktop-detection contract. `window.acorn.terminal` is the single probe behind BOTH typed
// accessors and core's capability map: every consumer's `if (!api) return` guard, and every pane's
// `requires: 'terminal'`, key off it. If the two accessors ever disagree, panes render as available
// off-desktop (`dev:node` in a plain browser) and then throw on first use — so pin all three to the
// same probe here. This is the check that survives splitting the bridge in two.
const setBridge = (value: unknown) => {
  ;(globalThis as { window?: unknown }).window = value === undefined ? {} : { acorn: { desktop: true, terminal: value } }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('desktop bridge detection', () => {
  it('both accessors and the capability map agree when the bridge is absent', () => {
    setBridge(undefined)
    expect(taskBridge()).toBeNull()
    expect(terminalApi()).toBeNull()
    expect(capabilities().terminal).toBe(false)
  })

  it('both accessors and the capability map agree when the bridge is present', () => {
    setBridge({ repoPath: { pick: async () => null } })
    expect(taskBridge()).not.toBeNull()
    expect(terminalApi()).not.toBeNull()
    expect(capabilities().terminal).toBe(true)
  })

  it('taskBridge routes the folder picker through the preload bridge, not HTTP', async () => {
    let picked = 0
    setBridge({ repoPath: { pick: async () => { picked += 1; return '/repo' } } })
    await expect(taskBridge()!.repoPath.pick()).resolves.toBe('/repo')
    expect(picked).toBe(1)
  })

  it('exposes the task-lifecycle and agent-delivery surface core consumers need', () => {
    setBridge({ repoPath: { pick: async () => null } })
    const api = taskBridge()!
    expect(typeof api.task.archive).toBe('function')
    expect(typeof api.task.onCreated).toBe('function')
    expect(typeof api.task.useCheckout).toBe('function')
    expect(typeof api.task.statuses).toBe('function')
    expect(typeof api.sendToAgent).toBe('function')
    expect(typeof api.previewUrl).toBe('function')
  })
})
