import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { scaffoldFiles } from 'create-acorn-plugin'
import { PLUGIN_SEED_STATE_FILE, type PluginPackageRequest } from '../shared/api'
import type { AppStore } from './store'

// Turn into a plugin (docs/agent-built-apps/project-apps.md § Turn into a plugin). The package is the
// scaffold's tree template, the one `npm create acorn-plugin` writes, with the plugins behind the app's
// data sources in `requires`. The app's saved state goes in the folder as a seed the owner can load or
// delete. An agent session then rebuilds the app's UI in the folder.

/** Writes the package into `folder`, which must be missing or empty. Answers `not-empty` otherwise, and
 *  null when the app isn't a live project app that has been shown. */
export async function writePluginPackage(
  store: AppStore,
  appId: string,
  request: PluginPackageRequest,
): Promise<'written' | 'not-empty' | null> {
  const meta = await store.meta(appId)
  if (!meta?.projectId || meta.deletedAt || !meta.head) return null
  const { folder } = request
  // Anything but a missing folder or an empty one is refused, so nothing of the owner's is overwritten.
  const entries = await readdir(folder).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? [] : null))
  if (!entries || entries.length) return 'not-empty'

  const files = scaffoldFiles(request.pluginId, request.name)
  const manifest = JSON.parse(files['acorn-plugin.json']!) as Record<string, unknown>
  if (request.requires.plugins.length)
    files['acorn-plugin.json'] = `${JSON.stringify({ ...manifest, requires: request.requires }, null, 2)}\n`
  files[PLUGIN_SEED_STATE_FILE] = `${JSON.stringify(await store.state(appId), null, 2)}\n`
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true })
    await writeFile(join(folder, path), text, { flag: 'wx' })
  }
  return 'written'
}
