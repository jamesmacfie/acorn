import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { infoPlist, isSessionApp, nativeTarget, stageTestApp, TEST_APP_ID } from './nativeApp.mjs'

const cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const manifest = (overrides = {}) => ({
  name: 'mine',
  launcherPid: 100,
  appPid: 200,
  nativeApp: { bundleIdentifier: TEST_APP_ID, name: 'Acorn Agent Test', appPath: '/s/mine/Acorn Agent Test.app', executable: '/s/mine/Acorn Agent Test.app/Contents/MacOS/acorn-desktop' },
  ...overrides,
})

describe('the test app identity', () => {
  it('names one identifier every session shares, distinct from the installed app', () => {
    const plist = infoPlist({ identifier: TEST_APP_ID, name: 'Acorn Agent Test', executable: 'acorn-desktop' })
    expect(plist).toContain('<key>CFBundleIdentifier</key>\n  <string>com.acorn.desktop.agent-test</string>')
    expect(plist).toContain('<key>CFBundleExecutable</key>\n  <string>acorn-desktop</string>')
    expect(TEST_APP_ID).not.toBe('com.acorn.desktop')
  })

  it.skipIf(process.platform !== 'darwin')('stages a signed bundle whose executable runs from inside it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'native-app-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const staged = await stageTestApp(directory, '/bin/sleep')
    expect(staged.appPath).toBe(join(directory, 'Acorn Agent Test.app'))
    expect(staged.executable).toBe(join(staged.appPath, 'Contents', 'MacOS', 'sleep'))
    expect(await readFile(join(staged.appPath, 'Contents', 'Info.plist'), 'utf8')).toContain(TEST_APP_ID)
  })
})

describe('finding the window a session launched', () => {
  it('accepts only the launcher child running the recorded executable', () => {
    const own = { ppid: 100, command: manifest().nativeApp.executable }
    expect(isSessionApp(own, manifest())).toBe(true)
    // A recorded PID handed to an unrelated process, or to another session's window.
    expect(isSessionApp({ ...own, ppid: 1 }, manifest())).toBe(false)
    expect(isSessionApp({ ...own, command: '/s/other/Acorn Agent Test.app/Contents/MacOS/acorn-desktop' }, manifest())).toBe(false)
    expect(isSessionApp(null, manifest())).toBe(false)
  })

  it.skipIf(process.platform !== 'darwin')('reports the live target and the sessions that share its identity', async () => {
    const child = spawn('/bin/sleep', ['30'])
    cleanups.push(() => child.kill())
    await new Promise((resolve) => child.once('spawn', resolve))
    const mine = manifest({ launcherPid: process.pid, appPid: child.pid, nativeApp: { ...manifest().nativeApp, executable: '/bin/sleep' } })
    const other = manifest({ name: 'theirs' })
    expect(await nativeTarget(mine, [mine, other])).toEqual({
      session: 'mine',
      pid: child.pid,
      app: '/s/mine/Acorn Agent Test.app',
      bundleIdentifier: TEST_APP_ID,
      name: 'Acorn Agent Test',
      sharedWith: ['theirs'],
    })
    await expect(nativeTarget({ ...mine, launcherPid: 1 }, [mine])).rejects.toThrow('no longer owns process')
  })
})
