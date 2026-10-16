import type { BridgeHandoff, BridgeTaskPage } from '@acorn/protocol/extensionBridge.ts'
import { siteText, type ProjectSite, type SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import { siteAccess } from '../handoffs'

// One website in Settings › Sites: what the extension does there, and the browser access its switch
// changes. Access and project suggestions are different things that share a row, so `uses` says what
// each is for and only `pattern` is access.
export type SiteRow = {
  // The access pattern the browser grants, or a regex association's own text, which names no host.
  key: string
  // Null for a regex, which asks for no access: its pages are read only where other access allows.
  pattern: string | null
  host: string
  // What the extension does there, such as "Look up items" or "Suggests Web".
  uses: string[]
  // The first plugin that uses the site, for its logo.
  pluginId: string | null
  // The project suggestions on this site, which its menu edits and removes.
  associations: ProjectSite[]
}

// Browser match patterns can't name a port in Firefox, so a project's `http://localhost:5173` asks for
// all of `http://localhost`. The association itself still matches only its own port.
const addressAccess = (address: string): string => `${new URL(address).protocol}//${new URL(address).hostname}/*`
function associationAccess(site: SiteAssociation): string | null {
  if ('regex' in site) return null
  // shortcut: https only, as the manifest offers each scheme apart; a domain on plain http needs its own row.
  if ('domain' in site) return `https://*.${site.domain}/*`
  return addressAccess('exact' in site ? site.exact : site.origin)
}
const hostOf = (pattern: string) => pattern.replace(/^https:\/\//, '').replace(/\/\*$/, '')

// Every site the selected Node's handoffs, project associations, and tasks' apps are on, one row per
// access pattern, in that order. docs/browser-extension/project-sites.md.
export function siteRows(input: {
  handoffs: readonly BridgeHandoff[]
  sites: readonly ProjectSite[]
  apps: readonly BridgeTaskPage[]
  projects: readonly { id: string; name: string }[]
}): SiteRow[] {
  const rows = new Map<string, SiteRow>()
  const row = (key: string, pattern: string | null, host: string) => {
    const known = rows.get(key) ?? { key, pattern, host, uses: [], pluginId: null, associations: [] }
    rows.set(key, known)
    return known
  }
  const use = (into: SiteRow, words: string, pluginId: string | null = null) => {
    if (!into.uses.includes(words)) into.uses.push(words)
    into.pluginId ??= pluginId
  }
  for (const handoff of input.handoffs)
    for (const pattern of siteAccess(handoff))
      use(
        row(pattern, pattern, hostOf(pattern)),
        handoff.anchors.length ? 'Task chips on its pages' : 'Look up items',
        handoff.pluginId,
      )
  for (const site of input.sites) {
    const pattern = associationAccess(site)
    const into = pattern ? row(pattern, pattern, hostOf(pattern)) : row(siteText(site), null, siteText(site))
    const project = input.projects.find((candidate) => candidate.id === site.projectId)
    use(into, `Suggests ${project?.name ?? 'a project'}`)
    into.associations.push(site)
  }
  for (const app of input.apps) {
    const pattern = addressAccess(app.origin)
    use(row(pattern, pattern, hostOf(pattern)), `Branch marker for ${app.status?.label ?? app.source}`, app.source)
  }
  return [...rows.values()]
}
