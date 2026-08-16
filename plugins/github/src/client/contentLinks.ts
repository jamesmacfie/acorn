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
  allProjects,
  type ContentLinkContribution,
  handlePluginContentLinkClick,
  type InAppTarget,
} from '@acorn/plugin-api/client'
import { formatPullRef } from '../contract/pullRef'
import { githubBrowsePath } from './routes'

const GH_PR_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i
const GH_REPO_RE = /^https?:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/?(?:[?#].*)?$/i
// github.com/<name> single-segment paths that are not repos (user/org profiles are one segment and
// already won't match GH_REPO_RE, but these two-ish reserved roots could look like an owner).
const GH_RESERVED = new Set(['orgs', 'sponsors', 'settings', 'notifications', 'marketplace', 'explore', 'topics', 'about'])

// Registered from client/index.ts through ctx.contribute, like every other contribution.
//
// The PR recogniser declares `providerId: 'github'`, and for a while it deliberately did not. The old
// argument was that a pull request is a whole review surface rather than a card you glance at, which is
// true of REVIEWING one and beside the point for the question a panel answers: someone reading a Linear
// ticket that mentions `Runn-Fast/runn#8811` wants to know what it is, not to review it. ./PullRefPanel.tsx
// shows deliberately less than the pane and offers the pane as the next step. The old comment promised
// that adding this field would be the entire change on this side, and it was.
//
// The REPO recogniser still declares none, and that part was never about panels: a repository is a list,
// its list is the browse route below, and there is nothing glance-sized to put in an overlay.
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
    providerId: 'github',
    parse: (href) => {
      const match = GH_PR_RE.exec(href)
      // `item` is what makes the PANEL rung reachable — the host looks a reference panel up by provider
      // and hands it `item` as the `displayId`. Spelled `owner/repo#number`, the same identity the pulls
      // collection gives its rows, so a row, a URL and the panel cannot disagree about what they name.
      return match ? { kind: 'pr', owner: match[1], repo: match[2], number: match[3], item: formatPullRef(match[1], match[2], match[3]) } : null
    },
    path: (target) => {
      const projectId = projectIdFor(target)
      return projectId ? `${githubBrowsePath(projectId)}/${encodeURIComponent(str(target.number))}` : null
    },
  },
  {
    id: 'github.repository',
    parse: (href) => {
      const match = GH_REPO_RE.exec(href)
      return match && !GH_RESERVED.has(match[1].toLowerCase()) ? { kind: 'repo', owner: match[1], repo: match[2] } : null
    },
    path: (target) => {
      const projectId = projectIdFor(target)
      return projectId ? githubBrowsePath(projectId) : null
    },
  },
]

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

// owner/name → the project acorn tracks it as, which is the whole of what makes a github.com URL
// addressable in here. Null is the ORDINARY answer for a repo acorn does not track, and it has to stay
// null: the fall-through documented in `makeContentLinkHandler` below is the same decision, and this
// resolver is the second caller of it rather than a new judgement.
//
// CASE-INSENSITIVELY, which is the entire bug this once had. A GitHub owner and repo name are
// case-insensitive to GitHub — `Runn-Fast/runn` and `runn-fast/runn` are one repository — and the two
// sides of this comparison get their casing from different places: the URL carries GitHub's canonical
// spelling (`repos.owner` in the plugin's own mirror is `Runn-Fast`), while `projects.github_owner` is
// stored folded. An `===` here matched neither the dashboard row nor a PR link in a body, and failed
// the way a missing project does — silently, out to the browser — so nothing pointed at the casing.
const eq = (a: unknown, b: unknown): boolean => str(a).toLowerCase() === str(b).toLowerCase()

const projectIdFor = (target: InAppTarget): string | null =>
  allProjects().find((project) => eq(project.github?.owner, target.owner) && eq(project.github?.name, target.repo))?.id ?? null

// A delegated click handler for a PR content container. It is now one host call, and everything this
// function used to do itself has gone up into that call rather than been deleted.
//
// It used to hold two rungs of its own. The bare `CRA-404` anchors went first, when the host learned to
// mint them itself (client-core § linkifyRefs); what they took with them was the assumption that a bare id
// is a LINEAR id, which is why that branch could never have served a second provider. The owner/name →
// project → navigate rung went second, once the host's ladder grew a `route` destination — the resolution
// stayed here, where it belongs, as the `path` on github's own recogniser above, and only the NAVIGATING
// left. The deliberate fall-through for a repo acorn does not track survives as `projectIdFor` returning
// null; it is still the case that a URL with no in-app home must open the real github.com one.
//
// `prefer: 'refPanel'` is the whole of what is left, and it is the one thing genuinely local: a reader
// half-way through a diff who clicks a ticket wants to glance at it, not to have the surface under them
// replaced. It is a preference, so a provider with no panel installed still gets its pane or its route.
export function makeContentLinkHandler(navigate: (to: string) => void) {
  return (e: MouseEvent) => {
    handlePluginContentLinkClick(e, { taskId: activeTaskId(), prefer: 'refPanel', navigate })
  }
}
