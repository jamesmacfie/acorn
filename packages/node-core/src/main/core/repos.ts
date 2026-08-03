// The repo read seam (CoreServices.repos). `repo_paths` and `config_acks` are CORE tables — the
// machine's primary checkout per repo, its per-repo build/run/db settings, and the hashes the owner
// has acknowledged as trusted executable config. Both are core's because they describe THIS MACHINE's
// relationship to a repo, not any one plugin's data.
//
// Before the database split a plugin read them with core's db handle (plugins/database's resolveDbUrl
// called getRepoPath + assertRepoConfigTrusted; plugins/memory scanned every checkout). Once each
// plugin owns its own SQLite file it has no handle to core's at all, so those reads come through here
// (docs/vNext/data.md § Plugin DBs).
import type { RepoPath } from '@acorn/protocol/terminal.ts'
import type { AppDatabase } from '../../server/db'
import { schema } from '../../server/db'
import { getRepoPath } from '../repoPaths'
import { assertRepoConfigTrusted } from '../repoConfigTrust'
import { repoSetup, type SetupTrigger } from '../taskWorktree'

// Just the checkout locations, not the whole RepoPath: the one caller (memory's index reconcile)
// wants "where does each repo live on disk", and returning the full row would mean parsing every
// repo's browser rules and run targets to throw them away.
export type RepoCheckout = { owner: string; repo: string; path: string }

export type RepoService = {
  // The repo's row: primary checkout path plus the per-repo run/db/preview settings. null when the
  // repo has never been mapped to a checkout on this machine.
  path(owner: string, repo: string): Promise<RepoPath | null>
  // Every mapped repo. plugins/memory scans each primary checkout's `.acorn/memory` dir, which is the
  // one caller that wants the whole table rather than one repo.
  checkouts(): Promise<RepoCheckout[]>
  // The executable-config trust gate (docs/repo-config.md): throws RepoConfigTrustError when the
  // task's checkout carries a `.acorn/config.toml` the owner has not acknowledged. plugins/database
  // runs a repo-authored `[database].url_script`, so cloning a repo must not be enough to run its
  // commands — the gate has to be reachable from the plugin that executes the script.
  assertConfigTrusted(taskId: string): Promise<void>
  // The repo's setup script and when to run it (docs/workspaces-and-tasks.md P5). plugins/terminal runs
  // it as a background "Setup" tab from the onWorktreeCreated hook, so it needs the `repo_paths` columns
  // that decide whether to run it at all.
  setup(owner: string, repo: string): Promise<{ script: string | null; trigger: SetupTrigger }>
}

export function createRepoService(db: AppDatabase): RepoService {
  return {
    path: (owner, repo) => getRepoPath(db, owner, repo),
    checkouts: () => db.select({ owner: schema.repoPaths.owner, repo: schema.repoPaths.repo, path: schema.repoPaths.path }).from(schema.repoPaths),
    assertConfigTrusted: (taskId) => assertRepoConfigTrusted(db, taskId),
    setup: (owner, repo) => repoSetup(db, owner, repo),
  }
}
