// GitHub's own content-link recognisers, and one click handler that adds github's project resolution
// to the host's ladder.
//
// Everything else that used to be here has gone up into
// @acorn/client-core/registries/contentLinks.ts, in two moves. The registry, the target type and
// `parseInAppTarget` went first: link resolution is the shell's, and while it lived here a third
// provider could not participate without editing github (Linear's URL recogniser went with it, into
// plugins/linear's manifest). The `splitLinearIds` / `linkifyLinearIds` pair followed, and the argument
// for keeping them was the one that turned out to be wrong — they are not "github's body rendering",
// they are the only machinery in the app that makes a bare `CRA-404` clickable, and it worked for
// exactly one provider because github was the one holding it.
import {
  activeTaskId,
  type ContentLinkContribution,
  handlePluginContentLinkClick,
  parseInAppTarget,
} from '@acorn/plugin-api/client'

const GH_PR_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i
const GH_REPO_RE = /^https?:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/?(?:[?#].*)?$/i
// github.com/<name> single-segment paths that are not repos (user/org profiles are one segment and
// already won't match GH_REPO_RE, but these two-ish reserved roots could look like an owner).
const GH_RESERVED = new Set(['orgs', 'sponsors', 'settings', 'notifications', 'marketplace', 'explore', 'topics', 'about'])

// Registered from client/index.ts through ctx.contribute, like every other contribution.
//
// Neither declares a `providerId`, and the omission is deliberate rather than an oversight now that the
// field exists: it is what makes a link resolve into the OWNING plugin's reference panel, and github has no
// panel — a pull request is a whole review surface, not a card you glance at. So these two targets reach the
// project route below and nothing else. If github ever grows one, adding `providerId: 'github'` here is the
// entire change on this side.
//
// This used to be a module-scope loop guarded by `if (!contentLinkRegistry.entries().length)`, which
// worked only while github was also the module that DEFINED the registry and so was guaranteed to
// import first. The moment linear started contributing its own recogniser, that guard saw a non-empty
// registry and silently skipped both of github's — the pane still rendered, links just stopped
// resolving. Host-owned registration has no such ordering assumption, and it is taken back on
// re-init.
export const githubContentLinkContributions: ContentLinkContribution[] = [
  {
    id: 'github.pull-request',
    parse: (href) => {
      const match = GH_PR_RE.exec(href)
      return match ? { kind: 'pr', owner: match[1], repo: match[2], number: match[3] } : null
    },
  },
  {
    id: 'github.repository',
    parse: (href) => {
      const match = GH_REPO_RE.exec(href)
      return match && !GH_RESERVED.has(match[1].toLowerCase()) ? { kind: 'repo', owner: match[1], repo: match[2] } : null
    },
  },
]

// A delegated click handler for a PR content container. What is left here is only what is github's:
// owner/name → project resolution, which needs the project query this pane already holds.
//
// Everything general — which recogniser claims the href, whether the matched item lands in a task pane
// or the provider's reference panel, and the bare `CRA-404` anchors the host linkified into GitHub's
// body HTML — is `handlePluginContentLinkClick`. The last of those was github's until the host learned
// to mint the anchors itself (client-core/registries/contentLinks.ts § linkifyRefs); what it took with
// it was the assumption that a bare id is a LINEAR id, which is why the branch here could never have
// served a second provider.
//
// `prefer: 'refPanel'` is the request that made the move worth making. A reader half-way through a diff who
// clicks a ticket wants to glance at it, not to have the pane under them swapped, and the panel stays over
// the page either way (client-core/registries/refPanelHost.tsx). It is a preference: when the provider has
// no panel installed here, the host still tries its task pane.
export function makeContentLinkHandler(
  navigate: (to: string) => void,
  projectIdForGithub?: (owner: string, repo: string) => string | null | undefined,
) {
  return (e: MouseEvent) => {
    // Handled, and `preventDefault` already called. A false covers both "not a link the host knows" and
    // "recognised, but nowhere in-app to put it" — the two branches below are the only ones this plugin
    // adds before the browser gets the click.
    if (handlePluginContentLinkClick(e, { taskId: activeTaskId(), prefer: 'refPanel' })) return
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const href = ((e.target as HTMLElement | null)?.closest('a') as HTMLAnchorElement | null)?.getAttribute('href')
    if (!href) return
    const target = parseInAppTarget(href)
    if (!target) return
    const str = (value: unknown): string => (typeof value === 'string' ? value : '')
    if (target.kind !== 'pr' && target.kind !== 'repo') return
    const projectId = projectIdForGithub?.(str(target.owner), str(target.repo))
    // A DELIBERATE PRODUCT DECISION, not an unfinished branch: a GitHub URL for a repo acorn does not
    // track has no in-app destination, so the real github.com URL opens. owner/name alone stopped being a
    // valid app route at the project cutover, and inventing a destination — importing the repo, or a
    // read-only view of a project that does not exist — is separate work. Do not "fix" this to swallow
    // the click.
    if (!projectId) return
    const suffix = target.kind === 'pr' ? `/${encodeURIComponent(str(target.number))}` : ''
    navigate(`/p/${encodeURIComponent(projectId)}/pulls${suffix}`)
    e.preventDefault()
  }
}
