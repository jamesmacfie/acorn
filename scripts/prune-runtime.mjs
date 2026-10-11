#!/usr/bin/env node
// Removes files that no Acorn runtime loads from an installed dependency tree
// (docs/shell/packaging.md § Runtime file policy).
//
//   node scripts/prune-runtime.mjs [node_modules directory]
//
// Desktop staging runs it on dist/helper/node_modules. A standalone Node's operator runs it after
// `npm ci`. Bundle verification runs it as a dry run that must find nothing. It imports only Node
// built-ins, because scripts/pack-node.mjs copies this file into the standalone archive as is.
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Each cut was reviewed against these exact versions. Any other version fails,
// so a dependency update repeats the review instead of shipping an unchecked assumption.
//
// - The adapter's claudeCliPath() returns CLAUDE_CODE_EXECUTABLE before it looks for the SDK's
//   bundled executable, and every adapter path that runs Claude goes through it. Acorn sets that
//   variable to the `claude` on the executing Node's PATH and refuses to launch without one
//   (plugins/agents/src/server/drivers/acpDriver.ts). So the SDK's executable packages never run.
// - The adapter imports only the SDK's main entry, sdk.mjs. Nothing loads bridge.mjs or
//   browser-sdk.js.
//
// node-pty's source folders are a desktop-only cut (apps/desktop/scripts/native-package-files.mjs),
// because a standalone Node may need them to rebuild the addon.
export const REVIEWED_PACKAGES = {
  '@agentclientprotocol/claude-agent-acp': { version: '0.54.1', omit: [] },
  '@anthropic-ai/claude-agent-sdk': { version: '0.3.197', omit: ['bridge.mjs', 'browser-sdk.js'] },
}

const CLAUDE_EXECUTABLE_PREFIX = '@anthropic-ai/claude-agent-sdk-'
const CLAUDE_EXECUTABLE_PLATFORMS = [
  'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64',
  'linux-arm64-musl', 'linux-x64-musl', 'win32-arm64', 'win32-x64',
]

// Type declarations and source maps. Node never loads either, and Acorn's runtimes don't enable
// source maps, so this rule holds for every package.
const DEVELOPMENT_FILE = /\.d\.[cm]?ts$|\.(?:[cm]?js|d\.[cm]?ts)\.map$/

/** True for one of the SDK's bundled Claude executable packages, which Acorn never ships. */
export function isOmittedPackage(name) {
  if (!name.startsWith(CLAUDE_EXECUTABLE_PREFIX)) return false
  if (!CLAUDE_EXECUTABLE_PLATFORMS.includes(name.slice(CLAUDE_EXECUTABLE_PREFIX.length))) {
    throw new Error(`Unreviewed Claude SDK package ${name}. Review it in scripts/prune-runtime.mjs.`)
  }
  return true
}

function sizeOf(path) {
  const stats = lstatSync(path)
  if (!stats.isDirectory()) return stats.size
  return readdirSync(path).reduce((total, name) => total + sizeOf(join(path, name)), 0)
}

/**
 * Removes omitted packages and files under `nodeModules`, including nested copies. Repeating it
 * removes nothing. With `dryRun`, it only reports. Symlinks are never followed.
 */
export function pruneRuntimeDependencies(nodeModules, { dryRun = false } = {}) {
  const removed = []
  const remove = (path) => {
    removed.push({ path: relative(nodeModules, path), bytes: sizeOf(path) })
    if (!dryRun) rmSync(path, { recursive: true, force: true })
  }

  const visitModules = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      if (!entry.name.startsWith('@')) { visitPackage(entry.name, path); continue }
      for (const scoped of readdirSync(path, { withFileTypes: true })) {
        if (scoped.isDirectory()) visitPackage(`${entry.name}/${scoped.name}`, join(path, scoped.name))
      }
    }
  }

  const visitPackage = (name, dir) => {
    if (isOmittedPackage(name)) return remove(dir)
    const omitted = new Set()
    const review = REVIEWED_PACKAGES[name]
    if (review) {
      const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (version !== review.version) {
        throw new Error(`Unreviewed ${name}@${version} (reviewed ${review.version}). Recheck its cuts in scripts/prune-runtime.mjs.`)
      }
      for (const file of review.omit) {
        const path = join(dir, file)
        if (!existsSync(path)) continue
        omitted.add(path)
        remove(path)
      }
    }
    visitFiles(dir, omitted)
  }

  const visitFiles = (dir, omitted) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (omitted.has(path)) continue
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') visitModules(path)
        else visitFiles(path, omitted)
      } else if (entry.isFile() && DEVELOPMENT_FILE.test(entry.name)) remove(path)
    }
  }

  visitModules(nodeModules)
  return { removed, bytes: removed.reduce((total, item) => total + item.bytes, 0) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? 'node_modules')
  const { removed, bytes } = pruneRuntimeDependencies(root)
  console.log(`[prune-runtime] removed ${removed.length} paths, ${bytes} bytes, from ${root}`)
}
