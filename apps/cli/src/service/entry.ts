import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findWorkspaceRoot } from '@acorn/node-core/server/storage'

/** One entry selection for checkout builds and extracted archives. The test override is also used
 * by the isolated service integration fixture. No credential is included in these arguments. */
export function standaloneEntry(): { command: string; args: string[]; cwd?: string } {
  const override = process.env.ACORN_CLI_NODE_ENTRY
  if (override) return override.endsWith('.ts')
    ? { command: process.execPath, args: ['--import', 'tsx', override], cwd: join(findWorkspaceRoot(override), 'apps/node') }
    : { command: process.execPath, args: [override] }
  const candidates = ['../standalone.js', '../../standalone.js', '../../node/dist/standalone.js', '../../../node/dist/standalone.js']
    .map((relative) => fileURLToPath(new URL(relative, import.meta.url)))
  const built = candidates.find(existsSync)
  if (built) return { command: process.execPath, args: [built] }
  const app = join(findWorkspaceRoot(fileURLToPath(import.meta.url)), 'apps/node')
  const source = join(app, 'src/entries/standalone.ts')
  if (!existsSync(source)) throw new Error('No standalone Node entry is available. Build @acorn/node first.')
  return { command: process.execPath, args: ['--import', 'tsx', source], cwd: app }
}
