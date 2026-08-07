import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importV1Config, probeV1Root } from './v1Import'
import { openDb } from './bindings'
import { loadDatabase } from './sqliteLoader'
import { schema } from '../server/db'
import type { AppDatabase } from '../server/db'

let v1Root: string
let vnextRoot: string
let db: AppDatabase

const V1_DDL = [
  'CREATE TABLE workspaces (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, is_default INTEGER DEFAULT 0 NOT NULL, sort INTEGER DEFAULT 0 NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, icon TEXT, color TEXT)',
  'CREATE TABLE workspace_repos (workspace_id TEXT NOT NULL, repo_owner TEXT NOT NULL, repo_name TEXT NOT NULL, sort INTEGER DEFAULT 0 NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (repo_owner, repo_name))',
  'CREATE TABLE ignored_repos (owner TEXT NOT NULL, repo TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (owner, repo))',
  'CREATE TABLE repo_paths (owner TEXT NOT NULL, repo TEXT NOT NULL, github_repo_id INTEGER, path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, editor_command TEXT, run_targets TEXT, setup_script TEXT, setup_script_trigger TEXT, dev_script TEXT, dev_restart_script TEXT, teardown_script TEXT, db_url_script TEXT, db_schema_mode TEXT, db_schema_value TEXT, preview_mode TEXT, preview_value TEXT, browser_rules TEXT, db_schema_notes TEXT, branch_prefix TEXT, PRIMARY KEY (owner, repo))',
  // The excluded ones. Present so their absence downstream is evidence rather than an artefact.
  'CREATE TABLE prefs (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key))',
  "CREATE TABLE integrations (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, provider TEXT NOT NULL, label TEXT NOT NULL, access_token TEXT NOT NULL, auth_kind TEXT DEFAULT 'api-key' NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  'CREATE TABLE config_acks (repo TEXT NOT NULL, hash TEXT NOT NULL, snapshot TEXT NOT NULL, acked_at INTEGER NOT NULL, PRIMARY KEY (repo, hash))',
  'CREATE TABLE tasks (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL)',
  'CREATE TABLE workspace_projects (workspace_id TEXT NOT NULL, integration_id TEXT NOT NULL, external_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, integration_id, external_id))',
]

// A real git checkout, so the path re-validation has something true to find.
function makeCheckout(dir: string): string {
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}

beforeEach(() => {
  v1Root = mkdtempSync(join(tmpdir(), 'acorn-v1-src-'))
  vnextRoot = mkdtempSync(join(tmpdir(), 'acorn-v1-dest-'))
  const Database = loadDatabase()
  const v1 = new Database(join(v1Root, 'acorn.sqlite'))
  for (const statement of V1_DDL) v1.exec(statement)
  const now = 1_700_000_000_000
  v1.exec(`INSERT INTO workspaces VALUES ('ws-default','Default',1,0,${now},${now},NULL,NULL)`)
  v1.exec(`INSERT INTO workspaces VALUES ('ws-runn','Runn',0,1,${now},${now},'{"kind":"emoji","value":"🌰"}','green')`)
  v1.exec(`INSERT INTO workspace_repos VALUES ('ws-runn','runn','runn',0,${now})`)
  v1.exec(`INSERT INTO workspace_repos VALUES ('ws-default','acme','tools',1,${now})`)
  v1.exec(`INSERT INTO ignored_repos VALUES ('acme','archived',${now})`)
  v1.exec(
    `INSERT INTO repo_paths (owner,repo,github_repo_id,path,created_at,updated_at,dev_script,branch_prefix) VALUES ('runn','runn',42,'${makeCheckout(join(v1Root, 'checkouts', 'runn'))}',${now},${now},'pnpm dev','jamesmacfie/')`,
  )
  v1.exec(
    `INSERT INTO repo_paths (owner,repo,path,created_at,updated_at) VALUES ('acme','tools','${join(v1Root, 'gone')}',${now},${now})`,
  )
  // Excluded content, deliberately recognisable so a leak into the destination is greppable.
  v1.exec("INSERT INTO prefs VALUES ('james','theme','dracula')")
  v1.exec(`INSERT INTO integrations VALUES ('int-1','james','linear','Work','V1-SECRET-TOKEN','api-key',${now},${now})`)
  v1.exec(`INSERT INTO config_acks VALUES ('runn/runn','abc123','### .acorn/config.toml',${now})`)
  v1.exec("INSERT INTO tasks VALUES ('task-1','Fix the thing')")
  v1.exec("INSERT INTO workspace_projects VALUES ('ws-runn','int-1','proj-1',0)")
  v1.close()

  db = openDb(join(vnextRoot, 'core.sqlite'))
})

