import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { pruneRuntimeDependencies } from '../../../scripts/prune-runtime.mjs'
import { stageRuntimeDependencies } from './stage-runtime-dependencies.mjs'
import { runtimeTarget } from './node-runtime.mjs'

const darwin = runtimeTarget('aarch64-apple-darwin')

const scratch = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function packageAt(dir, manifest, code = 'module.exports = 1') {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ main: 'index.cjs', ...manifest }))
  writeFileSync(join(dir, 'index.cjs'), code)
}

function asset(root, path, executable = false) {
  const file = join(root, path)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, path)
  if (executable) chmodSync(file, 0o755)
}

const targets = [
  'aarch64-apple-darwin', 'x86_64-apple-darwin',
  'aarch64-unknown-linux-gnu', 'x86_64-unknown-linux-gnu',
  'x86_64-pc-windows-msvc',
]

it.each(targets)('keeps only node-pty assets for %s', (triple) => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-native-target-test-'))
  scratch.push(dir)
  const pkg = join(dir, 'checkout')
  const helper = join(dir, 'installed/helper')
  packageAt(pkg, { name: 'desktop' })
  const source = join(pkg, 'node_modules/node-pty')
  packageAt(source, { name: 'node-pty', version: '1.1.0' })
  asset(source, 'LICENSE')
  for (const input of ['deps/winpty/src/agent/Agent.cc', 'third_party/conpty/1.23/win10-x64/conpty.dll', 'src/unix/pty.cc']) asset(source, input)
  for (const selected of targets.map(runtimeTarget)) {
    const prefix = `prebuilds/${selected.platform}-${selected.arch}/`
    asset(source, `${prefix}pty.node`)
    if (selected.platform === 'win32') {
      for (const file of ['conpty.node', 'conpty_console_list.node', 'conpty/conpty.dll', 'winpty.dll']) asset(source, `${prefix}${file}`)
      for (const file of ['conpty/OpenConsole.exe', 'winpty-agent.exe']) asset(source, `${prefix}${file}`, true)
    } else if (selected.platform === 'darwin') asset(source, `${prefix}spawn-helper`, true)
  }
  // Windows arm64 is present in the package, though Acorn does not release that target.
  asset(source, 'prebuilds/win32-arm64/pty.node')
  stageRuntimeDependencies(pkg, helper, runtimeTarget(triple), ['node-pty'])
  rmSync(pkg, { recursive: true, force: true })
  const staged = join(helper, 'node_modules/node-pty')
  const chosen = runtimeTarget(triple)
  const prefix = `prebuilds/${chosen.platform}-${chosen.arch}`
  expect(existsSync(join(staged, 'LICENSE'))).toBe(true)
  for (const input of ['deps', 'third_party', 'src']) expect(existsSync(join(staged, input))).toBe(false)
  expect(existsSync(join(staged, prefix, 'pty.node'))).toBe(true)
  for (const other of targets.map(runtimeTarget)) {
    if (other.triple !== triple) expect(existsSync(join(staged, `prebuilds/${other.platform}-${other.arch}`))).toBe(false)
  }
  // Windows keeps no execute bit, so a Windows host can't check one, whichever target it stages.
  const executable = (path) => process.platform === 'win32' || (statSync(path).mode & 0o111) !== 0
  if (chosen.platform === 'win32') {
    expect(existsSync(join(staged, prefix, 'conpty/conpty.dll'))).toBe(true)
    expect(executable(join(staged, prefix, 'winpty-agent.exe'))).toBe(true)
  } else if (chosen.platform === 'darwin') expect(executable(join(staged, prefix, 'spawn-helper'))).toBe(true)
})

