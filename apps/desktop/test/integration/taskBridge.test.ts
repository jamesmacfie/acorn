import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasHostCapability, refreshNodePlugins } from '@acorn/client-core/infra/node'
import { canPickFolder, pickFolder } from '@acorn/client-core/infra/platform'
import { taskBridge } from '@acorn/client-core/features/tasks'
import { terminalApi } from '@acorn/plugin-terminal/testkit/client'

// The probe split, from the node-first platform seam design (in Git history).
//
// This file used to assert the opposite: that `window.acorn.terminal`, a preload key whose entire
// contents were a native folder dialog, was "the single probe behind both typed accessors and core's
// capability map", and it pinned all three together so they could not drift. They agreed, and they
// were all wrong. The terminal drawer, agents, run targets and workflows are `/v1` + WebSocket
// surfaces against the node; gating them on an Electron dialog hid them from every other host and left
// them visible on a desktop whose node had the terminal plugin turned off.
//
// So the thing to pin now is that the two questions stay separate:
//   "can this host open a folder dialog"  → the platform seam, per-host
//   "does this node run terminals"        → the node's plugin roster, per-node
// and that neither one can quietly start gating the other again.
const setHost = (folderPath: unknown) => {
  ;(globalThis as { window?: unknown }).window =
    folderPath === undefined ? {} : { acorn: { desktop: true, folderPath } }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  vi.unstubAllGlobals()
})

describe('the folder picker is a desktop extra, not a feature gate', () => {
  it('reports itself absent without a host, and takes nothing else down with it', async () => {
    setHost(undefined)
    // In a browser-origin client the running Node roster, rather than a native picker, proves the
    // terminal service exists. Unknown rosters must remain unavailable.
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ plugins: [
      { name: 'terminal', required: false, disabled: false, running: true, state: 'active', active: null },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await refreshNodePlugins()
    expect(canPickFolder()).toBe(false)
    expect(hasHostCapability('desktop')).toBe(false)
    // The regression this whole split exists to prevent.
    expect(hasHostCapability({ plugin: 'terminal' })).toBe(true)
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
  it('exposes core task and project operations', () => {
    setHost(undefined)
    const api = taskBridge()
    expect(typeof api.task.archive).toBe('function')
    expect(typeof api.task.onCreated).toBe('function')
    expect(typeof api.project.get).toBe('function')
    expect(typeof api.task.statuses).toBe('function')
    expect(typeof api.previewUrl).toBe('function')
  })

  // It has no business carrying the dialog: nothing else on it is host-shaped, and holding one
  // host-shaped method is exactly what let the null return gate everything else.
  it('no longer carries the folder picker', () => {
    expect('folderPath' in taskBridge()).toBe(false)
  })
})
