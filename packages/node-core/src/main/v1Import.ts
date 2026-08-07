import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import { loadDatabase } from './sqliteLoader'

const V1_DATABASE = 'acorn.sqlite'

export const defaultV1Root = (): string | null =>
  process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', '@acorn', 'desktop') : null

export type V1Probe = {
  found: boolean
  path: string | null
  workspaces: number
  repos: number
  checkouts: number
}

export type V1ImportReport = {
  workspacesCreated: number
  reposRegrouped: number
  reposIgnored: number
  checkoutsImported: number
  // Checkout paths that no longer exist, or are no longer git repositories. Imported anyway — the row is
  // editable in Settings and a missing repo is not, so dropping it would lose information the owner has.
  checkoutsUnverified: string[]
}

type V1Workspace = { id: string; name: string; is_default: number; sort: number; icon: string | null; color: string | null }
type V1WorkspaceRepo = { workspace_id: string; repo_owner: string; repo_name: string; sort: number }
type V1IgnoredRepo = { owner: string; repo: string }
type V1RepoPath = Record<string, string | number | null>

// Read from a private copy of the source database. The copy, its sidecars, and the temporary directory
// are removed before this returns, whatever happens during the read.
type V1Reader = { prepare(sql: string): { all(): unknown[]; get(): unknown } }

