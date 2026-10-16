// The distribution roster, shared by the desktop build and the standalone Node tarball so the two
// can't ship different plugins. Adding another bundled plugin is one row here; package construction,
// desktop resources, boot reconciliation, update ownership, uninstall tombstones and client trust are
// all generic over the resulting directories.
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPnpm } from './run-pnpm.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLED_PLUGINS = ['agent-cost', 'database', 'http', 'linear', 'model-providers', 'rollbar', 'sentry-telemetry']

// Replaces `output` with one loaded package per roster entry and returns the ids it built.
export function buildBundledPlugins(output) {
  // Client bundles import the SDK through its package exports, which point to dist/.
  // Build it before bundling plugins so staging also works in a clean checkout.
  runPnpm(['--filter', 'acorn-plugin-sdk', 'build'], { cwd: ROOT, stdio: 'inherit' })

  rmSync(output, { recursive: true, force: true })
  for (const id of BUNDLED_PLUGINS) {
    try {
      execFileSync(
        process.execPath,
        [resolve(ROOT, 'apps/node/scripts/build-plugin.mjs'), id, '--package-root', output],
        { cwd: resolve(ROOT, 'apps/node'), stdio: 'inherit' },
      )
    } catch (error) {
      throw new Error(
        `Bundled plugin '${id}' failed to build, so ${output} is incomplete. Its build output is above; ` +
          `rerun it alone with: pnpm --filter @acorn/node build:plugin ${id}`,
        { cause: error },
      )
    }
  }
  return BUNDLED_PLUGINS
}
