import type { Component } from 'solid-js'
import {
  isPluginSettingsCategory, isSettingsScope, SETTINGS_CATEGORIES, SETTINGS_SEARCH_MAX, SETTINGS_SECTION_ID_RE,
  type SettingsCategory, type SettingsScope as SettingsScopeKind,
} from '@acorn/protocol/settingsPages.ts'
import type { Project, Workspace } from '../../../infra/queries'
import { hasHostCapability, type HostCapabilityRequirement } from '../../../infra/node/hostCapabilities'
import { Registry, type Disposable } from '../../../kit/lib/state/registry'

export type { SettingsCategory, SettingsScopeKind }

/** What a page's body is looking at. `nodeId` is the node the page reads, which is the header's node
 *  switcher on a page that follows it and the active node on every other page. `null` only when the
 *  window is served by the node itself and there is no fleet to name one. */
export type SettingsPageScope = {
  nodeId: string | null
  workspace?: Workspace
  project?: Project
}

/** Open another settings page, `<pageId>` or `<pageId>#<sectionId>`, without leaving settings. A form
 *  holding unsaved changes asks first. `opened` runs once the page is on screen, and never when the
 *  person chooses to stay. */
export type SettingsNavigate = (target: string, opened?: () => void) => void

export type SettingsPageContext = {
  scope: SettingsPageScope
  navigate: SettingsNavigate
  /** The same value as `scope.workspace`. Kept until the next plugin API major. */
  workspace?: Workspace
  onWorkspaceDeleted: () => void
}

/** One `SettingsSection` on a page, declared beside the page so search and deep links can find it
 *  without drawing the page. `id` is the section's anchor. */
export type SettingsSectionDeclaration = {
  id: string
  label: string
  keywords?: readonly string[]
  /** The labels of the rows in the section. Search ranks them after section names and before
   *  keywords. Compiled pages only: a loaded plugin's manifest declares sections and keywords. */
  rows?: readonly string[]
}

export type SettingsContribution = {
  id: string
  label: string
  title?: string
  /** The rail group. Absent means `features`. A plugin may use six of the nine
   *  (@acorn/protocol/settingsPages.ts); the other three are core's. */
  category?: SettingsCategory
  /** What a change on the page affects, named in its header. Absent means `node`. */
  scope?: SettingsScopeKind
  /** A Lucide name or a `brand:` mark, like every other registry's glyph. */
  icon?: string
  /** The older placement. `workspace` means `scope: 'workspace'`; `general` means the defaults. */
  group?: 'general' | 'workspace'
  order: number
  /** The page reads and writes the node in `context.scope.nodeId`, so the header can offer the node
   *  switcher. Without it a node page's header names the active node, because that is what a body
   *  bound to the ambient API client reads. */
  followsNodeSwitcher?: boolean
  /** Words search matches besides the label, at most 16. Search only. */
  keywords?: readonly string[]
  /** The page's sections, at most 16, in the order the page draws them. Each is a search result and a
   *  deep-link target, `settings/<id>#<section id>`. */
  sections?: readonly SettingsSectionDeclaration[]
  /** Ids this page answered to before it absorbed another page, each `<oldId>` or
   *  `<oldId>#<sectionId>` naming the section the old page's rows now sit in. A deep link, the
   *  remembered page and `openSettings` keep landing. Consulted only when no page has the id, so an
   *  alias never takes a live page's place. */
  aliases?: readonly string[]
  /** Sources of this page's own plugin whose **Show in left rail** switch the host draws in the plugin
   *  strip above the page, in the plugin's source order. The switch is the host's, so the page's own
   *  code never reads or writes the preference. An id that names a core source or another plugin's is
   *  refused when the plugin registers (../extensionPoints/plugin.ts). Plugin pages only. */
  railSourceVisibility?: readonly string[]
  requires?: HostCapabilityRequirement
  component: Component<{ context: SettingsPageContext }>
}

export const settingsCategoryOf = (page: Pick<SettingsContribution, 'category'>): SettingsCategory =>
  page.category ?? 'features'

export const settingsScopeOf = (page: Pick<SettingsContribution, 'scope' | 'group'>): SettingsScopeKind =>
  page.scope ?? (page.group === 'workspace' ? 'workspace' : 'node')

/** The rail's group headings. Here rather than in the view because the palette's rows name the group
 *  too, and the two must not disagree. */
export const SETTINGS_CATEGORY_LABELS: Record<SettingsCategory, string> = {
  general: 'General',
  workspaces: 'Workspaces and projects',
  agents: 'Agents',
  connections: 'Connections',
  features: 'Features',
  automation: 'Automation',
  machines: 'Machines',
  plugins: 'Plugins',
  advanced: 'Advanced',
}

/** Why a plugin may not register this page, or `undefined` when it may. Checked at the compiled
 *  contribution point; a loaded plugin's manifest is checked by the node, which keeps the page and
 *  reports the value instead (node-core/server/plugins/manifest.ts). */
export const pluginSettingsPlacementProblem = (page: Pick<SettingsContribution, 'category' | 'scope'>): string | undefined => {
  if (page.category !== undefined && !isPluginSettingsCategory(page.category)) {
    return `category '${String(page.category)}' is not one a plugin can use`
  }
  if (page.scope !== undefined && !isSettingsScope(page.scope)) return `scope '${String(page.scope)}' is not a settings scope`
  return undefined
}

