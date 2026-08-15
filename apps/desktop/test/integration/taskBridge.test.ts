import { afterEach, describe, expect, it } from 'vitest'
import { capabilities } from '@acorn/client-core/capabilities.ts'
import { canPickFolder, pickFolder } from '@acorn/client-core/platform/index.ts'
import { taskBridge } from '@acorn/client-core/tasks/taskBridge.ts'
import { terminalApi } from '@acorn/plugin-terminal/client/terminalClient.ts'

// The probe split (git history: docs/future/node-first/platform-seam.md § The fix, item 3).
//
// This file used to assert the opposite: that `window.acorn.terminal` — a preload key whose entire
// contents were a native folder dialog — was "the single probe behind BOTH typed accessors and core's
// capability map", and it pinned all three together so they could not drift. They agreed, and they were
// all wrong. The terminal drawer, agents, run targets and workflows are `/v2` + WebSocket surfaces
// against the node; gating them on an Electron dialog hid them from every other host and left them
// visible on a desktop whose node had the terminal plugin turned off.
//
// So the thing to pin now is that the two questions stay SEPARATE:
//   "can this host open a folder dialog"  → the platform seam, per-host
//   "does this node run terminals"        → the node's plugin roster, per-node
// and that neither one can quietly start gating the other again.
const setHost = (folderPath: unknown) => {
  ;(globalThis as { window?: unknown }).window =
    folderPath === undefined ? {} : { acorn: { desktop: true, folderPath } }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('the folder picker is a desktop extra, not a feature gate', () => {
  it('reports itself absent without a host, and takes nothing else down with it', () => {
    setHost(undefined)
    expect(canPickFolder()).toBe(false)
    expect(capabilities().desktop).toBe(false)
    // The regression this whole split exists to prevent.
    expect(capabilities().terminal).toBe(true)
    expect(taskBridge()).not.toBeNull()
    expect(terminalApi()).not.toBeNull()
  })

  it('routes the picker through the host, not HTTP', async () => {
    let picked = 0
    setHost({ pick: async () => { picked += 1; return '/repo' } })
    expect(canPickFolder()).toBe(true)
    await expect(pickFolder()).resolves.toBe('/repo')
    expect(picked).toBe(1)
  })

  it('flattens a cancelled dialog and an absent one to the same answer', async () => {
    setHost({ pick: async () => null })
    await expect(pickFolder()).resolves.toBeNull()
    setHost(undefined)
    await expect(pickFolder()).resolves.toBeNull()
  })
})

describe('taskBridge', () => {
  it('exposes the task-lifecycle and agent-delivery surface core consumers need', () => {
    setHost(undefined)
    const api = taskBridge()
    expect(typeof api.task.archive).toBe('function')
    expect(typeof api.task.onCreated).toBe('function')
    expect(typeof api.project.get).toBe('function')
    expect(typeof api.task.statuses).toBe('function')
    expect(typeof api.sendToAgent).toBe('function')
    expect(typeof api.previewUrl).toBe('function')
  })

  // It has no business carrying the dialog: nothing else on it is host-shaped, and holding one
  // host-shaped method is exactly what let the null return gate everything else.
  it('no longer carries the folder picker', () => {
    expect('folderPath' in taskBridge()).toBe(false)
  })
})
