import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import { loadDatabase } from './sqliteLoader'

// The config-only V1 importer (docs/vNext/plan.md § Phase 5, plugin-inventory.md § onboarding).
//
// ## The scope, and it is a quotation rather than a judgement call
//
// plugin-inventory.md:258 states it exactly: "workspace names/colors/order, repo membership, checkout
// paths (re-validated), repo config text (arriving untrusted), branch prefix. Never tokens, tasks,
// notes, memories, terminals, or preferences."
//
// That last word settles a contradiction in the handoff, which assumed the importer would write prefs
// and warned about the device/node tier split. It does not, so the split does not arise. Prefs are
// per-machine presentation and per-machine behaviour; carrying them would mean importing "which task was
// I last on" for tasks that were deliberately not imported.
//
// Four tables come across — `workspaces`, `workspace_repos`, `ignored_repos`, `repo_paths` — and their
// vNext shapes are column-for-column identical to V1's, so this is a copy rather than a transform.
//
// **`config_acks` is deliberately NOT imported**, and that is what security.md:68 means by "imported V1
// config arrives untrusted": the trust gate hashes REPO-AUTHORED files (`.acorn/config.toml`,
// `.acorn/workflows/*.toml` — main/repoConfigTrust.ts), so dropping the acknowledgements means every one
// of them is re-reviewed on this node. The script columns on `repo_paths` are a different thing and DO
// come across: the owner typed those into V1's own settings UI, they are machine-local, and they have
// never been behind that gate.
//
// `workspace_projects` is out too, for a reason of its own: every row names an `integrationId`, and
// integrations are credentials we refuse to import. Rows pointing at connections that do not exist would
// be dangling references the owner cannot see or fix.
//
// ## Why the source is COPIED before it is read
//
// plan.md:172 requires "V1 files byte-identical after import — verified by hashing in tests". Opening a
// WAL database read-only is not enough for that: SQLite may still create a `-shm` beside it, and a
// recovery pass can touch the `-wal`. Copying the three files to a temp directory and reading the copy
// makes the guarantee structural rather than hopeful, and costs one file copy of a few megabytes.

const V1_DATABASE = 'acorn.sqlite'

// Where a packaged V1 install keeps its data root on macOS. V1's Electron `app.getName()` read
// `"@acorn/desktop"` from its package.json, so the directory is the scoped name verbatim — vNext's
// packaged root is `.../acorn` (productName), which is why the two never collide on disk and why the
// V1-root guard in main/dataRoot.ts is really about someone pointing ACORN_DATA_DIR at the old one.
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

// Run `read` against a private copy of the V1 database. The copy, its sidecars and the temp directory
// are gone by the time this returns, whatever happened.
type V1Reader = { prepare(sql: string): { all(): unknown[]; get(): unknown } }

function withV1Copy<T>(dir: string, read: (db: V1Reader) => T): T {
  const source = join(resolve(dir), V1_DATABASE)
  if (!existsSync(source)) throw new Error(`No V1 database at ${source}.`)
  const staging = mkdtempSync(join(tmpdir(), 'acorn-v1-'))
  try {
    const copy = join(staging, V1_DATABASE)
    copyFileSync(source, copy)
    // The sidecars matter: a V1 install that was closed uncleanly has committed transactions living only
    // in the -wal, and reading the main file alone would silently import a stale snapshot.
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

// A count of what is there, for the onboarding panel to decide whether to offer the import at all.
// Never throws: "is there a V1 install" is a question asked speculatively on every first run, and an
// unreadable directory is a "no" rather than an error the owner has to dismiss.
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

  // --- Workspaces, matched BY NAME ---
  //
  // By name rather than by id, and that is what makes a second run a no-op instead of a duplicate: V1
  // ids are uuids that mean nothing here, and the owner recognises a workspace by what it is called.
  //
  // `isDefault` is never imported. The local node already has a default workspace — App.tsx's bootstrap
  // creates one on first run and puts every mirrored repo in it — and a second row claiming to be the
  // default is a state nothing in the app knows how to render. V1's default maps onto the local one.
  const existing = await db.select().from(schema.workspaces)
  const byName = new Map(existing.map((row) => [row.name, row.id]))
  const localDefault = existing.find((row) => row.isDefault)?.id ?? null
  // V1 workspace id → the vNext workspace id its repos should land in.
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
    // The V1 id is reused, which keeps the import readable in the database and costs nothing: the two
    // roots are separate installs, so a collision would need the same uuid to have been minted twice.
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
    if (!targetWorkspace) continue // a membership row pointing at a workspace V1 no longer had
    const key = `${row.repo_owner}/${row.repo_name}`
    const current = membership.get(key)
    if (current === targetWorkspace) continue // already where V1 says, including on a second run
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

  // --- Checkout paths and repo configuration ---
  //
  // Insert-or-ignore, NOT a move: unlike workspace membership, a repo_paths row in vNext can only exist
  // because the owner deliberately mapped a checkout here, and overwriting that with a V1 path would undo
  // a decision rather than seed one.
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
      // The owner's own machine-local build/run configuration, typed into V1's settings UI. Not behind
      // the config-trust gate in either version — that gate is for repo-AUTHORED files, whose
      // acknowledgements are deliberately left behind so they are reviewed again here.
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
