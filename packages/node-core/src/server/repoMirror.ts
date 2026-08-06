// The three facts CORE still needs from the GitHub repo mirror, as one filled-at-boot slot.
//
// Phase 2 moved `repos` into plugins/github's own SQLite file, and three core surfaces genuinely need
// something out of it. None of them is misplaced — each is core's question about core's own model that
// merely happens to be ANSWERED by mirror data:
//
//   - `server/routes/workspaces.ts` § /bootstrap and /ignore-all: "every repo this owner has mirrored",
//     used to seed the Default workspace and to drive the onboarding master toggle. Workspaces are core's;
//     the candidate list is github's.
//   - `server/routes/taskContext.ts` § /repo-info: the repo's default branch, for the `repo_info` agent
//     tool. `repo_paths` (core's) records where a repo lives on this machine but not what GitHub thinks
//     its default branch is, so there is no core-side answer.
//   - `main/core/identity.ts` § sole(): a login that connected GitHub has `repos` rows and may have no
//     `prefs` rows at all, so the mirror is the only evidence that identity exists. That function's own
//     comment already predicted this: "when github becomes a NodePlugin this function is the ONE place
//     that has to grow a github-side answer".
//
// A SLOT rather than `ctx.capabilities`, deliberately. Capabilities are kept off `Env` on purpose —
// `c.env` reaches every core and plugin route, and a route handler has no business enumerating the plugin
// graph (server/plugin/capabilities.ts says so) — and two of the three consumers here ARE route handlers.
// So the composition root, which legitimately holds both, resolves the capability once and fills this.
// That is the same shape as `setContextSections`, `setWorkflowBridge` and the other engine slots, and it
// is why this file exports a setter rather than a registry.
//
// The default answers "nothing known", and every consumer degrades in the SAFE direction:
//   - bootstrap assigns no repos (it is idempotent and re-runnable);
//   - repo-info reports a null default branch, which the tool already had to handle for an unmirrored repo;
//   - `sole()` sees fewer identities, so it is MORE likely to return null — and null is its fail-closed
//     answer, the one that refuses to hand a legacy row to a guessed owner.
// A slot that is never filled therefore cannot cause a wrong write, only a thinner one.

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
