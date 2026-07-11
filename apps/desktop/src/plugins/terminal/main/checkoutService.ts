import type { z } from 'zod'
import type { AppDatabase } from '../../../core/server/db'
import { getRepoPath, setRepoPath, setRunTargets } from '../../../core/main/repoPaths'
import { PublicApiError } from '../../../core/shared/publicApi/errors'
import type { RepoPathSchema, RunTargetSchema } from '../../../core/shared/publicApi/terminal'

// Repository checkout mapping + run targets (docs/public-api.md). Reuses the
// repoPaths store: setRepoPath validates that the path is a Git checkout of the named remote repo.

type RepoPath = z.infer<typeof RepoPathSchema>
type RunTarget = z.infer<typeof RunTargetSchema>

function parseRunTargets(json: string | null): RunTarget[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? (arr as RunTarget[]) : []
  } catch {
    return []
  }
}

export class RepoCheckoutService {
  constructor(private readonly db: AppDatabase) {}

  async get(owner: string, repo: string): Promise<RepoPath> {
    const row = await getRepoPath(this.db, owner, repo)
    if (!row) throw new PublicApiError('not_found', 'No checkout mapped for this repository')
    return { owner: row.owner, repo: row.repo, path: row.path, runTargets: parseRunTargets(row.runTargets) }
  }

  async setPath(owner: string, repo: string, path: string): Promise<RepoPath> {
    const res = await setRepoPath(this.db, owner, repo, path)
    if (!res.ok) throw new PublicApiError('validation_failed', res.reason)
    return { owner: res.repoPath.owner, repo: res.repoPath.repo, path: res.repoPath.path, runTargets: parseRunTargets(res.repoPath.runTargets) }
  }

  async setRunTargets(owner: string, repo: string, runTargets: RunTarget[]): Promise<RepoPath> {
    const res = await setRunTargets(this.db, owner, repo, JSON.stringify(runTargets))
    if (!res.ok) throw new PublicApiError('conflict', res.reason)
    return { owner: res.repoPath.owner, repo: res.repoPath.repo, path: res.repoPath.path, runTargets: parseRunTargets(res.repoPath.runTargets) }
  }
}
