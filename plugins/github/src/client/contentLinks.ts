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
import type { ContentLinkContribution } from '@acorn/client-core/registries/contentLinks.ts'
import { parseInAppTarget } from '@acorn/client-core/registries/contentLinks.ts'

const GH_PR_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i
const GH_REPO_RE = /^https?:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/?(?:[?#].*)?$/i
// github.com/<name> single-segment paths that are not repos (user/org profiles are one segment and
// already won't match GH_REPO_RE, but these two-ish reserved roots could look like an owner).
const GH_RESERVED = new Set(['orgs', 'sponsors', 'settings', 'notifications', 'marketplace', 'explore', 'topics', 'about'])

// Registered from client/index.ts through ctx.contribute, like every other contribution.
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


// A delegated click handler for a content container: routes recognised links in-app (Linear issues
// open the side panel via `openLinear`; GitHub PRs/repos navigate the SPA via `navigate`) and leaves
// everything else — and modified/middle clicks (open-in-new-tab) — to the browser. Router-free so it
// stays unit-testable; the caller passes useNavigate()'s function.
export function makeContentLinkHandler(navigate: (to: string) => void, openLinear: (identifier: string) => void) {
  return (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const anchor = (e.target as HTMLElement | null)?.closest('a') as HTMLAnchorElement | null
    if (!anchor) return
    // Bare-id anchors injected by linkifyLinearIds carry the identifier directly.
    if (anchor.dataset.linearId) {
      e.preventDefault()
      openLinear(anchor.dataset.linearId)
      return
    }
    const href = anchor.getAttribute('href')
    if (!href) return
    const target = parseInAppTarget(href)
    if (!target) return
    // Narrowed on `kind`, and an UNRECOGNISED kind falls through to the browser rather than being
    // swallowed. That is the behavioural change the open target type buys: a provider this handler has
    // never heard of can contribute a recogniser, and until something knows how to route its kind the
    // link keeps working the way it did before anyone recognised it.
    const str = (value: unknown): string => (typeof value === 'string' ? value : '')
    if (target.kind === 'linear') openLinear(str(target.identifier))
    else if (target.kind === 'pr') navigate(`/${str(target.owner)}/${str(target.repo)}/${str(target.number)}`)
    else if (target.kind === 'repo') navigate(`/${str(target.owner)}/${str(target.repo)}`)
    else return
    e.preventDefault()
  }
}
