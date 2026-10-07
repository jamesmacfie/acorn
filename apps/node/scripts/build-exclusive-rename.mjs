import { chmodSync, existsSync, writeFileSync } from 'node:fs'
import { platform, arch } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// The service bundle is the artifact shared by desktop staging and the standalone tarball.
// Compile once on the builder; ordinary Node hosts never need a compiler or C source.
const root = resolve(import.meta.dirname, '../../..')
const output = resolve(root, 'apps/node/dist/exclusive-rename')
const manifest = resolve(root, 'apps/node/dist/exclusive-rename.json')
const source = resolve(root, 'plugins/editor/native/exclusive-rename.c')
const supported = platform() === 'darwin' || platform() === 'linux'
let reason = supported ? '' : `Exclusive rename is unavailable on ${platform()}.`
if (supported) {
  const result = spawnSync(process.env.CC || 'cc', ['-o', output, source], { encoding: 'utf8', timeout: 15_000 })
  if (result.status === 0 && existsSync(output)) chmodSync(output, 0o755)
  else reason = `The build could not provide an exclusive rename helper: ${result.error?.message || result.stderr?.trim() || 'compiler failed'}`
}
writeFileSync(manifest, JSON.stringify({ platform: platform(), arch: arch(), available: !reason, reason }) + '\n')
if (reason) console.warn(`[build] ${reason}`)
else console.log(`[build] exclusive rename helper -> ${output}`)
