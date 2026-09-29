import { createSignal } from 'solid-js'
import {
  isStandaloneSettingsPage, parseSettingsTarget, PROJECT_SETTINGS_PREFIX, resolveSettingsAlias, settingsCategoryOf,
  settingsPagesInOrder, WORKSPACE_SETTINGS_PREFIX, type SettingsCategory, type SettingsContribution,
} from '@acorn/client-core/host/registries/shell'
import { closeOverlay, openOverlay } from './state'

// Where the terminal's Settings route is: the list of groups, one group's pages, or one page.
//
// Module state rather than the route's own, because the shell draws only the top overlay. The palette
// opened over settings unmounts it, and closing the palette mounts it again, so a place held in the
// component would put the reader back at the list of groups every time. Session-only, unlike the
// desktop's remembered page: nothing here is worth a write to the device's preference file.

export type SettingsPlace = { category?: SettingsCategory; pageId?: string }

const [place, setPlace] = createSignal<SettingsPlace>({})
const [missing, setMissing] = createSignal('')
export { place as settingsPlace, setPlace as setSettingsPlace, missing as settingsMissing }

/** Every page the route lists, in the rail's order. A workspace's and a project's own pages are drawn
 *  inside the workspace or project on the desktop and have no row of their own there either. */
export const listedSettingsPages = (): readonly SettingsContribution[] =>
  settingsPagesInOrder().filter(isStandaloneSettingsPage)

/** Where a deep link lands: `settings/<pageId>#<sectionId>`, a bare page id, or an old id a page
 *  absorbed. A workspace or project page lands on Overview, which is where this host lists them. The
 *  section is not used: this host has no way to scroll a page to one. */
export function placeFor(target: string): SettingsPlace | undefined {
  let { pageId } = parseSettingsTarget(target)
  if (pageId.startsWith(WORKSPACE_SETTINGS_PREFIX) || pageId.startsWith(PROJECT_SETTINGS_PREFIX)) pageId = 'workspaces'
  const pages = listedSettingsPages()
  pageId = resolveSettingsAlias(pages, pageId)?.pageId ?? pageId
  const page = pages.find((candidate) => candidate.id === pageId)
  return page ? { category: settingsCategoryOf(page), pageId: page.id } : undefined
}

/** Open the route, on `target` when one is given and on the last place otherwise. A target that names
 *  no page on this node opens the list of groups and says so, rather than opening nothing. */
export function openSettings(target?: string): void {
  if (target) {
    const next = placeFor(target)
    setMissing(next ? '' : 'That settings page is not available on this node.')
    setPlace(next ?? {})
  } else {
    setMissing('')
  }
  openOverlay('settings')
}

export function closeSettings(): void {
  setMissing('')
  closeOverlay('settings')
}

/** The fixture builds more than one shell in one process. */
export function resetSettings(): void {
  setPlace({})
  setMissing('')
}
