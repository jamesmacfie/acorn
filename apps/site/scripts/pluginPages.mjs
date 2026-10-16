// Every plugin acorn ships, read from where the app lists them, and the checks that each has an entry
// in src/data/plugins.ts, a docs page, and a reason for every permission it asks for (docs/site/built-in-plugins.md).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { permissionKeys } from '../src/lib/pluginPermissions.ts'
import { ROOT } from './stale.mjs'

// The compiled roster is the plugins the desktop, the terminal client, and the Node each import, read as
// text because none of the three loads in plain Node. The Node alone runs the agent browser, and only
// the clients run the Context pane and the first-run wizard.
const COMPILED = ['apps/desktop/src/client/plugins.ts', 'apps/tui/src/roster.ts', 'apps/node/src/composition/plugins.ts']
// The bundled packages, read as text because importing the script builds them.
const BUNDLED = 'apps/desktop/scripts/build-bundled-plugins.mjs'

const read = (path) => readFileSync(join(ROOT, path), 'utf8')

/** The plugins acorn ships: `compiled` into the app, and `bundled` as installed packages. */
export function shippedPlugins() {
  const compiled = COMPILED.flatMap((file) => [...read(file).matchAll(/'@acorn\/plugin-([\w-]+)\//g)].map((m) => m[1]))
  const list = read(BUNDLED).match(/const BUNDLED_PLUGINS = \[([^\]]*)\]/)?.[1] ?? ''
  return {
    compiled: [...new Set(compiled)].sort(),
    bundled: [...list.matchAll(/'([\w-]+)'/g)].map((m) => m[1]),
  }
}

/** Every grant a bundled package's manifest asks for. */
export async function manifestKeys(id) {
  const config = pathToFileURL(join(ROOT, 'plugins', id, 'acorn-plugin.config.mjs')).href
  return permissionKeys((await import(config)).default.permissions)
}

const DOCS = 'apps/site/src/content/docs'
/** Whether a docs URL, such as `/docs/built-in-plugins/git/`, has a page. */
const docsPageExists = (url) => {
  const path = url.replace(/#.*$/, '').replace(/^\/|\/$/g, '')
  return ['.md', '.mdx', '/index.md', '/index.mdx'].some((ending) => existsSync(join(ROOT, DOCS, `${path}${ending}`)))
}

/** What's wrong between the plugins acorn ships and the site's list of them. `keys` maps each bundled
 *  package to the grants its manifest asks for. */
export function rosterProblems({ compiled, bundled }, plugins, keys, pageExists = docsPageExists) {
  const ships = new Map([...compiled.map((id) => [id, 'compiled']), ...bundled.map((id) => [id, 'package'])])
  const problems = []
  for (const [id, kind] of ships) {
    const plugin = plugins[id]
    if (!plugin) {
      problems.push(`${id} ships, and src/data/plugins.ts has no entry for it`)
      continue
    }
    if (plugin.ships !== kind) problems.push(`${id} ships as ${kind}, and src/data/plugins.ts says ${plugin.ships}`)
    if (!pageExists(plugin.docs)) problems.push(`${id} links to ${plugin.docs}, which has no page`)
  }
  for (const id of Object.keys(plugins)) {
    if (!ships.has(id)) problems.push(`src/data/plugins.ts lists ${id}, which acorn doesn't ship`)
  }
  for (const id of bundled) {
    const reasons = plugins[id]?.reasons ?? {}
    const asked = keys[id] ?? []
    for (const key of asked) {
      if (!(key in reasons)) problems.push(`${id} asks for ${key}, and its page gives no reason`)
    }
    for (const key of Object.keys(reasons)) {
      if (!asked.includes(key)) problems.push(`${id}'s page gives a reason for ${key}, which it doesn't ask for`)
    }
  }
  return problems
}
