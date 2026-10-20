import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as schema from '../../node/schema'

const MIGRATIONS = fileURLToPath(new URL('../../../migrations', import.meta.url))
const TRIGGERS_TAG = '0005_triggers'

/** The chain as a Node had it before triggers, in a folder the test can extend later. */
function chainBeforeTriggers(): string {
  const folder = mkdtempSync(join(tmpdir(), 'acorn-workflows-chain-'))
  cpSync(MIGRATIONS, folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; tag: string }[] }
  const triggers = journal.entries.find((entry) => entry.tag === TRIGGERS_TAG)!.idx
  const later = journal.entries.filter((entry) => entry.idx >= triggers)
  for (const entry of later) rmSync(join(folder, `${entry.tag}.sql`))
  writeFileSync(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx < triggers) }),
  )
  return folder
}

const occurrenceStates = ['claimed', 'task-created', 'run-started', 'terminal', 'skipped', 'blocked'] as const

function seedSchedules(database: TestPluginDb): void {
  const at = 1_800_000_000_000
  database.db.run(sql`
    INSERT INTO workflow_schedules
      (id, scheduler_key, workspace_id, project_id, workflow_id, inputs_json, timezone, limits_json, loops_json,
       approved_graph_json, approved_graph_digest, generation, epoch, state, first_check, error, created_at, updated_at)
    VALUES
      ('daily', 'user:daily', 'w', 'p', 'wf', '{"count":2}', 'Pacific/Auckland', '{"maxDescendants":10}',
       '[{"loopId":"loop","repeat":{"mode":"unseen"},"incremental":true}]', '{"root":{}}', 'digest', 3, 'epoch-1',
       'active', 'process-current', NULL, ${at}, ${at}),
      ('baseline', 'user:baseline', 'w', 'p', 'wf', '{}', 'UTC', '{}', '[]', '{"root":{}}', 'digest', 1, 'epoch-2',
       'baselining', 'track-now', NULL, ${at}, ${at})
  `)
  occurrenceStates.forEach((state, index) => {
    database.db.run(sql`
      INSERT INTO workflow_schedule_occurrences
        (id, schedule_id, generation, kind, due_at, request_key, payload_fingerprint, payload_json, task_id, run_id,
         state, detail, created_at, updated_at)
      VALUES (${`occ-${state}`}, 'daily', 3, 'due', ${at + index}, ${`due:3:${at + index}`}, 'fp', '{}',
        ${`task-${state}`}, ${`run-${state}`}, ${state}, NULL, ${at}, ${at})
    `)
    database.db.run(sql`
      INSERT INTO workflow_runs (id, task_id, name, status, started_by, def_json, root_run_id, created_at, updated_at)
      VALUES (${`run-${state}`}, ${`task-${state}`}, 'Scheduled review', 'done', 'schedule', '{}', ${`run-${state}`},
        ${at}, ${at})
    `)
  })
  database.db.run(sql`
    INSERT INTO workflow_schedule_occurrences
      (id, schedule_id, generation, kind, due_at, request_key, payload_fingerprint, payload_json, task_id, run_id,
       state, detail, created_at, updated_at)
    VALUES ('occ-baseline', 'baseline', 1, 'baseline', NULL, 'baseline:1', 'fp', '{"baseline":true}', 'task-baseline',
      'run-baseline', 'run-started', NULL, ${at}, ${at})
  `)
  database.db.run(sql`
    INSERT INTO workflow_runs (id, task_id, name, status, started_by, def_json, root_run_id, created_at, updated_at)
    VALUES ('run-baseline', 'task-baseline', 'Baseline', 'running', 'schedule', '{}', 'run-baseline', ${at}, ${at}),
           ('run-manual', 'task-manual', 'By hand', 'done', 'manual', '{}', 'run-manual', ${at}, ${at})
  `)
  database.db.run(sql`
    INSERT INTO workflow_processing_scopes (run_id, scope_id, epoch, baseline)
    VALUES ('run-run-started', 'daily', 'epoch-1', 0), ('run-baseline', 'baseline', 'epoch-2', 1)
  `)
}

describe('the trigger migration', () => {
  let database: TestPluginDb | undefined
  let folder: string | undefined
  afterEach(() => {
    database?.cleanup()
    if (folder) rmSync(folder, { recursive: true, force: true })
  })

  it('keeps every schedule, occurrence, loop setting, and processing scope as a clock trigger', () => {
    folder = chainBeforeTriggers()
    database = makeTestPluginDb('workflows', folder)
    seedSchedules(database)
    database.db.close()
    cpSync(MIGRATIONS, folder, { recursive: true })
    const migrated = database.openConnection()
    try {
      const triggers = migrated.select().from(schema.workflowTriggers).orderBy(schema.workflowTriggers.id).all()
      expect(triggers).toMatchObject([
        { id: 'baseline', schedulerKey: 'user:baseline', state: 'baselining', firstCheck: 'track-now', generation: 1 },
        {
          id: 'daily',
          schedulerKey: 'user:daily',
          state: 'active',
          epoch: 'epoch-1',
          generation: 3,
          inputsJson: '{"count":2}',
          limitsJson: '{"maxDescendants":10}',
          loopsJson: '[{"loopId":"loop","repeat":{"mode":"unseen"},"incremental":true}]',
          approvedGraphDigest: 'digest',
          errorReason: null,
        },
      ])
      expect(triggers.map((row) => JSON.parse(row.whenJson))).toEqual([
        { kind: 'clock', timezone: 'UTC' },
        { kind: 'clock', timezone: 'Pacific/Auckland' },
      ])

      const occurrences = migrated.select().from(schema.workflowTriggerOccurrences).all()
      expect(occurrences).toHaveLength(occurrenceStates.length + 1)
      expect(occurrences.map((row) => row.state).sort()).toEqual([...occurrenceStates, 'run-started'].sort())
      expect(occurrences.every((row) => row.recordKey === null)).toBe(true)
      expect(occurrences.find((row) => row.id === 'occ-baseline')).toMatchObject({
        triggerId: 'baseline',
        kind: 'baseline',
        requestKey: 'baseline:1',
        runId: 'run-baseline',
      })

      const runs = migrated.select().from(schema.workflowRuns).all()
      for (const run of runs.filter((row) => row.id !== 'run-manual'))
        expect(run).toMatchObject({ startedBy: 'trigger', triggerId: run.id === 'run-baseline' ? 'baseline' : 'daily' })
      expect(runs.find((row) => row.id === 'run-manual')).toMatchObject({ startedBy: 'manual', triggerId: null })
      expect(runs.every((row) => row.errorCause === null)).toBe(true)

      expect(migrated.select().from(schema.workflowProcessingScopes).all()).toEqual(
        expect.arrayContaining([
          { runId: 'run-run-started', scopeId: 'daily', epoch: 'epoch-1', baseline: false },
          { runId: 'run-baseline', scopeId: 'baseline', epoch: 'epoch-2', baseline: true },
        ]),
      )
    } finally {
      migrated.close()
    }
  })
})
