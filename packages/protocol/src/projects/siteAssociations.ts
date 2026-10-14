import { z } from 'zod'

// A project's site associations (docs/browser-extension/project-sites.md): web addresses the person
// tied to the project, so the browser extension can suggest it on those pages. They are suggestions
// only: they grant no browser access and restrict no task. Machine-local project settings on the Node,
// never read from a committed `.acorn/config.toml`.

// An exact origin and a path prefix. Task pages and handoffs name pages this way too.
export type SiteAddress = { origin: string; pathPrefix: string }
// Each kind is its own shape, so the lists stored before domains, exact pages and patterns existed
// still read as prefixes.
export type SiteAssociation =
  // This address and every page under it.
  | SiteAddress
  // The host and its subdomains, on any page.
  | { domain: string }
  // One page: its origin and path, ignoring any query or fragment.
  | { exact: string }
  // A regular expression, tested against the page's whole address.
  | { regex: string }
// One association with the project it belongs to, as the extension caches them for matching.
export type ProjectSite = SiteAssociation & { projectId: string }

export type SiteKind = 'domain' | 'prefix' | 'exact' | 'regex'

export const siteKind = (site: SiteAssociation): SiteKind =>
  'domain' in site ? 'domain' : 'exact' in site ? 'exact' : 'regex' in site ? 'regex' : 'prefix'

// What the person would type for the association, which `parseSiteAssociation` reads back to it.
export const siteText = (site: SiteAssociation): string =>
  'domain' in site
    ? site.domain
    : 'exact' in site
      ? site.exact
      : 'regex' in site
        ? site.regex
        : site.origin + site.pathPrefix

export const SITE_ASSOCIATIONS_MAX = 32
const REGEX_MAX = 500

// A path prefix keeps no trailing slash, so `/docs` and `/docs/` are one association.
const trimPrefix = (path: string): string => path.replace(/\/+$/, '') || '/'

// Turns what the person typed, or a page's address, into an association: its origin, and its path as
// the prefix. A query or fragment is dropped. Refuses anything but http and https, and an address
// carrying a user name or password.
export function parseSiteAddress(input: string): { ok: true; site: SiteAddress } | { ok: false; reason: string } {
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

// Turns what the person typed into an association of that kind. A domain takes the host of whatever
// is typed, address or bare name. An exact page drops the query and fragment, as a prefix does.
export function parseSiteAssociation(
  kind: SiteKind,
  input: string,
): { ok: true; site: SiteAssociation } | { ok: false; reason: string } {
  const text = input.trim()
  if (kind === 'regex') {
    if (!text) return { ok: false, reason: 'Type a pattern.' }
    if (text.length > REGEX_MAX) return { ok: false, reason: `Keep the pattern under ${REGEX_MAX} characters.` }
    try {
      new RegExp(text)
    } catch {
      return { ok: false, reason: "That pattern isn't a valid regular expression." }
    }
    return { ok: true, site: { regex: text } }
  }
  if (kind === 'domain') {
    const parsed = parseSiteAddress(text.includes('://') ? text : `https://${text.replace(/^\*\./, '')}`)
    if (!parsed.ok) return { ok: false, reason: "That isn't a domain, such as example.com." }
    return { ok: true, site: { domain: new URL(parsed.site.origin).hostname } }
  }
  const parsed = parseSiteAddress(text)
  if (!parsed.ok || kind === 'prefix') return parsed
  return { ok: true, site: { exact: parsed.site.origin + parsed.site.pathPrefix } }
}

export const sameSite = (a: SiteAssociation, b: SiteAssociation): boolean =>
  siteKind(a) === siteKind(b) && siteText(a) === siteText(b)

// Only the form `parseSiteAssociation` gives, so two spellings of one address can't be stored as two
// associations, and nothing a browser would read differently gets in.
const isCanonical = (site: SiteAssociation): boolean => {
  const parsed = parseSiteAssociation(siteKind(site), siteText(site))
  return parsed.ok && sameSite(parsed.site, site)
}

export const siteAssociationSchema = z
  .union([
    z.strictObject({ origin: z.string().min(1).max(300), pathPrefix: z.string().startsWith('/').max(500) }),
    z.strictObject({ domain: z.string().min(1).max(253) }),
    z.strictObject({ exact: z.string().min(1).max(800) }),
    z.strictObject({ regex: z.string().min(1).max(REGEX_MAX) }),
  ])
  .refine(isCanonical, 'Use a domain, an http or https address with no user name or password, or a valid pattern.')

export const siteAssociationsSchema = z.array(siteAssociationSchema).max(SITE_ASSOCIATIONS_MAX)

// The origin must match exactly, port included. The prefix matches whole path segments: `/docs` covers
// `/docs` and `/docs/intro`, not `/docsearch`.
export function siteMatches(site: SiteAddress, address: string): boolean {
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

// Whether a project association covers the page. A domain covers its subdomains, on http or https and
// any port.
export function associationMatches(site: SiteAssociation, address: string): boolean {
  if ('regex' in site) {
    try {
      return new RegExp(site.regex).test(address)
    } catch {
      return false
    }
  }
  if (!('domain' in site || 'exact' in site)) return siteMatches(site, address)
  const page = parseSiteAddress(address)
  if (!page.ok) return false
  if ('exact' in site) return page.site.origin + page.site.pathPrefix === site.exact
  const host = new URL(page.site.origin).hostname
  return host === site.domain || host.endsWith(`.${site.domain}`)
}

// Every project with an association covering the page. Overlapping associations and several projects
// are all candidates; none outranks another.
export const matchingSiteProjects = (sites: readonly ProjectSite[], address: string | undefined): string[] =>
  address ? [...new Set(sites.filter((site) => associationMatches(site, address)).map((site) => site.projectId))] : []
