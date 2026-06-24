import type { CompareCommit } from '../../queries'

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
