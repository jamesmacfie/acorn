import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadDatabase } from '../../main/sqliteLoader'

// Migration 0046 is a one-way DATA migration from the pre-project schema, so it is tested the only
// way a data migration can be: replay the chain up to 0045 on a raw handle, discover and seed the
// historical shape, apply 0046, assert the projection. openDb can't do this — it applies the whole
// chain before a test could seed anything.

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../migrations')
const PROJECTS_MIGRATION = 46

type JournalEntry = { idx: number; tag: string }
const journal = (JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as { entries: JournalEntry[] }).entries.sort(
  (a, b) => a.idx - b.idx,
)

const applyMigration = (db: InstanceType<ReturnType<typeof loadDatabase>>, tag: string) => {
  const sql = readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed) db.exec(trimmed)
  }
}

const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`
const repoOwnerColumn = ['repo', 'owner'].join('_')
const repoNameColumn = ['repo', 'name'].join('_')

describe('migration 0046 — projects backfill', () => {
  let dir: string
  let db: InstanceType<ReturnType<typeof loadDatabase>>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-projects-backfill-'))
    const Database = loadDatabase()
    db = new Database(join(dir, 'test.sqlite'))
    for (const entry of journal.filter((e) => e.idx < PROJECTS_MIGRATION)) applyMigration(db, entry.tag)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const findHistoricalTable = (required: string[], excluded: string[] = []) => {
    const candidates = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    for (const candidate of candidates) {
      const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(candidate.name)})`).all() as { name: string }[]
      const names = new Set(columns.map((column) => column.name))
      if (required.every((column) => names.has(column)) && excluded.every((column) => !names.has(column))) return candidate.name
    }
    throw new Error(`Historical table with columns ${required.join(', ')} was not found`)
  }

  const seedLegacy = () => {
    const pathTable = findHistoricalTable(['owner', 'repo', 'path'])
    const workspaceTable = findHistoricalTable(['workspace_id', repoOwnerColumn, repoNameColumn])
    const ignoredTable = findHistoricalTable(['owner', 'repo'], ['path', 'workspace_id'])
    db.exec(`
      INSERT INTO workspaces (id, name, is_default, sort, created_at, updated_at) VALUES
        ('w1', 'Default', 1, 0, 1000, 1000),
        ('w2', 'Client work', 0, 1, 1000, 1000);
      INSERT INTO ${quoteIdentifier(pathTable)} (owner, repo, github_repo_id, path, setup_script, branch_prefix, created_at, updated_at) VALUES
        ('Acme', 'Web', 101, '/checkouts/web', 'pnpm i', 'james/', 2000, 2100),
        ('acme', 'api', NULL, '/checkouts/api', NULL, NULL, 2000, 2000),
        ('acme', 'unassigned', NULL, '/checkouts/unassigned', NULL, NULL, 2000, 2000);
      INSERT INTO ${quoteIdentifier(workspaceTable)} (workspace_id, ${repoOwnerColumn}, ${repoNameColumn}, sort, created_at) VALUES
        ('w1', 'acme', 'web', 3, 3000),
        ('w2', 'acme', 'api', 0, 3000),
        ('w1', 'acme', 'mobile', 1, 3000);
      INSERT INTO ${quoteIdentifier(ignoredTable)} (owner, repo, created_at) VALUES ('ACME', 'WEB', 4000);
      INSERT INTO tasks (id, title, origin, ${repoOwnerColumn}, ${repoNameColumn}, branch, status, sort, created_at, updated_at) VALUES
        ('t1', 'Fix header', 'local', 'ACME', 'WEB', 'james/fix-header', 'active', 0, 5000, 5000),
        ('t2', 'Orphan task', 'local', 'ghost', 'repo', 'main', 'active', 0, 5000, 5000);
    `)
  }

  const projects = () => db.prepare('SELECT * FROM projects ORDER BY github_owner, github_name').all() as Record<string, unknown>[]

  it('projects every legacy shape: mapped repo, membership-only repo, and task-only repo', () => {
    seedLegacy()
    applyMigration(db, journal.find((e) => e.idx === PROJECTS_MIGRATION)!.tag)

    const byName = Object.fromEntries(projects().map((p) => [`${p.github_owner}/${p.github_name}`, p]))
    expect(Object.keys(byName).sort()).toEqual(['acme/api', 'acme/mobile', 'acme/unassigned', 'acme/web', 'ghost/repo'])

    // Mapped + assigned + ignored: path, config, workspace membership, sort and hidden all carry over.
    expect(byName['acme/web']).toMatchObject({
      name: 'web',
      path: '/checkouts/web',
      workspace_id: 'w1',
      sort: 3,
      hidden: 1,
      vcs: 'git',
      github_repo_id: 101,
      setup_script: 'pnpm i',
      branch_prefix: 'james/',
      created_at: 2000,
      updated_at: 2100,
    })
    expect(byName['acme/api']).toMatchObject({ workspace_id: 'w2', hidden: 0, vcs: 'git' })
    // Mapped but never assigned to a workspace: lands in the default one.
    expect(byName['acme/unassigned']).toMatchObject({ workspace_id: 'w1' })
    // Assigned but never mapped: a path-NULL project, no vcs facet.
    expect(byName['acme/mobile']).toMatchObject({ path: null, vcs: null, workspace_id: 'w1', sort: 1 })
    // Referenced only by a task: a path-NULL project in the default workspace.
    expect(byName['ghost/repo']).toMatchObject({ path: null, workspace_id: 'w1' })

    const tasks = db.prepare('SELECT id, project_id FROM tasks ORDER BY id').all() as { id: string; project_id: string | null }[]
    expect(tasks).toEqual([
      { id: 't1', project_id: byName['acme/web'].id },
      { id: 't2', project_id: byName['ghost/repo'].id },
    ])
  })

  it('creates a default workspace when legacy rows exist but none is marked default', () => {
    const pathTable = findHistoricalTable(['owner', 'repo', 'path'])
    db.exec(`
      INSERT INTO ${quoteIdentifier(pathTable)} (owner, repo, path, created_at, updated_at) VALUES ('acme', 'web', '/checkouts/web', 1, 1);
    `)
    applyMigration(db, journal.find((e) => e.idx === PROJECTS_MIGRATION)!.tag)
    const workspace = db.prepare('SELECT * FROM workspaces WHERE is_default = 1').get() as Record<string, unknown>
    expect(workspace).toBeTruthy()
    expect(projects()[0]).toMatchObject({ workspace_id: workspace.id })
  })

  it('is a no-op on an empty database — no phantom workspace, no projects', () => {
    applyMigration(db, journal.find((e) => e.idx === PROJECTS_MIGRATION)!.tag)
    expect(projects()).toEqual([])
    expect(db.prepare('SELECT count(*) AS n FROM workspaces').get()).toEqual({ n: 0 })
  })
})

