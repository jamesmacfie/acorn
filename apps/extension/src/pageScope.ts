import { matchingSiteProjects, parseSiteAddress, type ProjectSite } from '@acorn/protocol/siteAssociations.ts'
import type { BrowserApi } from './browser'

// Which projects a page belongs to (docs/browser-extension/project-sites.md). The sidebar suggests
// them in its project picker and the background counts their waiting requests on the toolbar badge, so
// both decide it here, in the browser, from the cached associations and the person's choices.

type Storage = BrowserApi['storage']['local']

// The project the person chose on a site over what it suggested, per Node: `''` when they chose none.
// Keyed by the page's origin and the projects it suggested, so a page on the same site that suggests
// other projects keeps its own suggestion.
export type SiteChoices = Record<string, string>

export const siteChoiceKey = (origin: string, suggested: readonly string[]): string =>
  [origin, ...[...suggested].sort()].join(' ')

export const siteChoicesKey = (nodeId: string) => `siteChoices:${nodeId}`

export async function loadSiteChoices(storage: Storage, nodeId: string): Promise<SiteChoices> {
  const stored = (await storage.get([siteChoicesKey(nodeId)]))[siteChoicesKey(nodeId)]
  return stored && typeof stored === 'object' ? (stored as SiteChoices) : {}
}

export const saveSiteChoices = (storage: Storage, nodeId: string, choices: SiteChoices): Promise<void> =>
  storage.set({ [siteChoicesKey(nodeId)]: choices })

type PageScope = {
  // Every visible project with an association covering the page.
  suggested: string[]
  // Where the person's choice for this page is kept, or null for a page with no readable address.
  choiceKey: string | null
  // The page's projects: the person's choice when there is one, otherwise the suggestions.
  projects: string[]
}

// `visible` leaves out hidden projects, which the picker never offers. A choice of a project that has
// since gone or been hidden is ignored, and the suggestions stand.
export function pageScope(
  sites: readonly ProjectSite[],
  visible: ReadonlySet<string>,
  choices: SiteChoices,
  url: string | undefined,
): PageScope {
  const suggested = matchingSiteProjects(sites, url).filter((id) => visible.has(id))
  const page = url ? parseSiteAddress(url) : null
  const choiceKey = page?.ok ? siteChoiceKey(page.site.origin, suggested) : null
  const choice = choiceKey === null ? undefined : choices[choiceKey]
  if (choice === '') return { suggested, choiceKey, projects: [] }
  if (choice !== undefined && visible.has(choice)) return { suggested, choiceKey, projects: [choice] }
  return { suggested, choiceKey, projects: suggested }
}