afterEach(() => {
  try {
    db.close()
  } catch {
    // a case may have closed it already
  }
  rmSync(v1Root, { recursive: true, force: true })
  rmSync(vnextRoot, { recursive: true, force: true })
})

// What App.tsx's first-run bootstrap leaves behind: a Default workspace holding every mirrored repo.
// The import has to work FROM this state, not from an empty database, and that is the whole reason the
// membership half is a move rather than an insert.
async function seedBootstrap(repos: Array<[string, string]>) {
  const now = Date.now()
  await db.insert(schema.workspaces).values({
    id: 'local-default',
    name: 'Default',
    isDefault: true,
    sort: 0,
    icon: null,
    color: null,
    createdAt: now,
    updatedAt: now,
  })
  for (const [owner, name] of repos) {
    await db.insert(schema.workspaceRepos).values({
      workspaceId: 'local-default',
      repoOwner: owner,
      repoName: name,
      sort: 0,
      createdAt: now,
    })
  }
}

const membership = async () =>
  Object.fromEntries((await db.select().from(schema.workspaceRepos)).map((row) => [`${row.repoOwner}/${row.repoName}`, row.workspaceId]))

describe('probeV1Root', () => {
  it('counts what is there', () => {
    expect(probeV1Root(v1Root)).toMatchObject({ found: true, workspaces: 2, repos: 2, checkouts: 2 })
  })

  it('answers "no" for a directory with no V1 database, and for null', () => {
    // Speculative on every first run, so a machine without a V1 install must get a clean "no" rather
    // than an error the owner has to dismiss.
    expect(probeV1Root(vnextRoot).found).toBe(false)
    expect(probeV1Root(null).found).toBe(false)
  })
})

