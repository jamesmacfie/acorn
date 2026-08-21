// Branch-name normalisation for the task-create flow (docs/terminal-and-agents.md, after verne's slugify):
// lowercase, [a-z0-9/-] only, collapse runs, trim edge separators, ≤ 60 chars. Pure and shared: the
// renderer derives the default branch from the task title; main validates separately
// (worktrees.ts isValidBranch guards the git arg).

export function slugifyBranch(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/(^[-/]+|[-/]+$)/g, '')
    .slice(0, 60)
  // A 60-char cut can land mid-separator. Trim again so the result stays git-legal.
  return slug.replace(/(^[-/]+|[-/]+$)/g, '')
}

// A repo's branch prefix (repo settings) normalised for storage: slugified like a branch, then given
// back the trailing separator slugifyBranch strips. A '-' the user typed is kept; anything else gets
// '/', the git convention for a namespaced branch. 'Feature ' → 'feature/', 'wip-' → 'wip-'.
export function normalizeBranchPrefix(input: string): string {
  const separator = input.trimEnd().endsWith('-') ? '-' : '/'
  const slug = slugifyBranch(input)
  return slug ? `${slug}${separator}` : ''
}

// Apply a repo's prefix to a derived branch name. Idempotent, so re-deriving (or a user editing the
// already-prefixed field) can't stack it twice.
export function withBranchPrefix(prefix: string | null | undefined, branch: string): string {
  if (!prefix || !branch || branch.startsWith(prefix)) return branch
  return `${prefix}${branch}`
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
