// Archive work runs only on an explicit install, in a disposable process. The process broker
// awaits close after deadline termination before the caller removes staging.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runProcess } from '../core/proc'
import { MAX_PLUGIN_FILE_BYTES, MAX_PLUGIN_PACKAGE_BYTES, MAX_PLUGIN_PACKAGE_DEPTH, MAX_PLUGIN_PACKAGE_ENTRIES } from './packageFiles'

export const PLUGIN_ARCHIVE_LIMITS = {
  expandedBytes: MAX_PLUGIN_PACKAGE_BYTES,
  fileBytes: MAX_PLUGIN_FILE_BYTES,
  logicalBytes: MAX_PLUGIN_PACKAGE_BYTES,
  members: MAX_PLUGIN_PACKAGE_ENTRIES,
  depth: MAX_PLUGIN_PACKAGE_DEPTH,
  pathBytes: 4096,
  metadataBytes: 64 * 1024,
  timeoutMs: 120_000,
}

export async function unpackPluginArchive(archive: string, into: string, limits = PLUGIN_ARCHIVE_LIMITS): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = import.meta.url.endsWith('.ts')
    ? [join(here, 'archiveWorker.ts')]
    : [join(here, 'archive-worker.js'), join(here, '..', 'archive-worker.js')]
  const entry = candidates.find(existsSync)
  if (!entry) throw new Error('The plugin archive worker is missing from this build.')
  const result = await runProcess({
    file: process.execPath,
    args: ['--max-old-space-size=128', entry],
    cwd: here,
    stdin: JSON.stringify({ archive, into, limits }),
    maxOutputBytes: 4096,
    timeoutMs: limits.timeoutMs,
    killGraceMs: 250,
  })
  if (result.timedOut) throw new Error('The plugin archive exceeded its unpacking deadline.')
  if (result.aborted || result.truncated) throw new Error('The plugin archive process returned an incomplete result.')
  if (result.spawnError) throw new Error('The plugin archive process could not start.')
  let response: { ok?: unknown; error?: unknown }
  try { response = JSON.parse(result.stdout) } catch { throw new Error('The plugin archive process did not return a complete result.') }
  if (result.code !== 0 || response.ok !== true) {
    throw new Error(typeof response.error === 'string' ? response.error : 'The plugin archive could not be unpacked.')
  }
}