describe('importV1Config', () => {
  it('brings across workspaces, grouping, hidden repos and checkout config', async () => {
    await seedBootstrap([['runn', 'runn'], ['acme', 'tools']])

    const report = await importV1Config(db, v1Root)

    const workspaces = await db.select().from(schema.workspaces)
    expect(workspaces.map((row) => row.name).sort()).toEqual(['Default', 'Runn'])
    expect(workspaces.filter((row) => row.isDefault)).toHaveLength(1)
    expect(report.workspacesCreated).toBe(1)
    // Names, colours and order, per the scope statement.
    const runn = workspaces.find((row) => row.name === 'Runn')!
    expect(runn.color).toBe('green')
    expect(runn.sort).toBe(1)

    expect(await membership()).toEqual({ 'runn/runn': runn.id, 'acme/tools': 'local-default' })
    expect(report.reposRegrouped).toBe(1)

    expect((await db.select().from(schema.ignoredRepos)).map((row) => `${row.owner}/${row.repo}`)).toEqual(['acme/archived'])

    // Checkout paths and the owner's own machine-local build settings.
    const paths = await db.select().from(schema.repoPaths)
    expect(paths).toHaveLength(2)
    expect(paths.find((row) => row.repo === 'runn')).toMatchObject({ devScript: 'pnpm dev', branchPrefix: 'jamesmacfie/', githubRepoId: 42 })
    // Re-validated but IMPORTED anyway, and reported: a moved path is editable in Settings, a lost repo
    // configuration is not recoverable.
    expect(report.checkoutsUnverified).toEqual(['acme/tools'])
    expect(report.checkoutsImported).toBe(2)
  })

  it('brings across nothing it was told not to', async () => {
    await seedBootstrap([])
    await importV1Config(db, v1Root)

    expect(await db.select().from(schema.prefs)).toEqual([])
    expect(await db.select().from(schema.integrations)).toEqual([])
    expect(await db.select().from(schema.tasks)).toEqual([])
    expect(await db.select().from(schema.configAcks)).toEqual([])
    // Every row names an integrationId we refuse to import, so these would be dangling references.
    expect(await db.select().from(schema.workspaceProjects)).toEqual([])
    // The belt-and-braces version: the credential is nowhere in the destination file at all.
    db.close()
    expect(readFileSync(join(vnextRoot, 'core.sqlite')).includes('V1-SECRET-TOKEN')).toBe(false)
  })

  it('is idempotent — a second run changes nothing', async () => {
    await seedBootstrap([['runn', 'runn'], ['acme', 'tools']])
    const first = await importV1Config(db, v1Root)
    const after = await membership()

    const second = await importV1Config(db, v1Root)

    // Resumability falls out of this rather than needing a ledger: a run interrupted halfway is finished
    // by running it again.
    expect(second).toMatchObject({ workspacesCreated: 0, reposRegrouped: 0, reposIgnored: 0, checkoutsImported: 0 })
    expect(await membership()).toEqual(after)
    expect((await db.select().from(schema.workspaces)).length).toBe(2)
    expect(first.workspacesCreated).toBe(1)
  })

  it('leaves a repo the owner has already moved out of Default alone', async () => {
    await seedBootstrap([['acme', 'tools']])
    const now = Date.now()
    await db.insert(schema.workspaces).values({ id: 'mine', name: 'Mine', isDefault: false, sort: 9, icon: null, color: null, createdAt: now, updatedAt: now })
    await db
      .update(schema.workspaceRepos)
      .set({ workspaceId: 'mine' })
      .where(and(eq(schema.workspaceRepos.repoOwner, 'acme'), eq(schema.workspaceRepos.repoName, 'tools')))

    await importV1Config(db, v1Root)

    expect((await membership())['acme/tools']).toBe('mine')
  })

  it('never touches the V1 files', async () => {
    await seedBootstrap([['runn', 'runn']])
    const before = fingerprintDir(v1Root)

    await importV1Config(db, v1Root)
    probeV1Root(v1Root)

    expect(fingerprintDir(v1Root)).toEqual(before)
  })
})

// sha256 of every file in the tree, keyed by relative path. Sidecars included — their appearance is
// itself a change, and the naive "hash the .sqlite" version would have missed exactly that.
function fingerprintDir(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) Object.assign(out, fingerprintDir(join(dir, entry.name), rel))
    else out[rel] = createHash('sha256').update(readFileSync(join(dir, entry.name))).digest('hex')
  }
  return out
}

const realRoot = process.env.ACORN_V1_ROOT
describe.skipIf(!realRoot)('against a copy of a real V1 data root', () => {
  it('imports it, twice, without touching it', async () => {
    const before = fingerprintDir(realRoot!)
    const probe = probeV1Root(realRoot!)
    expect(probe.found).toBe(true)

    const first = await importV1Config(db, realRoot!)
    expect(first.workspacesCreated + first.reposRegrouped + first.checkoutsImported).toBeGreaterThan(0)

    const second = await importV1Config(db, realRoot!)
    expect(second).toMatchObject({ workspacesCreated: 0, reposRegrouped: 0, checkoutsImported: 0 })

    expect(fingerprintDir(realRoot!)).toEqual(before)
    // Real data, so the exclusion assertions matter most here: a real root has real credentials in it.
    expect(await db.select().from(schema.integrations)).toEqual([])
    expect(await db.select().from(schema.prefs)).toEqual([])
    expect(await db.select().from(schema.configAcks)).toEqual([])
  }, 120_000)
})