it('rejects missing target assets and unreviewed node-pty layouts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-native-missing-test-'))
  scratch.push(dir)
  packageAt(dir, { name: 'desktop' })
  const source = join(dir, 'node_modules/node-pty')
  packageAt(source, { name: 'node-pty', version: '1.1.0' })
  asset(source, 'prebuilds/darwin-arm64/pty.node')
  expect(() => stageRuntimeDependencies(dir, join(dir, 'helper'), darwin, ['node-pty'])).toThrow('missing native assets')
  asset(source, 'prebuilds/darwin-arm64/spawn-helper')
  asset(source, 'prebuilds/unknown-abi/pty.node')
  expect(() => stageRuntimeDependencies(dir, join(dir, 'helper'), darwin, ['node-pty'])).toThrow('Unreviewed node-pty prebuild directory')
  expect(() => stageRuntimeDependencies(dir, join(dir, 'helper'), runtimeTarget('x86_64-unknown-linux-gnu'), ['node-pty'])).toThrow('missing native assets')
  expect(() => runtimeTarget('unsupported-triple')).toThrow('Unsupported desktop target triple')
})

it('rejects an unqualified host build for a different target', () => {
  const triple = targets.find((name) => {
    const target = runtimeTarget(name)
    return target.platform !== process.platform || target.arch !== process.arch
  })
  if (!triple) throw new Error('No supported cross target is available for this test')
  const target = runtimeTarget(triple)
  const dir = mkdtempSync(join(tmpdir(), 'acorn-native-cross-test-'))
  scratch.push(dir)
  packageAt(dir, { name: 'desktop' })
  const source = join(dir, 'node_modules/node-pty')
  packageAt(source, { name: 'node-pty', version: '1.1.0' })
  const prebuild = `prebuilds/${target.platform}-${target.arch}`
  asset(source, `${prebuild}/pty.node`)
  if (target.platform === 'win32') {
    for (const file of ['conpty.node', 'conpty_console_list.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe', 'winpty.dll', 'winpty-agent.exe']) {
      asset(source, `${prebuild}/${file}`)
    }
  } else asset(source, `${prebuild}/spawn-helper`)
  asset(source, 'build/Release/pty.node')
  expect(() => stageRuntimeDependencies(dir, join(dir, 'helper'), target, ['node-pty']))
    .toThrow('host-specific build')
})

it('stages a matching Unix source build without prebuilds', () => {
  const triple = targets.find((name) => {
    const target = runtimeTarget(name)
    return target.platform === process.platform && target.arch === process.arch
  })
  if (!triple || process.platform === 'win32') return
  const dir = mkdtempSync(join(tmpdir(), 'acorn-native-source-test-'))
  scratch.push(dir)
  packageAt(dir, { name: 'desktop' })
  const source = join(dir, 'node_modules/node-pty')
  packageAt(source, { name: 'node-pty', version: '1.1.0' })
  asset(source, 'build/Release/pty.node')
  asset(source, 'build/Release/spawn-helper', true)
  const helper = join(dir, 'helper')
  stageRuntimeDependencies(dir, helper, runtimeTarget(triple), ['node-pty'])
  expect(existsSync(join(helper, 'node_modules/node-pty/build/Release/spawn-helper'))).toBe(true)
})

it('packages nested versions and cycles so a helper outside the checkout can resolve them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-dependency-test-'))
  scratch.push(dir)
  const pkg = join(dir, 'checkout')
  const helper = join(dir, 'installed/helper')
  packageAt(pkg, { name: 'desktop' })
  const a = join(pkg, 'node_modules/a')
  const shared = join(pkg, 'node_modules/shared')
  packageAt(a, { name: 'a', dependencies: { shared: '2' }, optionalDependencies: { absent: '1' } }, "module.exports = require('shared')")
  packageAt(shared, { name: 'shared', version: '1' }, 'module.exports = 1')
  packageAt(join(a, 'node_modules/shared'), { name: 'shared', version: '2', dependencies: { a: '1' } }, "module.exports = require.resolve('a')")
  stageRuntimeDependencies(pkg, helper, darwin, ['a', 'shared'])
  rmSync(pkg, { recursive: true, force: true })
  const require = createRequire(join(helper, 'probe.cjs'))
  expect(require('shared')).toBe(1)
  expect(require('a')).toBe(require.resolve('a'))
  expect(JSON.parse(readFileSync(join(helper, 'package.json'), 'utf8')).type).toBe('module')
})

