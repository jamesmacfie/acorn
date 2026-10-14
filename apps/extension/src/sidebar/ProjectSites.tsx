import { For, Show, createSignal } from 'solid-js'
import { parseSiteAddress, sameSite, type SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import { CallFailure } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'

const display = (site: SiteAssociation) => site.origin + (site.pathPrefix === '/' ? '' : site.pathPrefix)

// One project's site associations on the Node: the pages the sidebar suggests it on. Separate from site
// access, which the browser grants and which these never widen. docs/browser-extension/project-sites.md.
export function ProjectSites(props: {
  client: BridgeClient
  nodeId: string
  projectId: string
  sites: readonly SiteAssociation[]
  pageUrl: string | undefined
  online: boolean
  // The Node's list for that project after a change.
  changed(projectId: string, sites: SiteAssociation[]): void
}) {
  const [address, setAddress] = createSignal('')
  const [problem, setProblem] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  // The site beside the sidebar, offered when the project doesn't have it yet.
  const pageSite = () => {
    const parsed = props.pageUrl ? parseSiteAddress(props.pageUrl) : null
    if (!parsed?.ok) return null
    const site = { origin: parsed.site.origin, pathPrefix: '/' }
    return props.sites.some((other) => sameSite(other, site)) ? null : site
  }

  const change = async (op: 'site.add' | 'site.remove', site: SiteAssociation): Promise<boolean> => {
    setBusy(true)
    setProblem(null)
    try {
      const result = await props.client.call({ op, nodeId: props.nodeId, projectId: props.projectId, site })
      props.changed(result.projectId, result.sites)
      return true
    } catch (error) {
      setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async (event: SubmitEvent) => {
    event.preventDefault()
    const parsed = parseSiteAddress(address())
    if (!parsed.ok) return setProblem(parsed.reason)
    if (await change('site.add', parsed.site)) setAddress('')
  }

  return (
    <div class="sites">
      <p class="quiet">The panel suggests this project on these pages. They give Acorn no access to a site.</p>
      <Show when={props.sites.length}>
        <ul class="rows">
          <For each={props.sites}>
            {(site) => (
              <li>
                <span class="grow" data-testid="project-site">
                  {display(site)}
                </span>
                <button
                  type="button"
                  class="quiet"
                  disabled={busy() || !props.online}
                  onClick={() => void change('site.remove', site)}
                >
                  Remove
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <form class="row" onSubmit={(event) => void add(event)}>
        <input
          name="site"
          placeholder="https://example.com/path"
          value={address()}
          onInput={(event) => setAddress(event.currentTarget.value)}
        />
        <button type="submit" disabled={busy() || !props.online || !address().trim()}>
          Add
        </button>
      </form>
      <Show when={pageSite()}>
        {(site) => (
          <button
            type="button"
            class="quiet"
            disabled={busy() || !props.online}
            onClick={() => void change('site.add', site())}
          >
            Add {site().origin}
          </button>
        )}
      </Show>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </div>
  )
}
