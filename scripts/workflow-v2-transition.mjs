// One explicit, recoverable development-state transition for the workflow-v2 cutover.
// It never deletes databases or repository files. The Node must be stopped, and callers must name
// both the data root and a new export directory so an accidental invocation cannot target defaults.
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

export const TRANSITION_VERSION = 'workflow-v2-development-state-v1'
const CORE_TABLES = [
  'dashboard_measure_samples', 'dashboard_revisions', 'dashboard_drafts',
  'query_consumers', 'query_publication_holds', 'query_revisions', 'query_drafts',
]
const WORKFLOW_TABLES = [
  'workflow_schedule_occurrences', 'workflow_schedules',
  'workflow_record_attempts', 'workflow_record_states', 'workflow_selected_records',
  'workflow_processing_boundaries', 'workflow_selections', 'workflow_processing_scopes',
  'workflow_turn_admissions', 'workflow_dispatches', 'workflow_file_operations',
  'workflow_file_drafts', 'workflow_dependencies', 'workflow_publications',
  'workflow_revisions', 'workflow_steps', 'workflow_runs', 'workflow_defs',
]

const quote = value => `'${String(value).replaceAll("'", "''")}'`
const exists = (db, schema, table) => !!db.prepare(
  `SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`,
).get(table)
const rows = (db, schema, table) => exists(db, schema, table)
  ? db.prepare(`SELECT * FROM ${schema}.${table}`).all()
  : []
const json = value => `${JSON.stringify(value, null, 2)}\n`
const writePrivate = (path, value) => {
  writeFileSync(path, value, { mode: 0o600, flag: 'wx' })
  chmodSync(path, 0o600)
}

export function transitionWorkflowV2DevelopmentState({ dataDir, exportDir }) {
  if (!dataDir || !exportDir) throw new Error('Both dataDir and exportDir are required')
  const root = resolve(dataDir)
  const destination = resolve(exportDir)
  if (destination === root || destination.startsWith(`${root}/`)) {
    throw new Error('The recovery export must be outside the data root')
  }
  if (existsSync(destination)) throw new Error(`Recovery export already exists: ${destination}`)
  const corePath = join(root, 'core.sqlite')
  const workflowPath = join(root, 'plugins', 'workflows.sqlite')
  const completionPath = join(root, `${TRANSITION_VERSION}.json`)
  if (existsSync(completionPath)) throw new Error(`Transition already completed: ${completionPath}`)
  if (!existsSync(corePath) || !existsSync(workflowPath)) throw new Error('Expected core.sqlite and plugins/workflows.sqlite in the named data root')

  const db = new DatabaseSync(corePath, { timeout: 1_000 })
  try {
    db.exec(`ATTACH DATABASE ${quote(workflowPath)} AS workflows`)
    db.exec('BEGIN IMMEDIATE')
    const activeRuns = exists(db, 'workflows', 'workflow_runs')
      ? db.prepare("SELECT id, status FROM workflows.workflow_runs WHERE status IS NULL OR status NOT IN ('done','completed-with-failures','failed','safety-rail','cancelled') LIMIT 20").all()
      : []
    const activeDispatches = exists(db, 'workflows', 'workflow_dispatches')
      ? db.prepare("SELECT id, state FROM workflows.workflow_dispatches WHERE state IS NULL OR state != 'settled' LIMIT 20").all()
      : []
    const activeOccurrences = exists(db, 'workflows', 'workflow_schedule_occurrences')
      ? db.prepare("SELECT id, state FROM workflows.workflow_schedule_occurrences WHERE state IS NULL OR state NOT IN ('terminal','skipped','blocked') LIMIT 20").all()
      : []
    if (activeRuns.length || activeDispatches.length || activeOccurrences.length) {
      db.exec('ROLLBACK')
      throw new Error(`Transition requires quiescent workflow writers; active rows: ${json({ activeRuns, activeDispatches, activeOccurrences }).trim()}`)
    }

    mkdirSync(destination, { recursive: false, mode: 0o700 })
    chmodSync(destination, 0o700)
    const exported = []
    for (const [schema, tables] of [['main', CORE_TABLES], ['workflows', WORKFLOW_TABLES]]) {
      for (const table of tables) {
        if (!exists(db, schema, table)) continue
        const body = json(rows(db, schema, table))
        const file = `${schema}-${table}.json`
        writePrivate(join(destination, file), body)
        exported.push({ schema, table, file, rows: JSON.parse(body).length, sha256: createHash('sha256').update(body).digest('hex') })
      }
    }
    const dashboardPrefs = exists(db, 'main', 'prefs')
      ? db.prepare("SELECT * FROM prefs WHERE key = 'dashboards'").all()
      : []
    writePrivate(join(destination, 'main-dashboard-prefs.json'), json(dashboardPrefs))
    exported.push({ schema: 'main', table: 'prefs:dashboards', file: 'main-dashboard-prefs.json', rows: dashboardPrefs.length, sha256: createHash('sha256').update(json(dashboardPrefs)).digest('hex') })

    const schedules = exists(db, 'main', 'user_schedules')
      ? db.prepare("SELECT * FROM user_schedules WHERE kind = 'workflow'").all()
      : []
    writePrivate(join(destination, 'main-workflow-schedules.json'), json(schedules))
    exported.push({ schema: 'main', table: 'user_schedules:workflow', file: 'main-workflow-schedules.json', rows: schedules.length, sha256: createHash('sha256').update(json(schedules)).digest('hex') })

    const completedAt = new Date().toISOString()
    const manifest = {
      version: TRANSITION_VERSION,
      createdAt: completedAt,
      source: { dataDir: root, core: corePath, workflows: workflowPath },
      preservation: ['tasks', 'task links and lineage', 'worktrees', 'notes', 'agent sessions', 'credentials', 'connections', 'pairings', 'repository and user files'],
      files: exported,
      recovery: 'Stop the Node, verify every SHA-256 digest, then restore rows from these JSON files with a purpose-built importer or retain this directory for manual recovery.',
    }
    // Recovery metadata must be durable before the transaction removes any row. If a later database
    // operation rolls back, this remains a harmless point-in-time export of unchanged state.
    writePrivate(join(destination, 'manifest.json'), json(manifest))

    for (const table of WORKFLOW_TABLES) if (exists(db, 'workflows', table)) db.exec(`DELETE FROM workflows.${table}`)
    for (const table of CORE_TABLES) if (exists(db, 'main', table)) db.exec(`DELETE FROM main.${table}`)
    if (exists(db, 'main', 'prefs')) db.exec("DELETE FROM prefs WHERE key = 'dashboards'")
    for (const schedule of schedules) {
      if (exists(db, 'main', 'schedule_runs')) db.prepare('DELETE FROM schedule_runs WHERE key = ?').run(`user:${schedule.id}`)
      if (exists(db, 'main', 'schedule_state')) db.prepare('DELETE FROM schedule_state WHERE key = ?').run(`user:${schedule.id}`)
      db.prepare('DELETE FROM user_schedules WHERE id = ?').run(schedule.id)
    }
    db.exec('COMMIT')

    writePrivate(completionPath, json({ version: TRANSITION_VERSION, completedAt, exportDir: destination }))
    return manifest
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* no active transaction */ }
    throw error
  } finally { db.close() }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const value = flag => { const at = process.argv.indexOf(flag); return at < 0 ? undefined : process.argv[at + 1] }
  const manifest = transitionWorkflowV2DevelopmentState({ dataDir: value('--data-dir'), exportDir: value('--export-dir') })
  console.log(`Completed ${manifest.version}; recovery export: ${resolve(value('--export-dir'))}`)
}
