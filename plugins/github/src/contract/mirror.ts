// What other packages may ask the github plugin, now that nobody else can read its tables
// (docs/vNext/plugins.md § Cross-plugin collaboration). This is the whole cross-boundary surface of the
// GitHub mirror: three questions, each with exactly one consumer that used to answer it by querying
// core's database directly.
//
// Every one is declared `capability`, not a route: the callers are all in-process (core's context
// assembler, core's boot-time footprint log, the workflow runner), and a capability degrades to
// `undefined` when the plugin is absent. github is `required: true`, so in practice it is always there —
// but the consumers still use `get` rather than `require`, because a node booting with a broken github
// init should log a cold context section, not fail every workflow step.
import { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'

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
   * repo, or nothing cached yet. Deliberately does NOT fetch: this backs the `pr` context section, which
   * is assembled synchronously while a prompt is being built, and a cold mirror must render as an absent
   * section rather than block on GitHub.
   */
  pullRequest(userId: string, repoOwner: string, repoName: string, pullNumber: number): Promise<MirroredPullRequest | null>

  /**
   * Re-derived CI state for a task's PR, as the workflow runner's `checks-green` policy needs it. The
   * three-valued answer is load-bearing and is why this is not a boolean:
   *   ''    — every mirrored check passed (the ci-loop step is done, the policy passes)
   *   text  — a rendered list of the failing ones, which becomes the fix prompt
   *   null  — nothing to check at all: no PR, no active identity, or the repo is not mirrored yet. The
   *           ci-loop step treats this as a hard failure rather than as success.
   *
   * This replaces apps/node/src/wiring/workflowWiring.ts, which existed for exactly one stated reason —
   * "github is not converted, so there is no `github.checkState` capability to resolve". There is now.
   */
  failingChecks(userId: string | null, taskId: string): Promise<string | null>

  /**
   * Row counts for the boot-time storage log (main/storageFootprint.ts). Core used to count these
   * itself; it cannot see the tables any more, and reporting a silent zero would turn a visibility
   * trigger into a lie.
   */
  footprint(): Promise<Record<string, number>>

  // repoList / repoDefaultBranch / identities are deliberately NOT here. Core needs all three, but its
  // consumers are two route handlers and a CoreServices member — none of which may reach the capability
  // registry, because `c.env` intentionally cannot enumerate the plugin graph. They arrive through
  // @acorn/node-core/server/repoMirror.ts's slot instead, which this plugin's init fills from the same
  // queries. Declaring them here as well would be a second name for one seam with no caller behind it.
}

export const GITHUB_MIRROR = capabilityId<GithubMirrorCapability>('github.mirror')
