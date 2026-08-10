// GitHub's content-link recognisers, plus the bare-Linear-id text helpers the PR conversation uses.
//
// The registry, the target type and parseInAppTarget moved to
// @acorn/client-core/registries/contentLinks.ts: link resolution is the shell's, and while it lived
// here a third provider could not participate without editing github. Linear's URL recogniser went
// with it, to plugins/linear.
//
// The `splitLinearIds` / `linkifyLinearIds` pair genuinely does stay. It is not link RESOLUTION — it
// is github's PR body rendering, turning bare `CRA-404` text into something clickable, and it runs
// against GitHub's innerHTML in github's own pane.
import {
  activeTaskId,
  type ContentLinkContribution,
  openContentTarget,
  openRefPanel,
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

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function splitLinearIds(text: string, prefixes: string[]): { text: string; id?: string }[] {
  const keys = [...new Set(prefixes)].filter(Boolean)
  if (!keys.length) return [{ text }]
  const re = new RegExp(`\\b(?:${keys.map(escapeRegExp).join('|')})-\\d+\\b`, 'g')
  const out: { text: string; id?: string }[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ text: text.slice(last, idx) })
    out.push({ text: m[0], id: m[0] })
    last = idx + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out.length ? out : [{ text }]
}

// Walk text nodes under an innerHTML container and wrap bare Linear ids in clickable anchors
// (data-linear-id), so a delegated content handler opens them. Skips text inside existing links and
// code/pre. Only call on Solid-opaque innerHTML nodes (e.g. .markdown), never Solid-managed text.
export function linkifyLinearIds(root: HTMLElement, prefixes: string[]): void {
  const keys = [...new Set(prefixes)].filter(Boolean)
  if (!keys.length) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const hits: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    if (!t.parentElement?.closest('a, code, pre')) hits.push(t)
  }
  for (const t of hits) {
    const parts = splitLinearIds(t.data, keys)
    if (parts.length === 1 && !parts[0].id) continue
    const frag = document.createDocumentFragment()
    for (const p of parts) {
      if (!p.id) {
        frag.append(p.text)
        continue
      }
      const a = document.createElement('a')
      a.className = 'linear-inline-link'
      a.dataset.linearId = p.id
      a.textContent = p.text
      frag.append(a)
    }
    t.replaceWith(frag)
  }
}


// A delegated click handler for a PR content container. What is left here is only what is github's:
//
//   1. the bare-id anchors `linkifyLinearIds` above minted out of github's own body HTML, which are not
//      URLs and so no recogniser can claim them;
//   2. owner/name → project resolution, which needs the project query this pane already holds.
//
// Everything general — which recogniser claims the href, and whether the matched item lands in a task pane
// or the provider's reference panel — moved to client-core/registries/contentLinks.ts § openContentTarget.
// It had to: this function decided, for the whole app, that a Linear issue opens a side panel, so no other
// surface could do the same and no third provider could be opened this way at all.
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
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const anchor = (e.target as HTMLElement | null)?.closest('a') as HTMLAnchorElement | null
    if (!anchor) return
    // A bare `CRA-404` this file wrapped itself. It carries no href, so there is no browser fallback to
    // preserve and the click is ours whether or not Linear's panel is installed to receive it. Naming
    // another plugin's provider is the CONSUMER side of ownership and is allowed — a panel may only be
    // REGISTERED under its own provider — and github is already the one scanning for Linear's prefixes.
    if (anchor.dataset.linearId) {
      e.preventDefault()
      openRefPanel({ providerId: 'linear', displayId: anchor.dataset.linearId })
      return
    }
    const href = anchor.getAttribute('href')
    if (!href) return
    const target = parseInAppTarget(href)
    if (!target) return
    // The host's rungs first: the panel, then the declared task pane. `'external'` means it found neither,
    // and the two branches below are the only ones this plugin adds before the browser gets the click.
    if (openContentTarget(target, { taskId: activeTaskId(), prefer: 'refPanel' }) !== 'external') {
      e.preventDefault()
      return
    }
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
