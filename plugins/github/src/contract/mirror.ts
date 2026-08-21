import { capabilityId } from '@acorn/plugin-api/node'

/** A PR as core's context assembler needs it: the mirrored head of the task's pull request. */
export type MirroredPullRequest = {
  number: number
  title: string
  body: string | null
  /** Sorted paths from `pr_files`. The section renders a capped, comma-joined list. */
  changedFiles: string[]
}

export type GithubMirrorCapability = {
  /**
   * The mirrored PR for a task's (owner, repo, pullNumber), or null when there is no PR, no mirrored
   * repo, or nothing cached yet. Never fetches: this backs the `pr` context section, which is
   * assembled synchronously while a prompt is being built, and a cold mirror must render as an absent
   * section rather than block on GitHub.
   */
  pullRequest(userId: string, repoOwner: string, repoName: string, pullNumber: number): Promise<MirroredPullRequest | null>

  /**
   * Re-derived CI state for a task's PR, as the workflow runner's `checks-green` policy needs it. The
   * three-valued answer is load-bearing and is why this is not a boolean:
   *   ''    is every mirrored check passed (the ci-loop step is done, the policy passes)
   *   text  is a rendered list of the failing ones, which becomes the fix prompt
   *   null  is nothing to check at all: no PR, no active identity, or the repo is not mirrored yet.
   *         The ci-loop step treats this as a hard failure rather than as success.
   *
   * The workflow plugin resolves this capability through the runtime registry rather than importing
   * the GitHub implementation directly.
   */
  failingChecks(userId: string | null, taskId: string): Promise<string | null>

  /**
   * Row counts for the boot-time storage log. The GitHub plugin owns these tables, so it reports their
   * counts through this capability instead of exposing its database handle.
   */
  footprint(): Promise<Record<string, number>>

}

export const GITHUB_MIRROR = capabilityId<GithubMirrorCapability>('github.mirror')
