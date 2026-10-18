import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The archive installer, run against a fake archive whose `bin/acorn` records each call instead of
// running a Node. The real archive is checked by scripts/node-archive/smoke.mjs.
const INSTALLER = resolve(import.meta.dirname, '../../../../scripts/node-archive/install.sh')

const FAKE_ACORN = `#!/bin/sh
printf '%s|%s\\n' "$ACORN_DATA_DIR" "$*" >> "$FAKE_ACORN_LOG"
case "$*" in
  'node status --output json') echo "{\\"state\\":\\"\${FAKE_NODE_STATE:-stopped}\\"}" ;;
  'node service status --output json') echo '{"loaded":false}' ;;
esac
`

let scratch: string
let home: string
let fakeBin: string
let log: string
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'acorn-install-'))
  home = join(scratch, 'home')
  fakeBin = join(scratch, 'fake-bin')
  log = join(scratch, 'acorn.log')
  mkdirSync(home)
  mkdirSync(fakeBin)
})
afterEach(() => rmSync(scratch, { recursive: true, force: true }))

const installRoot = () =>
  process.platform === 'darwin'
    ? join(home, 'Library/Application Support/acorn-node')
    : join(home, '.local/share/acorn-node')

function archive(version: string): string {
  const dir = join(scratch, `acorn-node-${version}`)
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(join(dir, 'BUILD'), `version=${version}\nplatform=test\n`)
  writeFileSync(join(dir, 'bin/acorn'), FAKE_ACORN, { mode: 0o755 })
  cpSync(INSTALLER, join(dir, 'install.sh'))
  chmodSync(join(dir, 'install.sh'), 0o755)
  return dir
}

function install(dir: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(join(dir, 'install.sh'), args, {
    encoding: 'utf8',
    env: { HOME: home, PATH: `${fakeBin}:/usr/bin:/bin`, FAKE_ACORN_LOG: log, ...env },
  })
}

const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [])

describe.skipIf(process.platform === 'win32')('install.sh', () => {
  it('refuses to run as root', () => {
    writeFileSync(join(fakeBin, 'id'), '#!/bin/sh\necho 0\n', { mode: 0o755 })
    const result = install(archive('1.0.0'), ['--no-service'])
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/not as root/)
    expect(existsSync(installRoot())).toBe(false)
  })

  it("stops when the desktop app's Node is on this machine, unless forced", () => {
    const config = process.platform === 'darwin' ? join(home, 'Library/Application Support') : join(home, '.config')
    mkdirSync(join(config, 'com.acorn.desktop/node'), { recursive: true })
    writeFileSync(join(config, 'com.acorn.desktop/node/node.json'), '{}')
    const dir = archive('1.0.0')
    const refused = install(dir, ['--no-service'])
    expect(refused.status).toBe(1)
    expect(refused.stderr).toMatch(/desktop app already runs a Node.*--force/)
    expect(existsSync(installRoot())).toBe(false)
    expect(install(dir, ['--no-service', '--force']).status).toBe(0)
  })

  it('installs a version, a private data folder, and a command that defaults to that folder', () => {
    const result = install(archive('1.0.0'), ['--no-service'])
    expect(result.status, result.stderr).toBe(0)
    const root = installRoot()
    expect(readlinkSync(join(root, 'current'))).toBe('versions/1.0.0')
    expect(statSync(join(root, 'node')).mode & 0o777).toBe(0o700)
    expect(result.stdout).toMatch(/acorn node start --background[\s\S]*acorn node reach HOST[\s\S]*is not on your PATH/)

    const shim = join(home, '.local/bin/acorn')
    spawnSync(shim, ['node', 'status'], { env: { FAKE_ACORN_LOG: log } })
    spawnSync(shim, ['node', 'status'], { env: { FAKE_ACORN_LOG: log, ACORN_DATA_DIR: '/elsewhere' } })
    expect(calls().slice(-2)).toEqual([`${join(root, 'node')}|node status`, '/elsewhere|node status'])
  })

  it('upgrades in place: stops the running Node, starts the new version, and keeps one earlier version', () => {
    expect(install(archive('1.0.0'), ['--no-service']).status).toBe(0)
    expect(install(archive('1.0.1'), ['--no-service']).status).toBe(0)
    rmSync(log)
    const result = install(archive('1.0.2'), ['--no-service'], { FAKE_NODE_STATE: 'running' })
    expect(result.status, result.stderr).toBe(0)
    const root = installRoot()
    expect(readdirSync(join(root, 'versions')).sort()).toEqual(['1.0.1', '1.0.2'])
    expect(readlinkSync(join(root, 'current'))).toBe('versions/1.0.2')
    expect(calls().map((call) => call.split('|')[1])).toEqual([
      'node status --output json',
      'node stop',
      'node service status --output json',
      'node start --background',
    ])
    expect(result.stdout).not.toMatch(/acorn node start --background/)
  })

  it('removes the command and the versions, and keeps the data', () => {
    expect(install(archive('1.0.0'), ['--no-service']).status).toBe(0)
    const root = installRoot()
    writeFileSync(join(root, 'node/node.json'), '{}')
    const result = install(archive('1.0.0'), ['--uninstall'])
    expect(result.status, result.stderr).toBe(0)
    expect(
      calls()
        .slice(-2)
        .map((call) => call.split('|')[1]),
    ).toEqual(['node service uninstall', 'node stop'])
    expect(existsSync(join(home, '.local/bin/acorn'))).toBe(false)
    expect(readdirSync(root)).toEqual(['node'])
    expect(result.stdout).toContain(`Kept the Node's data in ${join(root, 'node')}.`)
  })
})
