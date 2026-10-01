import { createContext, createSignal, onCleanup, useContext, type Accessor } from 'solid-js'
import type { SettingsNavigate } from '../../host/registries/shell/settings'

// A page that holds a list, such as custom agents or MCP servers, opens one item as a detail page in
// the same pane. The header is the settings view's, not the page's, so the view needs to know a detail
// is open: it names the item in the title and the breadcrumb, draws the back link to the list, and
// binds ⌘[ to it, the way it does for a workspace or a project (./SettingsView.tsx § back).
//
// A context like ./unsavedChanges.ts, so the same page drawn outside settings registers with nothing
// and draws its own back link instead.

export type SettingsDetail = {
  /** The item's name, which the header shows as the page title. */
  title: Accessor<string>
  /** Back to the list. The view runs it after asking about unsaved changes. */
  back: () => void
  /** Where `back` goes, for the back link, when that is not the page's own list: a step inside the
   *  detail going back to the step before it. */
  backLabel?: Accessor<string>
}

export type SettingsDetails = {
  /** Show `detail` in the header while the calling component is mounted. */
  register: (detail: SettingsDetail) => void
  /** The open detail, if any. */
  current: Accessor<SettingsDetail | undefined>
}

export function createSettingsDetails(): SettingsDetails {
  const [current, setCurrent] = createSignal<SettingsDetail>()
  return {
    register: (detail) => {
      setCurrent(() => detail)
      onCleanup(() => setCurrent((open) => (open === detail ? undefined : open)))
    },
    current,
  }
}

export const SettingsDetailContext = createContext<SettingsDetails>()

/** Tell settings a detail page is open, from the detail's component, so the header names it and offers
 *  the way back. Returns false when nothing is listening, which is the page's cue to draw its own back
 *  link. */
export function useSettingsDetail(title: Accessor<string>, back: () => void, backLabel?: Accessor<string>): boolean {
  const details = useContext(SettingsDetailContext)
  details?.register(backLabel ? { title, back, backLabel } : { title, back })
  return !!details
}

/**
 * Open one item of a list page as its detail from somewhere else in settings: Manage plugin on a
 * plugin's strip, a project's Connections tab, a connection's name in search. The item is a detail
 * rather than a page of its own, so the request waits here until the list page draws and takes it, or
 * is taken at once when that page is already on screen.
 *
 * The request is set only after settings has moved to the page, so an unsaved-changes question comes
 * first. Someone who chooses to stay does not find the item opened on a later visit, and a form on the
 * list page itself is not dropped before the question is asked.
 */
export function createDetailRequest<T>() {
  const [waiting, setWaiting] = createSignal<{ page: string; item: T }>()
  return {
    open: (navigate: SettingsNavigate, page: string, item: T): void =>
      navigate(page, () => setWaiting(() => ({ page, item }))),
    /** The item waiting for `page`, taken so it opens once. Call it from an effect on the list page. */
    take: (page: string): T | undefined => {
      const request = waiting()
      if (request?.page !== page) return undefined
      setWaiting(undefined)
      return request.item
    },
  }
}
