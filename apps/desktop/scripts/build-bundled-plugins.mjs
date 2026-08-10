#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(DESKTOP, '../..')
const output = resolve(DESKTOP, 'out/bundled-plugins')

// The distribution roster. Adding another bundled plugin is one row here; package construction,
// desktop resources, boot reconciliation, update ownership, uninstall tombstones and client trust
// are all generic over the resulting directories.
const BUNDLED_PLUGINS = ['rollbar']

rmSync(output, { recursive: true, force: true })
for (const id of BUNDLED_PLUGINS) {
  execFileSync(process.execPath, [
    resolve(ROOT, 'apps/node/scripts/build-plugin.mjs'),
    id,
    '--package-root',
    output,
  ], { cwd: resolve(ROOT, 'apps/node'), stdio: 'inherit' })
}
console.log(`[bundled-plugins] ${BUNDLED_PLUGINS.length} package(s) -> ${output}`)
