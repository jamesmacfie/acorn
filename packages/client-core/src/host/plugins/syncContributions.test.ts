import { beforeEach, expect, it, vi } from 'vitest'

// The frame and chrome hosts load on the first pass. Once loaded, a pass runs in the caller's tick,
// which is what keeps a withdrawal synchronous. A failed import is forgotten so the next pass retries.

const calls: string[] = []
let failFrames = 0
vi.mock('../frames/register', async () => {
  if (failFrames > 0) {
    failFrames--
    throw new Error('Importing a module script failed')
  }
  return { syncFrameContributions: () => calls.push('frames') }
})
vi.mock('../chrome/chromeRegister', () => ({ syncChromeContributions: () => calls.push('chrome') }))

beforeEach(() => {
  calls.length = 0
  vi.resetModules()
})

it('retries a failed import on the next pass, then runs both passes in order', async () => {
  failFrames = 1
  const { syncPluginContributions } = await import('./syncContributions')
  await expect(syncPluginContributions()).rejects.toThrow()
  expect(calls).toEqual([])
  await syncPluginContributions()
  expect(calls).toEqual(['frames', 'chrome'])
})

it('runs a pass synchronously once the hosts have loaded', async () => {
  const { syncPluginContributions } = await import('./syncContributions')
  await syncPluginContributions()
  calls.length = 0
  void syncPluginContributions()
  expect(calls).toEqual(['frames', 'chrome'])
})
