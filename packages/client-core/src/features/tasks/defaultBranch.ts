import { dedupeBranch, slugifyBranch, withBranchPrefix } from '@acorn/protocol/branch.ts'

// The one default for a new task branch, shared by the rail's local-task dialog and the promotion
// dialog. Explicit or provider-owned branch names do not pass through here: this is only the
// suggestion derived from a task title.
export function defaultBranchForTask(
  title: string,
  prefix: string | null | undefined,
  existingBranches: Iterable<string>,
): string {
  const branch = withBranchPrefix(prefix, slugifyBranch(title))
  return branch ? dedupeBranch(branch, existingBranches) : ''
}
