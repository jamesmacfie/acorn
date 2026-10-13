import { For, Show, createResource, onCleanup, onMount } from 'solid-js'
import type { BridgeHandoff } from '@acorn/protocol/extensionBridge.ts'
import type { ProjectSite } from '@acorn/protocol/siteAssociations.ts'
import type { BrowserApi } from '../browser'
import { pageHandoffs, siteAccess, type PageHandoff } from '../handoffs'

type SiteUse = 'buttons' | 'sidebar' | 'projects'
const USE_LABELS: Record<SiteUse, string> = {
  buttons: 'Buttons on its pages',
  sidebar: 'Handoffs in this sidebar',
  projects: 'Project suggestions',
}

// Browser match patterns can't name a port in Firefox, so a project's `http://localhost:5173` asks for
// all of `http://localhost`. The association itself still matches only its own port.
const associationAccess = (site: ProjectSite): string =>
  `${new URL(site.origin).protocol}//${new URL(site.origin).hostname}/*`

// The sidebar's side of site buttons: the same handoffs for the page showing beside it, which works
// when a site's layout has no anchor for the button, and the per-site access that lets the extension
// read a site's pages at all, for buttons, sidebar handoffs, or project suggestions.
// docs/browser-extension/handoffs.md.
export function SiteAccess(props: {
  api: BrowserApi
  handoffs: readonly BridgeHandoff[]
  sites: readonly ProjectSite[]
  pageUrl: string | undefined
  start(handoff: PageHandoff): void
}) {
  const offers = () => pageHandoffs(props.handoffs, props.pageUrl)
  // Each site this Node's handoffs or project associations are on, with what access to it is for.
  const sites = () => {
    const uses = new Map<string, Set<SiteUse>>()
    const add = (pattern: string, use: SiteUse) => uses.set(pattern, (uses.get(pattern) ?? new Set()).add(use))
    for (const handoff of props.handoffs)
      for (const pattern of siteAccess(handoff)) add(pattern, handoff.anchors.length ? 'buttons' : 'sidebar')
    for (const site of props.sites) add(associationAccess(site), 'projects')
    return [...uses].map(([pattern, used]) => ({ pattern, uses: [...used].map((use) => USE_LABELS[use]).join(' · ') }))
  }

  // Which sites the person has granted. Read again after each change, and whenever the list changes.
  const [granted, { refetch }] = createResource(
    () => sites().map((site) => site.pattern),
    async (patterns) =>
      new Map(
        await Promise.all(
          patterns.map(
            async (pattern) => [pattern, await props.api.permissions.contains({ origins: [pattern] })] as const,
          ),
        ),
      ),
  )
  const onAccess = () => void refetch()
  onMount(() => {
    props.api.permissions.onAdded.addListener(onAccess)
    props.api.permissions.onRemoved.addListener(onAccess)
  })
  onCleanup(() => {
    props.api.permissions.onAdded.removeListener(onAccess)
    props.api.permissions.onRemoved.removeListener(onAccess)
  })
  // `request` must run inside the person's click, so nothing is awaited before it. The permission
  // events read the grants again.
  const grant = (pattern: string) => void props.api.permissions.request({ origins: [pattern] })
  const revoke = (pattern: string) => void props.api.permissions.remove({ origins: [pattern] })
  const siteName = (pattern: string) => pattern.replace(/^https:\/\//, '').replace(/\/\*$/, '')

  return (
    <Show when={sites().length}>
      <section class="card" aria-label="Site access">
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
                    url: props.pageUrl!,
                  })
                }
              >
                {handoff.label}
              </button>
              <span class="quiet">this page</span>
            </div>
          )}
        </For>
        <h2>Site access</h2>
        <ul>
          <For each={sites()}>
            {(site) => (
              <li>
                <div>
                  <strong>{siteName(site.pattern)}</strong>
                  <span class="quiet">
                    {site.uses}
                    {granted()?.get(site.pattern) ? ' · Allowed' : ' · Not allowed'}
                  </span>
                </div>
                <Show
                  when={granted()?.get(site.pattern)}
                  fallback={
                    <button type="button" class="quiet" onClick={() => grant(site.pattern)}>
                      Allow
                    </button>
                  }
                >
                  <button type="button" class="quiet" onClick={() => revoke(site.pattern)}>
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
