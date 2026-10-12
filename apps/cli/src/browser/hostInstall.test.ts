import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { custody } from '@acorn/custody/local'
import { hostTargets, installNativeHost, nativeHostStatus, uninstallNativeHost, type HostTarget } from './hostInstall'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function target(browser: HostTarget['browser'] = 'chrome'): { target: HostTarget; entry: string } {
  const root = mkdtempSync(join(tmpdir(), 'acorn-host-install-'))
  dirs.push(root)
  const entry = join(root, 'native-host.js')
  writeFileSync(entry, '')
  return {
    target: { browser, development: true, bridgeDir: join(root, 'bridge'), registryDir: join(root, 'registry') },
    entry,
  }
}

describe('native host install', () => {
  it('writes a private launcher with absolute paths and an exact allowlist', () => {
    const { target: chrome, entry } = target('chrome')
    const status = installNativeHost(chrome, { nodeExecutable: process.execPath, hostEntry: entry })
    expect(status).toMatchObject({ registered: true, problem: null, hostName: 'com.acorn.browser_bridge_dev' })
    expect(statSync(chrome.bridgeDir).mode & 0o777).toBe(0o700)
    expect(statSync(status.launcher).mode & 0o777).toBe(0o700)
    expect(readFileSync(status.launcher, 'utf8')).toContain(
      `exec '${process.execPath}' '${entry}' --browser chrome --bridge-dir '${chrome.bridgeDir}' -- "$@"`,
    )
    expect(JSON.parse(readFileSync(status.registration, 'utf8'))).toMatchObject({
      path: status.launcher,
      allowed_origins: ['chrome-extension://ciaaplnahgpccadenkacgipmhmpbddjo/'],
    })
  })

  it('reports a registration that was changed or whose runtime moved, and repairs it', () => {
    const { target: firefox, entry } = target('firefox')
    const runtime = { nodeExecutable: process.execPath, hostEntry: entry }
    const { registration } = installNativeHost(firefox, runtime)
    writeFileSync(registration, JSON.stringify({ name: 'com.acorn.browser_bridge_dev', path: '/elsewhere' }))
    expect(nativeHostStatus(firefox).problem).toMatch(/another launcher.*acorn browser install/)
    installNativeHost(firefox, runtime)
    rmSync(entry)
    expect(nativeHostStatus(firefox).problem).toMatch(/no longer exists/)
  })

  it('refuses to register an entry that is missing', () => {
    const { target: chrome } = target()
    expect(() => installNativeHost(chrome, { nodeExecutable: process.execPath, hostEntry: '/missing.js' })).toThrow(
      /missing/,
    )
  })

  it('removes the registration and launcher and keeps pairings', () => {
    const { target: chrome, entry } = target()
    const { registration, launcher } = installNativeHost(chrome, { nodeExecutable: process.execPath, hostEntry: entry })
    custody(chrome.bridgeDir).fleet.remember(
      { nodeId: 'n1', label: 'Studio', endpoint: 'https://n.test:1', local: false },
      'token',
    )
    const status = uninstallNativeHost(chrome)
    expect(existsSync(registration) || existsSync(launcher)).toBe(false)
    expect(status).toMatchObject({ registered: false, pairedNodes: 1 })
    expect(status.problem).toContain(`1 pairing(s) remain in ${chrome.bridgeDir}`)
  })
})

describe.runIf(process.platform === 'darwin')('native host targets', () => {
  it('keeps each browser in its own custody and registry folder', () => {
    const [chrome, firefox] = hostTargets({ development: false })
    expect(chrome!.bridgeDir).toMatch(/acorn\/browser-bridge\/chrome$/)
    expect(firefox!.bridgeDir).toMatch(/acorn\/browser-bridge\/firefox$/)
    expect(chrome!.registryDir).toMatch(/Google\/Chrome\/NativeMessagingHosts$/)
    expect(firefox!.registryDir).toMatch(/Mozilla\/NativeMessagingHosts$/)
    expect(() => hostTargets({ development: false, bridgeDir: '/x' })).toThrow(/single --browser/)
    expect(() => hostTargets({ browser: 'safari', development: false })).toThrow(/chrome or firefox/)
  })
})
