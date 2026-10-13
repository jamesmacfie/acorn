import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { configDir, custody } from '@acorn/custody/local'
import {
  BROWSER_BRIDGE_DEV_HOST,
  BROWSER_BRIDGE_HOST,
  nativeHostRegistration,
  type BridgeBrowser,
} from '@acorn/protocol/extensionBridge.ts'
import { CliError } from '../error'

// `acorn browser install|status|uninstall`: register the native host each browser starts for the
// extension. A registration names a launcher script by absolute path, because the browser starts it
// without a shell PATH. The launcher pins the Node runtime and the host entry that ran the install.

export type HostTarget = {
  browser: BridgeBrowser
  // The development name never replaces the standalone CLI's registration.
  development: boolean
  // This browser's custody: its fleet, tokens, and the launcher. Kept apart from CLI and desktop
  // custody, and per browser, so Chrome and Firefox never overwrite each other's pairings.
  bridgeDir: string
  // Where the browser looks for registrations. Chrome started with a custom profile folder reads
  // `<profile>/NativeMessagingHosts` instead of the user-level folder.
  registryDir: string
}

export type BrowserHostStatus = {
  apiVersion: 'acorn.cli/v1'
  kind: 'BrowserHost'
  browser: BridgeBrowser
  hostName: string
  registered: boolean
  registration: string
  launcher: string
  bridgeDir: string
  pairedNodes: number
  problem: string | null
}

export function hostTargets(options: {
  browser?: string
  development: boolean
  bridgeDir?: string
  registryDir?: string
}): HostTarget[] {
  if (process.platform !== 'darwin')
    throw new CliError('unsupported_platform', 'This release registers the browser bridge on macOS only.', 4)
  if (options.browser !== undefined && options.browser !== 'chrome' && options.browser !== 'firefox')
    throw new CliError('usage', '--browser must be chrome or firefox.', 2)
  const browsers: BridgeBrowser[] = options.browser ? [options.browser] : ['chrome', 'firefox']
  if ((options.bridgeDir || options.registryDir) && browsers.length > 1)
    throw new CliError('usage', '--bridge-dir and --registry-dir need a single --browser.', 2)
  for (const dir of [options.bridgeDir, options.registryDir])
    if (dir !== undefined && !dir.startsWith('/')) throw new CliError('usage', 'Folders must be absolute paths.', 2)
  return browsers.map((browser) => ({
    browser,
    development: options.development,
    bridgeDir:
      options.bridgeDir ?? join(configDir(), 'browser-bridge', options.development ? `${browser}-dev` : browser),
    registryDir: options.registryDir ?? userRegistryDir(browser),
  }))
}

const userRegistryDir = (browser: BridgeBrowser): string =>
  join(
    homedir(),
    'Library',
    'Application Support',
    browser === 'chrome' ? 'Google/Chrome' : 'Mozilla',
    'NativeMessagingHosts',
  )

const hostName = (target: HostTarget): string => (target.development ? BROWSER_BRIDGE_DEV_HOST : BROWSER_BRIDGE_HOST)
const registrationPath = (target: HostTarget): string => join(target.registryDir, `${hostName(target)}.json`)
const launcherPath = (target: HostTarget): string => join(target.bridgeDir, 'native-host')
const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

export function installNativeHost(
  target: HostTarget,
  runtime: { nodeExecutable: string; hostEntry: string },
): BrowserHostStatus {
  if (!existsSync(runtime.hostEntry))
    throw new CliError('native_host_missing', `${runtime.hostEntry} is missing. Build or reinstall the CLI.`, 4)
  mkdirSync(target.bridgeDir, { recursive: true, mode: 0o700 })
  chmodSync(target.bridgeDir, 0o700)
  const launcher = launcherPath(target)
  writeFileSync(
    launcher,
    [
      '#!/bin/sh',
      '# Written by `acorn browser install`. Run it again to repair this file.',
      `exec ${quote(runtime.nodeExecutable)} ${quote(runtime.hostEntry)} --browser ${target.browser} --bridge-dir ${quote(target.bridgeDir)} -- "$@"`,
      '',
    ].join('\n'),
    { mode: 0o700 },
  )
  chmodSync(launcher, 0o700)
  mkdirSync(target.registryDir, { recursive: true })
  writeFileSync(
    registrationPath(target),
    `${JSON.stringify(nativeHostRegistration(target.browser, hostName(target), launcher), null, 2)}\n`,
    { mode: 0o644 },
  )
  return nativeHostStatus(target)
}

export function nativeHostStatus(target: HostTarget): BrowserHostStatus {
  const registration = registrationPath(target)
  const launcher = launcherPath(target)
  const status: BrowserHostStatus = {
    apiVersion: 'acorn.cli/v1',
    kind: 'BrowserHost',
    browser: target.browser,
    hostName: hostName(target),
    registered: false,
    registration,
    launcher,
    bridgeDir: target.bridgeDir,
    pairedNodes: existsSync(target.bridgeDir) ? custody(target.bridgeDir).fleet.list().length : 0,
    problem: null,
  }
  const problem = registrationProblem(target, registration, launcher)
  return problem === 'not installed'
    ? { ...status, problem: 'Not installed. Run acorn browser install.' }
    : { ...status, registered: true, problem: problem && `${problem} Run acorn browser install to repair it.` }
}

function registrationProblem(target: HostTarget, registration: string, launcher: string): string | null {
  if (!existsSync(registration)) return 'not installed'
  let written: unknown
  try {
    written = JSON.parse(readFileSync(registration, 'utf8'))
  } catch {
    return 'The registration file is unreadable.'
  }
  if (JSON.stringify(written) !== JSON.stringify(nativeHostRegistration(target.browser, hostName(target), launcher)))
    return 'The registration names another launcher or extension.'
  try {
    accessSync(launcher, constants.X_OK)
  } catch {
    return 'The launcher script is missing or not executable.'
  }
  // The launcher's quoted absolute paths: the Node runtime and the host entry.
  const paths = [...readFileSync(launcher, 'utf8').matchAll(/'(\/[^']*)'/g)].map((match) => match[1]!)
  const missing = paths.find((path) => !existsSync(path))
  return missing ? `The launcher points at ${missing}, which no longer exists.` : null
}

export function uninstallNativeHost(target: HostTarget): BrowserHostStatus {
  rmSync(registrationPath(target), { force: true })
  rmSync(launcherPath(target), { force: true })
  const status = nativeHostStatus(target)
  return {
    ...status,
    problem:
      status.pairedNodes > 0
        ? `Removed. ${status.pairedNodes} pairing(s) remain in ${target.bridgeDir}; delete that folder to remove them.`
        : 'Removed.',
  }
}