it('fails staging when a required runtime package is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-missing-dependency-test-'))
  scratch.push(dir)
  packageAt(dir, { name: 'desktop' })
  expect(() => stageRuntimeDependencies(dir, join(dir, 'helper'), darwin, ['missing-acorn-runtime'])).toThrow('is not installed')
})

it('hoists transitive dependencies so long chains stay short and resolve outside the checkout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-hoisted-dependency-test-'))
  scratch.push(dir)
  const pkg = join(dir, 'checkout')
  const helper = join(dir, 'installed/helper')
  packageAt(pkg, { name: 'desktop' })
  let directory = pkg
  const names = ['adapter', 'agent', 'sdk', 'schema', 'definitions']
  for (const [index, name] of names.entries()) {
    directory = join(directory, 'node_modules', name)
    const dependency = names[index + 1]
    packageAt(directory, { name, ...(dependency ? { dependencies: { [dependency]: '1' } } : {}) },
      dependency ? `module.exports = require('${dependency}')` : 'module.exports = 42')
  }
  stageRuntimeDependencies(pkg, helper, darwin, ['adapter'])
  rmSync(pkg, { recursive: true, force: true })
  const require = createRequire(join(helper, 'probe.cjs'))
  expect(require('adapter')).toBe(42)
  for (const name of names) expect(existsSync(join(helper, 'node_modules', name, 'index.cjs'))).toBe(true)
})

const SDK = '@anthropic-ai/claude-agent-sdk'
const executables = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'linux-arm64-musl', 'linux-x64-musl', 'win32-arm64', 'win32-x64']
  .map((platform) => `${SDK}-${platform}`)

// The reviewed adapter and SDK, with every executable package installed: the first one hoisted and the
// rest nested under the SDK, the way a package manager that hydrates every optional dependency lays them out.
function claudeFixture(root, sdkVersion = '0.3.197', optional = executables) {
  packageAt(root, { name: 'desktop' })
  const adapter = join(root, 'node_modules/@agentclientprotocol/claude-agent-acp')
  packageAt(adapter, { name: '@agentclientprotocol/claude-agent-acp', version: '0.54.1', dependencies: { [SDK]: sdkVersion } }, `module.exports = require('${SDK}')`)
  asset(adapter, 'dist/lib.d.ts')
  const sdk = join(root, 'node_modules', SDK)
  packageAt(sdk, { name: SDK, version: sdkVersion, optionalDependencies: Object.fromEntries(optional.map((name) => [name, sdkVersion])) }, 'module.exports = 7')
  for (const file of ['LICENSE.md', 'README.md', 'sdk.d.ts', 'bridge.mjs', 'browser-sdk.js']) asset(sdk, file)
  for (const [index, name] of optional.entries()) {
    const [os, cpu] = name.slice(SDK.length + 1).split('-')
    const dir = index === 0 ? join(root, 'node_modules', name) : join(sdk, 'node_modules', name)
    packageAt(dir, { name, version: sdkVersion, os: [os], cpu: [cpu] })
    asset(dir, 'claude', true)
  }
}

const filesIn = (dir) => readdirSync(dir, { recursive: true }).map((path) => path.split('\\').join('/'))

it.each(targets)('stages the Claude SDK library without its executables for %s', (triple) => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-claude-sdk-test-'))
  scratch.push(dir)
  const pkg = join(dir, 'checkout')
  const helper = join(dir, 'installed/helper')
  claudeFixture(pkg)
  stageRuntimeDependencies(pkg, helper, runtimeTarget(triple), ['@agentclientprotocol/claude-agent-acp'])
  rmSync(pkg, { recursive: true, force: true })
  const files = filesIn(join(helper, 'node_modules'))
  expect(files.filter((path) => path.includes(`${SDK}-`))).toEqual([])
  expect(files.filter((path) => /\.d\.ts$|bridge\.mjs|browser-sdk/.test(path))).toEqual([])
  for (const file of ['package.json', 'index.cjs', 'LICENSE.md', 'README.md']) expect(files).toContain(`${SDK}/${file}`)
  expect(createRequire(join(helper, 'probe.cjs'))('@agentclientprotocol/claude-agent-acp')).toBe(7)
})

