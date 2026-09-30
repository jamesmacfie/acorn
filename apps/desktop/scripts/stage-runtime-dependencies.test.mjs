import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { stageRuntimeDependencies } from './stage-runtime-dependencies.mjs'

const scratch = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function packageAt(dir, manifest, code = 'module.exports = 1') {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ main: 'index.cjs', ...manifest }))
  writeFileSync(join(dir, 'index.cjs'), code)
}

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
  stageRuntimeDependencies(pkg, helper, ['a', 'shared'])
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
  expect(() => stageRuntimeDependencies(dir, join(dir, 'helper'), ['missing-acorn-runtime'])).toThrow('is not installed')
})
