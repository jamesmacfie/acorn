import { z } from 'zod'

// A project's site associations (docs/browser-extension/project-sites.md): web addresses the person
// tied to the project, so the browser extension can suggest it on those pages. Each is an exact origin
// and a path prefix. They are suggestions only: they grant no browser access and restrict no task.
// Machine-local project settings on the Node, never read from a committed `.acorn/config.toml`.

export type SiteAssociation = { origin: string; pathPrefix: string }
// One association with the project it belongs to, as the extension caches them for matching.
export type ProjectSite = SiteAssociation & { projectId: string }

export const SITE_ASSOCIATIONS_MAX = 32

// A path prefix keeps no trailing slash, so `/docs` and `/docs/` are one association.
const trimPrefix = (path: string): string => path.replace(/\/+$/, '') || '/'

// Turns what the person typed, or a page's address, into an association: its origin, and its path as
// the prefix. A query or fragment is dropped. Refuses anything but http and https, and an address
// carrying a user name or password.
export function parseSiteAddress(input: string): { ok: true; site: SiteAssociation } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return { ok: false, reason: "That isn't a web address. Start it with http:// or https://." }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, reason: 'Use an http:// or https:// address.' }
  if (url.username || url.password) return { ok: false, reason: 'Leave the user name and password out.' }
  return { ok: true, site: { origin: url.origin, pathPrefix: trimPrefix(url.pathname) } }
}

// Only the form `parseSiteAddress` gives, so two spellings of one address can't be stored as two
// associations, and nothing a browser would read differently gets in.
const isCanonical = (site: SiteAssociation): boolean => {
  const parsed = parseSiteAddress(site.origin + site.pathPrefix)
  return parsed.ok && parsed.site.origin === site.origin && parsed.site.pathPrefix === site.pathPrefix
}

export const siteAssociationSchema = z
  .strictObject({
    origin: z.string().min(1).max(300),
    pathPrefix: z.string().startsWith('/').max(500),
  })
  .refine(isCanonical, 'Use an exact http or https origin and a path, with no user name or password.')

export const siteAssociationsSchema = z.array(siteAssociationSchema).max(SITE_ASSOCIATIONS_MAX)

export const sameSite = (a: SiteAssociation, b: SiteAssociation): boolean =>
  a.origin === b.origin && a.pathPrefix === b.pathPrefix

// The origin must match exactly, port included. The prefix matches whole path segments: `/docs` covers
// `/docs` and `/docs/intro`, not `/docsearch`.
export function siteMatches(site: SiteAssociation, address: string): boolean {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return false
  }
  if (url.origin !== site.origin) return false
  const prefix = site.pathPrefix
  return prefix === '/' || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
}

// Every project with an association covering the page. Overlapping prefixes and several projects are
// all candidates; none outranks another.
export const matchingSiteProjects = (sites: readonly ProjectSite[], address: string | undefined): string[] =>
  address ? [...new Set(sites.filter((site) => siteMatches(site, address)).map((site) => site.projectId))] : []