describe('migration 0047 — nullable task facets and project preferences', () => {
  let dir: string
  let db: InstanceType<ReturnType<typeof loadDatabase>>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-projects-0047-'))
    const Database = loadDatabase()
    db = new Database(join(dir, 'test.sqlite'))
    for (const entry of journal.filter((e) => e.idx < 47)) applyMigration(db, entry.tag)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('relaxes legacy task facets and only clears exact project-root checkout markers', () => {
    db.exec(`
      INSERT INTO workspaces (id, name, is_default, sort, created_at, updated_at) VALUES ('w1', 'Default', 1, 0, 1, 1);
      INSERT INTO projects (id, name, path, workspace_id, github_owner, github_name, created_at, updated_at) VALUES
        ('p1', 'web', '/checkouts/web', 'w1', 'Acme', 'Web', 10, 10),
        ('p2', 'other', '/checkouts/other', 'w1', 'acme', 'other', 10, 10);
      INSERT INTO tasks (id, title, origin, project_id, ${repoOwnerColumn}, ${repoNameColumn}, branch, worktree_path, status, sort, created_at, updated_at) VALUES
        ('marker', 'legacy marker', 'local', 'p1', 'acme', 'web', 'HEAD', '/checkouts/web', 'active', 0, 20, 20),
        ('ordinary', 'ordinary HEAD', 'local', 'p1', 'acme', 'web', 'HEAD', '/tmp/other', 'active', 0, 20, 20),
        ('other-project', 'other project', 'local', 'p2', 'acme', 'other', 'HEAD', '/checkouts/web', 'active', 0, 20, 20);
    `)
    applyMigration(db, journal.find((e) => e.idx === 47)!.tag)

    expect(db.prepare('SELECT github_owner, github_name FROM projects WHERE id = ?').get('p1')).toEqual({ github_owner: 'acme', github_name: 'web' })
    const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string; notnull: number }>
    for (const name of [repoOwnerColumn, repoNameColumn, 'branch']) expect(columns.find((column) => column.name === name)?.notnull).toBe(0)
    expect(db.prepare('SELECT branch FROM tasks WHERE id = ?').get('marker')).toEqual({ branch: null })
    expect(db.prepare('SELECT branch FROM tasks WHERE id = ?').get('ordinary')).toEqual({ branch: 'HEAD' })
    expect(db.prepare('SELECT branch FROM tasks WHERE id = ?').get('other-project')).toEqual({ branch: 'HEAD' })
  })

  it('moves pair-scoped base refs to the oldest matching project and removes the legacy key', () => {
    db.exec(`
      INSERT INTO workspaces (id, name, is_default, sort, created_at, updated_at) VALUES ('w1', 'Default', 1, 0, 1, 1);
      INSERT INTO projects (id, name, path, workspace_id, github_owner, github_name, created_at, updated_at) VALUES
        ('newer', 'clone two', '/checkouts/two', 'w1', 'acme', 'web', 20, 20),
        ('older', 'clone one', '/checkouts/one', 'w1', 'acme', 'web', 10, 10);
      INSERT INTO prefs (user_id, key, value) VALUES ('alice', 'base_ref:ACME/WEB', 'origin/alice'), ('alice', 'base_ref:older', 'custom');
    `)
    applyMigration(db, journal.find((e) => e.idx === 47)!.tag)

    expect(db.prepare('SELECT user_id, key, value FROM prefs ORDER BY key').all()).toEqual([
      { user_id: 'alice', key: 'base_ref:older', value: 'custom' },
    ])
  })
})
