import { createEffect, createSignal, on, onCleanup, type Accessor } from 'solid-js'
import type { BrowserApi } from '../browser'

// The address of the tab beside the sidebar. The browser reports it only for a page this extension may
// read: a site the person granted, or the tab the toolbar button was clicked on. Handoff offers and
// project suggestions both match against it, in the browser, so it goes to the Node only when the
// person hands a page off or captures it. Call inside a component, which owns the listeners.
export function activePageUrl(api: BrowserApi, pageChecks: Accessor<number>): Accessor<string | undefined> {
  const [url, setUrl] = createSignal<string | undefined>()
  const read = async () => setUrl((await api.tabs.query({ active: true, currentWindow: true }))[0]?.url)
  const onActivated = () => void read()
  // A page this extension can't read reports no `url` when it navigates, as when the tab leaves the site
  // a toolbar click granted, so a finished load is read too. Otherwise the sidebar keeps the old page.
  const onUpdated = (_tabId: number, change: { url?: string; status?: string }) => {
    if (change.url !== undefined || change.status === 'complete') void read()
  }
  // A grant or a removal changes what the sidebar may read, from here or from the browser's settings.
  const onAccess = () => void read()

  void read()
  api.tabs.onActivated.addListener(onActivated)
  api.tabs.onUpdated.addListener(onUpdated)
  api.permissions.onAdded.addListener(onAccess)
  api.permissions.onRemoved.addListener(onAccess)
  onCleanup(() => {
    api.tabs.onActivated.removeListener(onActivated)
    api.tabs.onUpdated.removeListener(onUpdated)
    api.permissions.onAdded.removeListener(onAccess)
    api.permissions.onRemoved.removeListener(onAccess)
  })
  // A toolbar click can grant access to the active page without any tab event.
  createEffect(on(pageChecks, () => void read(), { defer: true }))
  return url
}
