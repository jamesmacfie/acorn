export type RepoMirrorSource = {
  /** Every repo this owner has mirrored, as (owner, name). Never fetches — a cold mirror is empty. */
  list(userId: string): Promise<{ owner: string; name: string }[]>
  /** GitHub's default branch for a mirrored repo, or null when the repo is not mirrored. */
  defaultBranch(userId: string, owner: string, name: string): Promise<string | null>
  /** Distinct owner logins that have mirror rows — evidence of an identity that may have no prefs. */
  identities(): Promise<string[]>
}

const EMPTY: RepoMirrorSource = {
  list: async () => [],
  defaultBranch: async () => null,
  identities: async () => [],
}

let source: RepoMirrorSource = EMPTY

// Reset to EMPTY by passing null, which teardown does: a second startServiceRuntime in one process must
// not inherit the previous boot's closure over a CLOSED plugin database handle. That is the same bug the
// route and capability registries were both reworked to avoid.
export const setRepoMirrorSource = (next: RepoMirrorSource | null): void => {
  source = next ?? EMPTY
}

export const repoMirrorSource = (): RepoMirrorSource => source