/** What is wrong with a page's search declarations, or `undefined`. Checked for every compiled page at
 *  registration, because a list past the limit is a mistake its author can fix; a loaded plugin's
 *  manifest is checked by the node, which keeps the page and reports the list instead. */
export const settingsSearchProblem = (page: Pick<SettingsContribution, 'keywords' | 'sections'>): string | undefined => {
  const over = (list: readonly unknown[] | undefined) => (list?.length ?? 0) > SETTINGS_SEARCH_MAX
  if (over(page.keywords)) return `more than ${SETTINGS_SEARCH_MAX} keywords`
  if (over(page.sections)) return `more than ${SETTINGS_SEARCH_MAX} sections`
  const seen = new Set<string>()
  for (const section of page.sections ?? []) {
    if (!SETTINGS_SECTION_ID_RE.test(section.id)) return `section id '${section.id}' is not a word a link can carry`
    if (seen.has(section.id)) return `section id '${section.id}' is declared twice`
    seen.add(section.id)
    if (over(section.keywords)) return `section '${section.id}' has more than ${SETTINGS_SEARCH_MAX} keywords`
    if (over(section.rows)) return `section '${section.id}' has more than ${SETTINGS_SEARCH_MAX} rows`
  }
  return undefined
}

/** A deep link, `settings/<pageId>#<sectionId>`. The prefix and the section are both optional, so a
 *  bare page id keeps working. */
export const parseSettingsTarget = (target: string): { pageId: string; sectionId?: string } => {
  const bare = target.startsWith('settings/') ? target.slice('settings/'.length) : target
  const hash = bare.indexOf('#')
  if (hash < 0) return { pageId: bare }
  const sectionId = bare.slice(hash + 1)
  return sectionId ? { pageId: bare.slice(0, hash), sectionId } : { pageId: bare.slice(0, hash) }
}

/** Where an old page id lands now: the page that lists it in `aliases`, and the section the alias
 *  names. `undefined` when a page still has the id, or nothing claims it. */
export const resolveSettingsAlias = (
  pages: readonly SettingsContribution[],
  pageId: string,
): { pageId: string; sectionId?: string } | undefined => {
  if (pages.some((page) => page.id === pageId)) return undefined
  for (const page of pages) {
    for (const alias of page.aliases ?? []) {
      const { pageId: old, sectionId } = parseSettingsTarget(alias)
      if (old === pageId) return sectionId ? { pageId: page.id, sectionId } : { pageId: page.id }
    }
  }
  return undefined
}

// Every page, core's and each plugin's, goes through the search check. A registry that accepted a page
// with seventeen sections would hand search a list nobody promised to rank.
class SettingsRegistry extends Registry<SettingsContribution> {
  override register(entry: SettingsContribution, owner?: string): Disposable {
    const problem = settingsSearchProblem(entry)
      // Core's sources are never hidden, so a switch on one of core's pages would have nothing to name.
      ?? (entry.railSourceVisibility?.length && !owner ? 'railSourceVisibility is for a plugin\'s own page' : undefined)
    if (problem) throw new Error(`Settings page '${entry.id}': ${problem}`)
    return super.register(entry, owner)
  }
}

export const settingsRegistry = new SettingsRegistry('settings')
export const settingsContributions = (): readonly SettingsContribution[] =>
  [...settingsRegistry.entries()]
    .filter((page) => hasHostCapability(page.requires))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

/** Every available page in the rail's order: by group, then by each page's `order`. */
export const settingsPagesInOrder = (): readonly SettingsContribution[] => {
  const rank = (page: SettingsContribution) => SETTINGS_CATEGORIES.indexOf(settingsCategoryOf(page))
  return [...settingsContributions()].sort((a, b) => rank(a) - rank(b) || a.order - b.order || a.id.localeCompare(b.id))
}

/** A page that stands on its own in the rail. A workspace or project page is drawn inside the
 *  workspace or project it describes, so it has no row of its own. */
export const isStandaloneSettingsPage = (page: SettingsContribution): boolean => {
  const scope = settingsScopeOf(page)
  return scope !== 'workspace' && scope !== 'project'
}

/** A workspace's and a project's own settings pages are addressed by what they describe, not by a
 *  registered id: `settings/workspace/<workspaceId>` and `settings/project/<projectId>`, each taking a
 *  `#<sectionId>` like any other page. Ids rather than names, so a rename never breaks a link. */
export const WORKSPACE_SETTINGS_PREFIX = 'workspace/'
export const PROJECT_SETTINGS_PREFIX = 'project/'
export const workspaceSettingsTarget = (workspaceId: string): string => `${WORKSPACE_SETTINGS_PREFIX}${workspaceId}`
export const projectSettingsTarget = (projectId: string): string => `${PROJECT_SETTINGS_PREFIX}${projectId}`

/** The page core draws for every workspace or every project, found by what it is rather than by id:
 *  that scope, filed under Workspaces and projects, which only core may use. */
export const settingsDetailPage = (pages: readonly SettingsContribution[], scope: 'workspace' | 'project'): SettingsContribution | undefined =>
  pages.find((page) => settingsScopeOf(page) === scope && settingsCategoryOf(page) === 'workspaces')

/** Every other page with that scope, a plugin's among them, in rail order. Each is drawn as a tab on
 *  the workspace's or the project's page rather than as a rail row. */
export const settingsDetailTabs = (pages: readonly SettingsContribution[], scope: 'workspace' | 'project'): SettingsContribution[] =>
  pages.filter((page) => settingsScopeOf(page) === scope && settingsCategoryOf(page) !== 'workspaces')
