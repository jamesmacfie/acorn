import type { CompareCommit } from '../../contract/api'

// Branch name → human title: last path segment, dashes/underscores to spaces, first letter upper.
// `feature/add-foo` → "Add foo".
export function humanizeBranch(ref: string): string {
  const seg = ref.split('/').pop() ?? ref
  const words = seg.replace(/[-_]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : ref
}

// GitHub-style prefill: a single commit donates its subject (title) + remaining body; multiple
// commits fall back to the humanized head branch name with an empty body.
export function prefillFromCompare(commits: CompareCommit[], headRef: string): { title: string; body: string } {
  if (commits.length === 1) {
    const [subject, ...rest] = commits[0]!.message.split('\n')
    return { title: subject ?? '', body: rest.join('\n').trim() }
  }
  return { title: humanizeBranch(headRef), body: '' }
}

// An in-progress new-PR form, kept in localStorage per repo so navigating away doesn't lose it, the
// same rationale (and per-device scope) as the comment drafts in
// @acorn/client-core/lib/draftState.ts. base/head are stored too: they live in the URL while the
// form is mounted, but a fresh visit to /:owner/:repo/new carries no query params, so the URL alone
// cannot restore them.
export type PullDraft = { base: string; head: string; title: string; body: string; draft: boolean; touched: boolean }

const draftKey = (owner: string, repo: string) => `new-pr:${owner}/${repo}`

// Tolerate anything that isn't a draft we wrote (hand-edited or older shape) by discarding it.
export function parsePullDraft(raw: string | null): PullDraft | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Partial<PullDraft>
    return {
      base: typeof d.base === 'string' ? d.base : '',
      head: typeof d.head === 'string' ? d.head : '',
      title: typeof d.title === 'string' ? d.title : '',
      body: typeof d.body === 'string' ? d.body : '',
      draft: d.draft === true,
      touched: d.touched === true,
    }
  } catch {
    return null
  }
}

export const readPullDraft = (owner: string, repo: string): PullDraft | null =>
  parsePullDraft(localStorage.getItem(draftKey(owner, repo)))

// An untouched form with no head chosen is indistinguishable from a fresh one, so do not leave a key
// behind.
export function writePullDraft(owner: string, repo: string, d: PullDraft): void {
  if (d.head || d.touched || d.draft) localStorage.setItem(draftKey(owner, repo), JSON.stringify(d))
  else clearPullDraft(owner, repo)
}

export const clearPullDraft = (owner: string, repo: string): void => localStorage.removeItem(draftKey(owner, repo))
