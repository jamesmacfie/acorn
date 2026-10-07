import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { arch, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CoreServices } from '@acorn/plugin-api/node'
import type { TrashAvailability } from '../contract/api'

type ProcessRunner = Pick<CoreServices['proc'], 'runProcess'>
type HelperManifest = { platform: string; arch: string; available: boolean; reason?: string }

// Vite places the plugin in dist/chunks; desktop staging and the standalone tarball copy the
// entire apps/node/dist directory. Tests can point at their own build artifact explicitly.
const artifactDirectory = (): string => process.env.ACORN_EXCLUSIVE_RENAME_DIR
  || join(dirname(fileURLToPath(import.meta.url)), '..')

export async function exclusiveRenameAvailability(): Promise<TrashAvailability> {
  if (platform() !== 'darwin' && platform() !== 'linux') return { available: false, reason: 'Exclusive rename is unavailable on this Node host.' }
  const directory = artifactDirectory()
  try {
    const manifest = JSON.parse(await readFile(join(directory, 'exclusive-rename.json'), 'utf8')) as HelperManifest
    if (!manifest.available) return { available: false, reason: manifest.reason || 'This Node build has no exclusive rename helper.' }
    if (manifest.platform !== platform() || manifest.arch !== arch()) return { available: false, reason: 'This Node build has no exclusive rename helper for this host.' }
    await access(join(directory, 'exclusive-rename'), constants.X_OK)
    return { available: true }
  } catch {
    return { available: false, reason: 'This Node build has no exclusive rename helper. Rebuild or update the Node.' }
  }
}

/** The kernel either moves the entry to an absent name or leaves both entries alone. */
export async function exclusiveRename(proc: ProcessRunner, from: string, to: string): Promise<void> {
  const support = await exclusiveRenameAvailability()
  if (!support.available) throw new Error(support.reason)
  const binary = join(artifactDirectory(), 'exclusive-rename')
  const result = await proc.runProcess({ file: binary, args: [from, to], cwd: dirname(from), timeoutMs: 30_000, maxOutputBytes: 4_096 })
  if (result.code === 0) return
  if (result.code === 17) throw new Error('A file or folder already has that name.')
  if (result.code === 18) throw new Error('This Node volume does not support exclusive rename.')
  throw new Error(`Exclusive rename failed: ${result.spawnError ?? result.stderr ?? 'unknown error'}`)
}
