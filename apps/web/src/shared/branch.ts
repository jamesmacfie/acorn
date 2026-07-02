// Branch-name normalisation for the task-create flow (docs/next 02 P2, after verne's slugify):
// lowercase, [a-z0-9/-] only, collapse runs, trim edge separators, ≤ 60 chars. Pure + shared —
// the renderer derives the default branch from the task title; main validates separately
// (worktrees.ts isValidBranch guards the git arg).

export function slugifyBranch(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/(^[-/]+|[-/]+$)/g, '')
    .slice(0, 60)
  // A 60-char cut can land mid-separator — trim again so the result stays git-legal.
  return slug.replace(/(^[-/]+|[-/]+$)/g, '')
}

// De-dupe against existing branch names: name, name-2, name-3, …
export function dedupeBranch(name: string, existing: Iterable<string>): string {
  const set = new Set(existing)
  if (!set.has(name)) return name
  for (let i = 2; ; i++) {
    const candidate = `${name}-${i}`
    if (!set.has(candidate)) return candidate
  }
}
