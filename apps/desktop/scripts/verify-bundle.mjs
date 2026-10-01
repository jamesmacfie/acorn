#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { targetTriple } from './node-runtime.mjs'
import { verifyResources, verifyRuntime } from './bundle-inventory.mjs'
import { verifyWindowsBundle } from './verify-windows-bundle.mjs'

// What a built `.app` has to contain before anybody installs it (docs/shell.md § Build and packaging).
//
// The shell resolves the node runtime, the helper, the renderer, the frame assets and the bundled
// plugins from fixed places inside the bundle, and every one of them is copied there by the bundler
// from something this package staged. A `tauri build` that quietly dropped one produces an app that
// launches to a blank window and says nothing useful, so this compares the bundle against the staged
// input file by file, by digest.
//
// It is a positive statement, not a spot check: the expected inventory is whatever staging produced,
// so a new resource is covered the day it is added and nothing here drifts. The named files below only
// stop an empty `dist/` from passing vacuously.

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const fail = (message) => problems.push(message)

const triple = targetTriple()
const bundle = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(PKG, 'src-tauri/target', process.env.ACORN_TARGET_TRIPLE ? `${triple}/release` : 'release', 'bundle')
if (process.platform === 'win32') {
  verifyWindowsBundle(PKG, bundle)
  process.exit(0)
}
const app = readdirSync(join(bundle, 'macos'), { withFileTypes: true })
  .filter((entry) => entry.name.endsWith('.app'))
  .map((entry) => join(bundle, 'macos', entry.name))
if (app.length !== 1) throw new Error(`Expected exactly one .app in ${join(bundle, 'macos')}, found ${app.length}.`)
const contents = join(app[0], 'Contents')

// `externalBin` stages the runtime into `Contents/MacOS` and strips the triple, which is a different
// place from every other resource and the one the shell has to agree with.
//
// This one is checked by what it reports rather than by digest: signing the bundle rewrites every
// Mach-O inside it, so the packaged runtime is deliberately not the staged bytes. Its provenance comes
// from the other end — staging fetches the pinned build from nodejs.org and verifies it against that
// release's SHASUMS256.txt before it is ever copied here.
const node = join(contents, 'MacOS/node')
if (!existsSync(node)) {
  fail('the bundled Node runtime is missing from Contents/MacOS/node.')
} else if ((statSync(node).mode & 0o111) === 0) {
  fail('Contents/MacOS/node is not executable.')
} else {
  verifyRuntime(node, PKG, execFileSync, fail)
  try {
    execFileSync('codesign', ['--verify', '--strict', node], { stdio: 'pipe' })
  } catch (error) {
    fail(`codesign rejected the bundled runtime: ${error.stderr?.toString().trim() || error.message}`)
  }
}

const resources = join(contents, 'Resources')
verifyResources(PKG, resources, fail)

// Ad-hoc is still a signature, and a broken one is how a resource added after signing shows up.
try {
  execFileSync('codesign', ['--verify', '--deep', '--strict', app[0]], { stdio: 'pipe' })
  console.log('[verify] code signature: valid')
} catch (error) {
  fail(`codesign rejected the bundle: ${error.stderr?.toString().trim() || error.message}`)
}

// Generated from the first release even with no updater endpoint, so turning updates on later is
// configuration rather than a re-release (docs/shell.md § Build and packaging).
const updater = readdirSync(join(bundle, 'macos')).filter((name) => name.endsWith('.app.tar.gz'))
if (updater.length === 0) fail('no updater artifact was produced; `bundle.createUpdaterArtifacts` should be on.')
else if (!existsSync(join(bundle, 'macos', `${updater[0]}.sig`))) fail(`${updater[0]} has no minisign signature beside it.`)
else console.log(`[verify] updater artifact: ${updater[0]} and its signature`)

const dmg = existsSync(join(bundle, 'dmg')) ? readdirSync(join(bundle, 'dmg')).filter((name) => name.endsWith('.dmg')) : []
if (dmg.length !== 1) fail(`expected exactly one DMG in ${join(bundle, 'dmg')}, found ${dmg.length}.`)
else console.log(`[verify] installer: ${dmg[0]}`)

if (problems.length > 0) {
  for (const problem of problems) console.error(`[verify] ${problem}`)
  throw new Error(`The packaged bundle failed ${problems.length} inventory check(s).`)
}
console.log(`[verify] ${app[0]} is complete`)
