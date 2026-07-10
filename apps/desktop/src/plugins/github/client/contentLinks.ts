// Recognise links inside rendered content (GitHub bodyHTML + Linear markdown) that Acorn can open
// itself instead of sending the user to github.com / linear.app. Shared by the PR conversation and
// the Linear ticket panel.
import { Registry } from '../../../core/client/registries/registry'

export type InAppTarget =
  | { kind: 'linear'; identifier: string }
  | { kind: 'pr'; owner: string; repo: string; number: string }
  | { kind: 'repo'; owner: string; repo: string }

export type ContentLinkContribution = {
  id: string
  providerId?: string
  parse: (href: string) => InAppTarget | null
}

export const contentLinkRegistry = new Registry<ContentLinkContribution>('content-link')

const LINEAR_ISSUE_RE = /^https?:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/i
const GH_PR_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i
const GH_REPO_RE = /^https?:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/?(?:[?#].*)?$/i
// github.com/<name> single-segment paths that are not repos (user/org profiles are one segment and
// already won't match GH_REPO_RE, but these two-ish reserved roots could look like an owner).
const GH_RESERVED = new Set(['orgs', 'sponsors', 'settings', 'notifications', 'marketplace', 'explore', 'topics', 'about'])

export const linearContentLinkContribution: ContentLinkContribution = {
  id: 'linear.issue',
  providerId: 'linear',
  parse: (href) => {
    const match = LINEAR_ISSUE_RE.exec(href)
    return match ? { kind: 'linear', identifier: match[1].toUpperCase() } : null
  },
}

const builtInContentLinks: ContentLinkContribution[] = [
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
if (!contentLinkRegistry.entries().length) for (const contribution of builtInContentLinks) contentLinkRegistry.register(contribution)

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Split text into runs, tagging bare Linear identifiers (e.g. CRA-404) whose team prefix is in
// `prefixes`. Prefix-gating avoids false positives like UTF-8 / SHA-256. Used to linkify GitHub
// titles/bodies, where Linear ids appear as plain text (GitHub doesn't auto-link them).
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

export function parseInAppTarget(href: string): InAppTarget | null {
  for (const contribution of contentLinkRegistry.entries()) {
    const target = contribution.parse(href)
    if (target) return target
  }
  return null
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
    e.preventDefault()
    if (target.kind === 'linear') openLinear(target.identifier)
    else if (target.kind === 'pr') navigate(`/${target.owner}/${target.repo}/${target.number}`)
    else navigate(`/${target.owner}/${target.repo}`)
  }
}
