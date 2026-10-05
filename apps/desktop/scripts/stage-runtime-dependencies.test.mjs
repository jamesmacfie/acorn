import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
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
  for (const selected of targets.map(runtimeTarget)) {
    const prefix = `prebuilds/${selected.platform}-${selected.arch}/`
    asset(source, `${prefix}pty.node`)
    if (selected.platform === 'win32') {
      for (const file of ['conpty.node', 'conpty_console_list.node', 'conpty/conpty.dll', 'winpty.dll']) asset(source, `${prefix}${file}`)
      for (const file of ['conpty/OpenConsole.exe', 'winpty-agent.exe']) asset(source, `${prefix}${file}`, true)
    } else asset(source, `${prefix}spawn-helper`, true)
  }
  // Windows arm64 is present in the package, though Acorn does not release that target.
  asset(source, 'prebuilds/win32-arm64/pty.node')
  stageRuntimeDependencies(pkg, helper, runtimeTarget(triple), ['node-pty'])
  rmSync(pkg, { recursive: true, force: true })
  const staged = join(helper, 'node_modules/node-pty')
  const chosen = runtimeTarget(triple)
  const prefix = `prebuilds/${chosen.platform}-${chosen.arch}`
  expect(existsSync(join(staged, 'LICENSE'))).toBe(true)
  expect(existsSync(join(staged, prefix, 'pty.node'))).toBe(true)
  for (const other of targets.map(runtimeTarget)) {
    if (other.triple !== triple) expect(existsSync(join(staged, `prebuilds/${other.platform}-${other.arch}`))).toBe(false)
  }
  if (chosen.platform === 'win32') {
    expect(existsSync(join(staged, prefix, 'conpty/conpty.dll'))).toBe(true)
    expect(statSync(join(staged, prefix, 'winpty-agent.exe')).mode & 0o111).not.toBe(0)
  } else expect(statSync(join(staged, prefix, 'spawn-helper')).mode & 0o111).not.toBe(0)
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
