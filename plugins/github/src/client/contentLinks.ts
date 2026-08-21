// GitHub's own content-link recognisers, and one click handler that adds github's project resolution
// to the host's ladder. The general registry, target type, and `parseInAppTarget` live in
// @acorn/client-core/registries/contentLinks.ts (docs/plugins.md § Frame authoring and the UI kit).
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
// The PR recogniser declares `providerId: 'github'` so a click can open the reference panel
// (./PullRefPanel.tsx); the repo recogniser declares none, because a repository is a list rather than
// a card (docs/github-integration.md § Content links).
export const githubContentLinkContributions: ContentLinkContribution[] = [
  {
    id: 'github.pull-request',
    providerId: 'github',
    parse: (href) => {
      const match = GH_PR_RE.exec(href)
      // `item` is what makes the panel reachable (docs/plugins.md § Frame authoring and the UI kit).
      // Spelled `owner/repo#number`, the same identity the pulls collection gives its rows, so a row,
      // a URL, and the panel cannot disagree about what they name.
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

// owner/name → the project acorn tracks it as. Null means an untracked repo, and it is a normal
// answer, not an error: `makeContentLinkHandler` below falls through to the browser for exactly that
// case.
//
// Compared case-insensitively (docs/github-integration.md § Content links): GitHub treats owner and
// repo names as case-insensitive, and the URL's casing does not match `projects.github_owner`.
const eq = (a: unknown, b: unknown): boolean => str(a).toLowerCase() === str(b).toLowerCase()

const projectIdFor = (target: InAppTarget): string | null =>
  allProjects().find((project) => eq(project.github?.owner, target.owner) && eq(project.github?.name, target.repo))?.id ?? null

// A delegated click handler for a PR content container, wrapping the host's
// `handlePluginContentLinkClick` (docs/plugins.md § Frame authoring and the UI kit). `projectIdFor`
// returning null is the normal answer for an untracked repo: the URL then opens the real github.com
// page instead of an in-app route.
//
// `prefer: 'refPanel'` is the one local choice: a reader half-way through a diff who clicks a link
// wants to glance at it, not have the surface under them replaced. It is only a preference, so a
// provider with no panel installed still gets its pane or route.
export function makeContentLinkHandler(navigate: (to: string) => void) {
  return (e: MouseEvent) => {
    handlePluginContentLinkClick(e, { taskId: activeTaskId(), prefer: 'refPanel', navigate })
  }
}
