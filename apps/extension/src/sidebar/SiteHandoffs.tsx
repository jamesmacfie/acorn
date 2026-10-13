import { For, Show, createEffect, createResource, createSignal, on, onCleanup, onMount } from 'solid-js'
import type { BridgeHandoff } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi } from '../browser'
import { pageHandoffs, siteAccess, type PageHandoff } from '../handoffs'

// The sidebar's side of site buttons: the same handoffs for the page showing beside it, which works
// when a site's layout has no anchor for the button, and the per-site access that shows the buttons
// at all. docs/browser-extension/handoffs.md.
export function SiteHandoffs(props: {
  api: BrowserApi
  handoffs: readonly BridgeHandoff[]
  start(handoff: PageHandoff): void
  // Changes after a toolbar click, which can grant access to the active page without a tab event.
  pageChecks: number
}) {
  // The active tab's address, which the browser reports only for a page this extension may read.
  const [pageUrl, setPageUrl] = createSignal<string | undefined>()
  const readTab = async () => setPageUrl((await props.api.tabs.query({ active: true, currentWindow: true }))[0]?.url)
  const onActivated = () => void readTab()
  const onUpdated = (_tabId: number, change: { url?: string }) => {
    if (change.url !== undefined) void readTab()
  }
  // A grant or a removal changes what the sidebar may read, from here or from the browser's settings.
  const onAccess = () => {
    void readTab()
    void refetch()
  }
  onMount(() => {
    void readTab()
    props.api.tabs.onActivated.addListener(onActivated)
    props.api.tabs.onUpdated.addListener(onUpdated)
    props.api.permissions.onAdded.addListener(onAccess)
    props.api.permissions.onRemoved.addListener(onAccess)
  })
  onCleanup(() => {
    props.api.tabs.onActivated.removeListener(onActivated)
    props.api.tabs.onUpdated.removeListener(onUpdated)
    props.api.permissions.onAdded.removeListener(onAccess)
    props.api.permissions.onRemoved.removeListener(onAccess)
  })

  createEffect(
    on(
      () => props.pageChecks,
      () => void readTab(),
      { defer: true },
    ),
  )

  const offers = () => pageHandoffs(props.handoffs, pageUrl())
  const sites = () => [...new Set(props.handoffs.flatMap(siteAccess))]

  // Which sites the person has granted. Read again after each change, and whenever the list changes.
  const [granted, { refetch }] = createResource(
    sites,
    async (origins) =>
      new Map(
        await Promise.all(
          origins.map(async (origin) => [origin, await props.api.permissions.contains({ origins: [origin] })] as const),
        ),
      ),
  )
  // `request` must run inside the person's click, so nothing is awaited before it. The permission
  // events read the grants again.
  const grant = (origin: string) => void props.api.permissions.request({ origins: [origin] })
  const revoke = (origin: string) => void props.api.permissions.remove({ origins: [origin] })
  const siteName = (origin: string) => origin.replace(/^https:\/\//, '').replace(/\/\*$/, '')

  return (
    <Show when={props.handoffs.length}>
      <section class="card" aria-label="Site buttons">
        <For each={offers()}>
          {(handoff) => (
            <div class="row">
              <button
                type="button"
                onClick={() =>
                  props.start({
                    pluginId: handoff.pluginId,
                    handoffId: handoff.id,
                    label: handoff.label,
                    url: pageUrl()!,
                  })
                }
              >
                {handoff.label}
              </button>
              <span class="quiet">this page</span>
            </div>
          )}
        </For>
        <ul>
          <For each={sites()}>
            {(origin) => (
              <li>
                <span class="quiet">
                  {granted()?.get(origin) ? `Buttons show on ${siteName(origin)}` : `No buttons on ${siteName(origin)}`}
                </span>
                <Show
                  when={granted()?.get(origin)}
                  fallback={
                    <button type="button" class="quiet" onClick={() => grant(origin)}>
                      Allow
                    </button>
                  }
                >
                  <button type="button" class="quiet" onClick={() => revoke(origin)}>
                    Remove
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  )
}