function withV1Copy<T>(dir: string, read: (db: V1Reader) => T): T {
  const source = join(resolve(dir), V1_DATABASE)
  if (!existsSync(source)) throw new Error(`No V1 database at ${source}.`)
  const staging = mkdtempSync(join(tmpdir(), 'acorn-v1-'))
  try {
    const copy = join(staging, V1_DATABASE)
    copyFileSync(source, copy)
    // Copy the sidecars as well: committed SQLite transactions may still be present in the WAL, and
    // reading only the main file could import a stale snapshot.
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${source}${suffix}`)) copyFileSync(`${source}${suffix}`, `${copy}${suffix}`)
    }
    const Database = loadDatabase()
    const db = new Database(copy, { readonly: true, fileMustExist: true })
    try {
      return read(db as unknown as V1Reader)
    } finally {
      db.close()
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

// Count the supported source rows for the onboarding panel. Probing is non-fatal: an absent or unreadable
// source root simply means that there is nothing to offer.
export function probeV1Root(dir: string | null): V1Probe {
  const empty: V1Probe = { found: false, path: dir, workspaces: 0, repos: 0, checkouts: 0 }
  if (!dir) return empty
  try {
    return withV1Copy(dir, (db) => ({
      found: true,
      path: dir,
      workspaces: (db.prepare('SELECT count(*) AS n FROM workspaces').get() as { n: number }).n,
      repos: (db.prepare('SELECT count(*) AS n FROM workspace_repos').get() as { n: number }).n,
      checkouts: (db.prepare('SELECT count(*) AS n FROM repo_paths').get() as { n: number }).n,
    }))
  } catch {
    return empty
  }
}

const looksLikeCheckout = (path: string): boolean => existsSync(path) && existsSync(join(path, '.git'))

export async function importV1Config(db: AppDatabase, dir: string): Promise<V1ImportReport> {
  const source = withV1Copy(dir, (v1) => ({
    workspaces: v1.prepare('SELECT id, name, is_default, sort, icon, color FROM workspaces ORDER BY sort').all() as V1Workspace[],
    workspaceRepos: v1.prepare('SELECT workspace_id, repo_owner, repo_name, sort FROM workspace_repos').all() as V1WorkspaceRepo[],
    ignoredRepos: v1.prepare('SELECT owner, repo FROM ignored_repos').all() as V1IgnoredRepo[],
    repoPaths: v1.prepare('SELECT * FROM repo_paths').all() as V1RepoPath[],
  }))

  const report: V1ImportReport = {
    workspacesCreated: 0,
    reposRegrouped: 0,
    reposIgnored: 0,
    checkoutsImported: 0,
    checkoutsUnverified: [],
  }
  const now = Date.now()

  const existing = await db.select().from(schema.workspaces)
  const byName = new Map(existing.map((row) => [row.name, row.id]))
  const localDefault = existing.find((row) => row.isDefault)?.id ?? null
  const workspaceIdMap = new Map<string, string>()

  for (const workspace of source.workspaces) {
    if (workspace.is_default && localDefault) {
      workspaceIdMap.set(workspace.id, localDefault)
      continue
    }
    const already = byName.get(workspace.name)
    if (already) {
      workspaceIdMap.set(workspace.id, already)
      continue
    }
    // Reuse the source id so imported relationships remain readable and deterministic in the destination.
    await db.insert(schema.workspaces).values({
      id: workspace.id,
      name: workspace.name,
      isDefault: false,
      sort: workspace.sort,
      icon: workspace.icon,
      color: workspace.color,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing()
    byName.set(workspace.name, workspace.id)
    workspaceIdMap.set(workspace.id, workspace.id)
    report.workspacesCreated += 1
  }

  // --- Repo membership ---
  //
  // A MOVE, not an insert-or-ignore, and only out of the default workspace. The bootstrap has already put
  // every mirrored repo in Default, so an insert-or-ignore would find every row taken and import nothing —
  // the grouping is the whole point of the import. Restricting it to repos still sitting in Default is
  // what keeps it from overriding a decision the owner has already made on this node.
  const currentMembership = await db.select().from(schema.workspaceRepos)
  const membership = new Map(currentMembership.map((row) => [`${row.repoOwner}/${row.repoName}`, row.workspaceId]))

  for (const row of source.workspaceRepos) {
    const targetWorkspace = workspaceIdMap.get(row.workspace_id)
    if (!targetWorkspace) continue // ignore a membership row whose source workspace was not imported
    const key = `${row.repo_owner}/${row.repo_name}`
    const current = membership.get(key)
    if (current === targetWorkspace) continue // already in the requested workspace, including on reruns
    if (current && current !== localDefault) continue // the owner moved it deliberately; leave it alone
    if (current) {
      await db
        .update(schema.workspaceRepos)
        .set({ workspaceId: targetWorkspace, sort: row.sort })
        .where(and(eq(schema.workspaceRepos.repoOwner, row.repo_owner), eq(schema.workspaceRepos.repoName, row.repo_name)))
    } else {
      await db.insert(schema.workspaceRepos).values({
        workspaceId: targetWorkspace,
        repoOwner: row.repo_owner,
        repoName: row.repo_name,
        sort: row.sort,
        createdAt: now,
      }).onConflictDoNothing()
    }
    membership.set(key, targetWorkspace)
    report.reposRegrouped += 1
  }

  // --- Hidden repos ---
  //
  // Insert-or-ignore is right here: ignoring is a boolean the owner set, and re-ignoring something
  // already ignored is the same state.
  for (const row of source.ignoredRepos) {
    const inserted = await db
      .insert(schema.ignoredRepos)
      .values({ owner: row.owner, repo: row.repo, createdAt: now })
      .onConflictDoNothing()
      .returning({ owner: schema.ignoredRepos.owner })
    if (inserted.length) report.reposIgnored += 1
  }

  const existingPaths = await db.select({ owner: schema.repoPaths.owner, repo: schema.repoPaths.repo }).from(schema.repoPaths)
  const mapped = new Set(existingPaths.map((row) => `${row.owner}/${row.repo}`))

  for (const row of source.repoPaths) {
    const owner = String(row.owner ?? '')
    const repo = String(row.repo ?? '')
    const path = String(row.path ?? '')
    if (!owner || !repo || !path) continue
    if (mapped.has(`${owner}/${repo}`)) continue
    // Re-validated, per the scope statement — but reported rather than dropped. A path that has moved is
    // editable in Settings; a repo whose configuration is gone is not recoverable.
    if (!looksLikeCheckout(path)) report.checkoutsUnverified.push(`${owner}/${repo}`)
    const text = (column: string): string | null => {
      const value = row[column]
      return typeof value === 'string' && value.length > 0 ? value : null
    }
    await db.insert(schema.repoPaths).values({
      owner,
      repo,
      githubRepoId: typeof row.github_repo_id === 'number' ? row.github_repo_id : null,
      path,
      runTargets: text('run_targets'),
      editorCommand: text('editor_command'),
      setupScript: text('setup_script'),
      setupScriptTrigger: text('setup_script_trigger'),
      devScript: text('dev_script'),
      devRestartScript: text('dev_restart_script'),
      teardownScript: text('teardown_script'),
      dbUrlScript: text('db_url_script'),
      dbSchemaMode: text('db_schema_mode'),
      dbSchemaValue: text('db_schema_value'),
      dbSchemaNotes: text('db_schema_notes'),
      previewMode: text('preview_mode'),
      previewValue: text('preview_value'),
      browserRules: text('browser_rules'),
      branchPrefix: text('branch_prefix'),
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing()
    mapped.add(`${owner}/${repo}`)
    report.checkoutsImported += 1
  }

  return report
}
