import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

/** A PR as core's context assembler needs it: the mirrored head of the task's pull request. */
export type MirroredPullRequest = {
  number: number
  title: string
  body: string | null
  /** Sorted paths from `pr_files`. The section renders a capped, comma-joined list. */
  changedFiles: string[]
}

/** Repository metadata from one owner's disposable local GitHub mirror. */
type MirroredRepository = {
  id: number
  owner: string
  name: string
  private: boolean
  defaultBranch: string | null
  pushedAt: number | null
}

export type GithubMirrorCapability = {
  /** The repository inventory visible to this node owner. Never performs a provider fetch. */
  repositories(userId: string): Promise<MirroredRepository[]>

  /**
   * The mirrored PR for a task's (owner, repo, pullNumber), or null when there is no PR, no mirrored
   * repo, or nothing cached. Never fetches: this backs the `pr` context section, assembled while a
   * prompt is being built, and a cold mirror must render as an absent section rather than block on
   * GitHub.
   */
  pullRequest(
    userId: string,
    repoOwner: string,
    repoName: string,
    pullNumber: number,
  ): Promise<MirroredPullRequest | null>

  /**
   * Row counts for the boot-time storage log. The GitHub plugin owns these tables, so it reports their
   * counts through this capability instead of exposing its database handle.
   */
  footprint(): Promise<Record<string, number>>
}

export const GITHUB_MIRROR = capabilityId<GithubMirrorCapability>('github.mirror')