it('refuses an unreviewed Claude SDK version or executable package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-claude-sdk-layout-test-'))
  scratch.push(dir)
  claudeFixture(join(dir, 'version'), '0.3.198')
  expect(() => stageRuntimeDependencies(join(dir, 'version'), join(dir, 'helper'), darwin, ['@agentclientprotocol/claude-agent-acp']))
    .toThrow(`Unreviewed ${SDK}@0.3.198`)
  claudeFixture(join(dir, 'platform'), '0.3.197', [`${SDK}-freebsd-x64`])
  expect(() => stageRuntimeDependencies(join(dir, 'platform'), join(dir, 'helper'), darwin, ['@agentclientprotocol/claude-agent-acp']))
    .toThrow(`Unreviewed Claude SDK package ${SDK}-freebsd-x64`)
})

it('prunes an installed tree, nested copies included, and finds nothing the second time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-prune-test-'))
  scratch.push(dir)
  claudeFixture(dir)
  const modules = join(dir, 'node_modules')
  const report = pruneRuntimeDependencies(modules, { dryRun: true })
  expect(report.removed.map((item) => item.path.split('\\').join('/')).sort()).toEqual([
    `${SDK}-darwin-arm64`,
    ...executables.slice(1).map((name) => `${SDK}/node_modules/${name}`),
    `${SDK}/bridge.mjs`, `${SDK}/browser-sdk.js`, `${SDK}/sdk.d.ts`,
    '@agentclientprotocol/claude-agent-acp/dist/lib.d.ts',
  ].sort())
  expect(existsSync(join(modules, `${SDK}-darwin-arm64/claude`))).toBe(true)
  expect(pruneRuntimeDependencies(modules)).toEqual(report)
  expect(pruneRuntimeDependencies(modules)).toEqual({ removed: [], bytes: 0 })
  // Emptied scope folders stay behind; they hold no bytes.
  expect(filesIn(join(modules, SDK)).filter((path) => !path.startsWith('node_modules')).sort())
    .toEqual(['LICENSE.md', 'README.md', 'index.cjs', 'package.json'])
})

// The installed adapter, staged outside the checkout so nothing resolves from the workspace's
// node_modules: the SDK library must load, and the adapter must find no bundled executable to fall back to.
it('stages the real Claude adapter so it runs the configured executable and has no fallback', () => {
  const host = targets.map(runtimeTarget).find((target) => target.platform === process.platform && target.arch === process.arch)
  if (!host) return
  const dir = mkdtempSync(join(tmpdir(), 'acorn-claude-adapter-test-'))
  scratch.push(dir)
  stageRuntimeDependencies(resolve(import.meta.dirname, '..'), dir, host, ['@agentclientprotocol/claude-agent-acp'])
  expect(filesIn(join(dir, 'node_modules')).filter((path) => path.includes(`${SDK}-`))).toEqual([])
  const agent = pathToFileURL(join(dir, 'node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js')).href
  const probe = `
    const { claudeCliPath } = await import(${JSON.stringify(agent)})
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const configured = await claudeCliPath()
    delete process.env.CLAUDE_CODE_EXECUTABLE
    const fallback = await claudeCliPath().then(() => 'found', (error) => error.message)
    console.log(JSON.stringify({ query: typeof query, configured, fallback }))`
  const env = { ...process.env, CLAUDE_CODE_EXECUTABLE: '/opt/claude/bin/claude', NODE_PATH: '' }
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: dir, env, encoding: 'utf8' })
  expect(JSON.parse(output)).toEqual({
    query: 'function',
    configured: '/opt/claude/bin/claude',
    fallback: expect.stringContaining('Claude native binary not found'),
  })
})
