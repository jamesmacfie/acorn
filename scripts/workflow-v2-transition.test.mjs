import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { transitionWorkflowV2DevelopmentState, TRANSITION_VERSION } from './workflow-v2-transition.mjs'

const roots = []
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }) })

function fixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'acorn-workflow-v2-fixture-'))
  roots.push(fixtureRoot)
  mkdirSync(join(fixtureRoot, 'plugins'))
  writeFileSync(join(fixtureRoot, 'keep.txt'), 'arbitrary user file')
  const core = new DatabaseSync(join(fixtureRoot, 'core.sqlite'))
  core.exec(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, parent_id TEXT, worktree_path TEXT);
    CREATE TABLE task_links (task_id TEXT, url TEXT);
    CREATE TABLE integrations (id TEXT PRIMARY KEY, token TEXT);
    CREATE TABLE devices (id TEXT PRIMARY KEY);
    CREATE TABLE prefs (user_id TEXT, key TEXT, value TEXT);
    CREATE TABLE dashboard_measure_samples (panel_id TEXT, value REAL);
    CREATE TABLE dashboard_drafts (id TEXT PRIMARY KEY);
    CREATE TABLE dashboard_revisions (dashboard_id TEXT);
    CREATE TABLE query_drafts (id TEXT PRIMARY KEY);
    CREATE TABLE query_revisions (query_id TEXT);
    CREATE TABLE query_consumers (query_id TEXT);
    CREATE TABLE query_publication_holds (query_id TEXT);
    CREATE TABLE user_schedules (id TEXT PRIMARY KEY, kind TEXT);
    CREATE TABLE schedule_state (key TEXT PRIMARY KEY);
    CREATE TABLE schedule_runs (key TEXT);
    INSERT INTO tasks VALUES ('task-1','Keep me','parent-task','/tmp/preserved-worktree');
    INSERT INTO task_links VALUES ('task-1','https://example.test');
    INSERT INTO integrations VALUES ('connection-1','secret');
    INSERT INTO devices VALUES ('device-1');
    INSERT INTO prefs VALUES ('owner','dashboards','{}'), ('owner','theme','dark');
    INSERT INTO dashboard_drafts VALUES ('dashboard-1');
    INSERT INTO dashboard_revisions VALUES ('dashboard-1');
    INSERT INTO query_drafts VALUES ('query-1');
    INSERT INTO user_schedules VALUES ('schedule-1','workflow'), ('schedule-2','other');
    INSERT INTO schedule_state VALUES ('user:schedule-1'), ('user:schedule-2');
    INSERT INTO schedule_runs VALUES ('user:schedule-1'), ('user:schedule-2');
  `)
  core.close()
  const workflows = new DatabaseSync(join(fixtureRoot, 'plugins', 'workflows.sqlite'))
  workflows.exec(`
    CREATE TABLE workflow_runs (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE workflow_steps (id TEXT PRIMARY KEY);
    CREATE TABLE workflow_defs (id TEXT PRIMARY KEY);
    CREATE TABLE workflow_dispatches (id TEXT PRIMARY KEY, state TEXT);
    CREATE TABLE workflow_schedule_occurrences (id TEXT PRIMARY KEY, state TEXT);
    INSERT INTO workflow_runs VALUES ('run-1','done');
    INSERT INTO workflow_steps VALUES ('step-1');
    INSERT INTO workflow_defs VALUES ('def-1');
    INSERT INTO workflow_dispatches VALUES ('dispatch-1','settled');
    INSERT INTO workflow_schedule_occurrences VALUES ('occurrence-1','terminal');
  `)
  workflows.close()
  const agents = new DatabaseSync(join(fixtureRoot, 'plugins', 'agents.sqlite'))
  agents.exec("CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, task_id TEXT); INSERT INTO agent_sessions VALUES ('session-1','task-1');")
  agents.close()
  const changes = new DatabaseSync(join(fixtureRoot, 'plugins', 'changes.sqlite'))
  changes.exec("CREATE TABLE review_notes (id TEXT PRIMARY KEY, body TEXT); INSERT INTO review_notes VALUES ('note-1','Keep this note');")
  changes.close()
  return fixtureRoot
}

function copiedFixture() {
  const source = fixture()
  const copy = mkdtempSync(join(tmpdir(), 'acorn-workflow-v2-copy-'))
  roots.push(copy)
  cpSync(source, copy, { recursive: true })
  return copy
}

describe('workflow-v2 development-state transition', () => {
  it('exports and resets only the named workflow/query/dashboard state in a copied data root', () => {
    const dataDir = copiedFixture()
    const exportDir = `${dataDir}-recovery`
    roots.push(exportDir)
    const manifest = transitionWorkflowV2DevelopmentState({ dataDir, exportDir })
    assert.equal(manifest.version, TRANSITION_VERSION)
    assert.equal(readFileSync(join(dataDir, 'keep.txt'), 'utf8'), 'arbitrary user file')
    assert.ok(existsSync(join(exportDir, 'manifest.json')))
    assert.equal(statSync(exportDir).mode & 0o777, 0o700)
    assert.equal(statSync(join(exportDir, 'manifest.json')).mode & 0o777, 0o600)
    const exportedRuns = readFileSync(join(exportDir, 'workflows-workflow_runs.json'))
    assert.equal(
      manifest.files.find(file => file.file === 'workflows-workflow_runs.json').sha256,
      createHash('sha256').update(exportedRuns).digest('hex'),
    )

    const core = new DatabaseSync(join(dataDir, 'core.sqlite'))
    assert.equal(core.prepare('SELECT count(*) count FROM tasks').get().count, 1)
    assert.equal(core.prepare('SELECT count(*) count FROM task_links').get().count, 1)
    assert.equal(core.prepare('SELECT count(*) count FROM integrations').get().count, 1)
    assert.equal(core.prepare('SELECT count(*) count FROM devices').get().count, 1)
    const task = core.prepare('SELECT parent_id, worktree_path FROM tasks').get()
    assert.equal(task.parent_id, 'parent-task')
    assert.equal(task.worktree_path, '/tmp/preserved-worktree')
    assert.equal(core.prepare("SELECT count(*) count FROM prefs WHERE key = 'dashboards'").get().count, 0)
    assert.equal(core.prepare("SELECT count(*) count FROM prefs WHERE key = 'theme'").get().count, 1)
    assert.deepEqual(core.prepare('SELECT id FROM user_schedules ORDER BY id').all().map(row => row.id), ['schedule-2'])
    core.close()

    const workflows = new DatabaseSync(join(dataDir, 'plugins', 'workflows.sqlite'))
    assert.equal(workflows.prepare('SELECT count(*) count FROM workflow_runs').get().count, 0)
    assert.equal(workflows.prepare('SELECT count(*) count FROM workflow_defs').get().count, 0)
    workflows.close()

    const agents = new DatabaseSync(join(dataDir, 'plugins', 'agents.sqlite'))
    assert.equal(agents.prepare('SELECT count(*) count FROM agent_sessions').get().count, 1)
    agents.close()
    const changes = new DatabaseSync(join(dataDir, 'plugins', 'changes.sqlite'))
    assert.equal(changes.prepare('SELECT count(*) count FROM review_notes').get().count, 1)
    changes.close()
    assert.throws(() => transitionWorkflowV2DevelopmentState({ dataDir, exportDir: `${dataDir}-second-export` }), /already completed/)
  })

  it('refuses active writers before changing the copied fixture', () => {
    for (const [statement, checkSql] of [
      ["UPDATE workflow_runs SET status = 'running'", "SELECT count(*) count FROM workflow_runs WHERE status = 'running'"],
      ["UPDATE workflow_dispatches SET state = 'reserved'", "SELECT count(*) count FROM workflow_dispatches WHERE state = 'reserved'"],
      ["UPDATE workflow_schedule_occurrences SET state = 'claimed'", "SELECT count(*) count FROM workflow_schedule_occurrences WHERE state = 'claimed'"],
    ]) {
      const dataDir = copiedFixture()
      const workflows = new DatabaseSync(join(dataDir, 'plugins', 'workflows.sqlite'))
      workflows.exec(statement)
      workflows.close()
      const exportDir = `${dataDir}-recovery`
      roots.push(exportDir)
      assert.throws(() => transitionWorkflowV2DevelopmentState({ dataDir, exportDir }), /quiescent workflow writers/)
      assert.equal(existsSync(exportDir), false)
      const check = new DatabaseSync(join(dataDir, 'plugins', 'workflows.sqlite'))
      assert.equal(check.prepare(checkSql).get().count, 1)
      check.close()
    }
  })
})
