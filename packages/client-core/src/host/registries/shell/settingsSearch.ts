import {
  isStandaloneSettingsPage, SETTINGS_CATEGORY_LABELS, settingsCategoryOf, settingsScopeOf,
  type SettingsContribution, type SettingsNavigate, type SettingsScopeKind, type SettingsSectionDeclaration,
} from './settings'

// Settings search (docs/frontend.md § Settings). Built from declarations only: each page's label,
// keywords and sections, each section's row labels and keywords, and the names of the things settings
// holds pages for, handed in by the caller. Nothing reads a rendered control, so a page is findable
// before it has ever been opened, and a page that renders slowly ranks the same as one that does not.
//
// One index behind two surfaces: the rail's search field and the palette's Settings group. The
// palette keeps its own matcher and takes the section rows from `settingsSectionEntries`, so both list
// the same sections under the same names.

/** How strongly an entry matched, best first: the page's name, a section's name, a row's label, then a
 *  keyword. The names of workspaces, nodes and the rest count as pages or sections, by where they land. */
export type SettingsSearchTier = 0 | 1 | 2 | 3

export type SettingsSearchEntry = {
  /** What the result opens: a page id, or another rail key such as a workspace's. */
  page: string
  section?: string
  /** The two halves of the result's title, **Page › Section**. */
  pageLabel: string
  sectionLabel?: string
  /** The rail group, for the palette's hint. */
  group: string
  scope: SettingsScopeKind
  text: string
  tier: SettingsSearchTier
  /** Opens the thing itself, for a thing whose page is a detail of a list, as a connection's is. */
  open?: (navigate: SettingsNavigate) => void
}

/** A thing with a name that settings has a page for: a workspace, a project, a connection, a node, a
 *  plugin. Resolved to its page by the caller, which knows where each one lives. */
export type SettingsSearchObject = {
  name: string
  page: string
  pageLabel: string
  group: string
  scope: SettingsScopeKind
  /** Other words that find it, matched as keywords: a plugin's id, which is what the command line and
   *  config files call it, beside the name it shows. */
  keywords?: readonly string[]
  /** A page of its own, as a workspace is, rather than a thing listed on another page. */
  isPage?: boolean
  /** The sections of the page drawn for it, for a thing whose page is one registration drawn once per
   *  thing: every workspace's page has the workspace page's sections. */
  sections?: readonly SettingsSectionDeclaration[]
  /** Opens the thing's own page when that page is a detail of the list at `page`. */
  open?: (navigate: SettingsNavigate) => void
}

export function buildSettingsIndex(
  pages: readonly SettingsContribution[],
  objects: readonly SettingsSearchObject[] = [],
): SettingsSearchEntry[] {
  const entries: SettingsSearchEntry[] = []
  const addSections = (base: Omit<SettingsSearchEntry, 'text' | 'tier'>, sections: readonly SettingsSectionDeclaration[]) => {
    for (const section of sections) {
      const at = { ...base, section: section.id, sectionLabel: section.label }
      entries.push({ ...at, text: section.label, tier: 1 })
      for (const row of section.rows ?? []) entries.push({ ...at, text: row, tier: 2 })
      for (const word of section.keywords ?? []) entries.push({ ...at, text: word, tier: 3 })
    }
  }
  for (const page of pages) {
    if (!isStandaloneSettingsPage(page)) continue
    const base = {
      page: page.id,
      pageLabel: page.title ?? page.label,
      group: SETTINGS_CATEGORY_LABELS[settingsCategoryOf(page)],
      scope: settingsScopeOf(page),
    }
    entries.push({ ...base, text: base.pageLabel, tier: 0 })
    for (const word of page.keywords ?? []) entries.push({ ...base, text: word, tier: 3 })
    addSections(base, page.sections ?? [])
  }
  for (const object of objects) {
    const base = {
      page: object.page, pageLabel: object.isPage ? object.name : object.pageLabel, group: object.group, scope: object.scope,
      ...(object.open ? { open: object.open } : {}),
    }
    const named = { ...base, ...(object.isPage ? {} : { sectionLabel: object.name }) }
    entries.push({ ...named, text: object.name, tier: object.isPage ? 0 : 1 })
    for (const word of object.keywords ?? []) entries.push({ ...named, text: word, tier: 3 })
    addSections(base, object.sections ?? [])
  }
  return entries
}

export type SettingsSearchResult = SettingsSearchEntry & {
  /** The text that matched, when it is not already in the title: a row's label or a keyword. */
  matched?: string
}

/**
 * The entries `query` matches, one per place they land, ranked by tier and then by where in the
 * text the query matched: the start of the text, then the start of a word, then anywhere. Ties put a
 * section before a page and then keep declaration order, which is the rail's order.
 */
export function searchSettings(index: readonly SettingsSearchEntry[], query: string): SettingsSearchResult[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const best = new Map<string, { entry: SettingsSearchEntry; score: number; order: number }>()
  index.forEach((entry, order) => {
    const text = entry.text.toLowerCase()
    const at = text.indexOf(needle)
    if (at < 0) return
    const where = at === 0 ? 0 : /[\s\-_/.]/.test(text[at - 1]) ? 1 : 2
    const score = entry.tier * 3 + where
    // A section result and a page result are different places, but a section's row and the section
    // itself are the same one, so they share a key and the better match stands for both.
    const key = entry.section ? `${entry.page}#${entry.section}` : entry.sectionLabel ? `${entry.page}@${entry.sectionLabel}` : entry.page
    const held = best.get(key)
    if (!held || score < held.score) best.set(key, { entry, score, order: held ? Math.min(held.order, order) : order })
  })
  return [...best.values()]
    // At an equal score the section wins over its page: a keyword both declare says more about where
    // to land when the section declares it.
    .sort((a, b) => a.score - b.score || Number(!a.entry.section) - Number(!b.entry.section) || a.order - b.order)
    .map(({ entry }) => {
      const shown = entry.text === entry.pageLabel || entry.text === entry.sectionLabel
      return shown ? entry : { ...entry, matched: entry.text }
    })
}

/** Every declared section, as the palette lists them: one row per section, after the page rows. */
export function settingsSectionEntries(pages: readonly SettingsContribution[]): SettingsSearchEntry[] {
  return buildSettingsIndex(pages).filter((entry) => entry.tier === 1 && entry.section)
}

/** The keywords and row labels a section's palette row matches beside its title. */
export function sectionSearchWords(page: SettingsContribution, sectionId: string): string[] {
  const section = page.sections?.find((candidate) => candidate.id === sectionId)
  return section ? [...(section.rows ?? []), ...(section.keywords ?? [])] : []
}
