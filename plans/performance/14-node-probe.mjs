// Run: rtk proxy node --expose-gc --import tsx plans/performance/14-node-probe.mjs <memory|workflow|processing> [tag]
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const kind = process.argv[2] ?? 'memory'
const tag = process.argv[3] ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe output tag.')
const output = resolve(`plans/performance/14-${kind}-${tag}.json`)
if (tag.startsWith('before') && fs.existsSync(output)) throw new Error('Before evidence is immutable.')
const fixture = fs.mkdtempSync(join(os.tmpdir(), 'acorn-perf14-'))
const originalHome = os.homedir
const originalRead = fsp.readFile
let fileReads = 0, fileBytes = 0
// The actual Memory owner imports homedir. Bind it to disposable data before any source import.
os.homedir = () => fixture
fsp.readFile = async (...args) => {
  const value = await originalRead(...args)
  if (String(args[0]).startsWith(fixture) && String(args[0]).endsWith('.md')) {
    fileReads++; fileBytes += Buffer.byteLength(value)
  }
  return value
}
syncBuiltinESMExports()
const source = path => import(pathToFileURL(resolve(path)).href)
const { makeTestPluginDb } = await source('packages/node-core/src/testkit/db.ts')
let dbFixture
let statements = [], selectedCellsBytes = 0, selectedRows = 0
const meter = db => {
  const client = db.$client, original = client.prepare.bind(client)
  client.prepare = query => {
    const stmt = original(query)
    for (const method of ['run', 'all', 'get']) {
      const execute = stmt[method].bind(stmt)
      stmt[method] = (...parameters) => {
        const value = execute(...parameters)
        statements.push(query)
        if (method !== 'run') {
          const rows = method === 'all' ? value : value ? [value] : []
          selectedRows += rows.length
          for (const row of rows) for (const cell of Object.values(row)) {
            if (typeof cell === 'string') selectedCellsBytes += Buffer.byteLength(cell)
          }
        }
        return value
      }
    }
    return stmt
  }
}
const measure = async (name, work) => {
  statements = []; selectedRows = 0; selectedCellsBytes = 0; fileReads = 0; fileBytes = 0
  const cpu = process.cpuUsage(), start = performance.now()
  const answer = await work()
  const used = process.cpuUsage(cpu)
  return { name, wallMs: performance.now() - start, cpuMs: (used.user + used.system) / 1000,
    sqlStatements: statements.length, sqlVerbs: statements.reduce((all, s) => {
      const key = s.trim().split(/\s/)[0].toUpperCase(); all[key] = (all[key] ?? 0) + 1; return all
    }, {}), selectedRows, selectedStringBytes: selectedCellsBytes, fileReads, fileBytes, answer }
}
let result
try {
  if (kind === 'memory') {
    const dir = join(fixture, '.acorn', 'memory'); fs.mkdirSync(dir, { recursive: true })
    const { registerKnowledgeChannel } = await source('plugins/memory/src/server/knowledgeChannel.ts')
    const { serializeMemory } = await source('plugins/memory/src/server/memory.ts')
    const count = 300, bodySize = 4096
    for (let i = 0; i < count; i++) fs.writeFileSync(join(dir, `memory-${i}.md`), serializeMemory({
      name: `memory-${i}`, description: 'Synthetic guidance', type: 'reference', originSessionId: null,
      commitSha: null, supersededBy: null, createdAt: 1000, body: `searchable-${i}\n` + 'x'.repeat(bodySize),
    }))
    dbFixture = makeTestPluginDb('memory'); meter(dbFixture.db)
    const runtime = registerKnowledgeChannel(dbFixture.db, {
      tasks: { active: async () => [], load: async () => null }, projects: { checkouts: async () => [] },
      identity: { active: () => 'fixture' }, context: {},
    }, {})
    const cold = await measure('cold-reconciliation', async () => { await runtime.reconciled(); return (await runtime.list({})).length })
    const unchanged = await measure('five-unchanged-reconciliations', async () => {
      for (let i = 0; i < 5; i++) await runtime.reconciled()
      return (await runtime.list({})).length
    })
    const concurrent = await measure('four-concurrent-reconciliations', async () => {
      await Promise.all(Array.from({ length: 4 }, () => runtime.reconciled()))
      return {
        indexRows: dbFixture.db.$client.prepare('SELECT COUNT(*) AS count FROM memories').get().count,
        ftsRows: dbFixture.db.$client.prepare('SELECT COUNT(*) AS count FROM memories_fts').get().count,
      }
    })
    result = { count, bodySize, cold, unchanged, concurrent,
      expected: 'Unchanged reconciliation does no index or FTS writes; overlapping callers share one authority-preserving pass with one FTS row per indexed ID.' }
  } else if (kind === 'workflow') {
    const schema = await source('plugins/workflows/src/node/schema.ts')
    const { workflowTaskNavigation, workflowRunList } = await source('plugins/workflows/src/server/workflowRunProjection.ts')
    const { workflowRunsForTask } = await source('plugins/workflows/src/server/workflowRunReadModel.ts')
    dbFixture = makeTestPluginDb('workflows')
    const roots = 10, historyPerRoot = 100, tasksPerRoot = 20
    const defJson = JSON.stringify({ baseline: 'acorn-1', formatVersion: 1, name: 'Synthetic workflow', steps: [], padding: 'd'.repeat(8192) })
    const graphJson = JSON.stringify({ definitions: [], padding: 'g'.repeat(24576) })
    dbFixture.db.transaction(tx => {
      for (let root = 0; root < roots; root++) {
        const rootId = `root-${root}`
        tx.insert(schema.workflowRuns).values({ id: rootId, taskId: `${rootId}-task`, name: rootId, status: 'running', defJson, resolvedGraphJson: graphJson,
          rootRunId: rootId, parentRunId: null, depth: 0, createdAt: 1, updatedAt: 1 }).run()
        for (let i = 0; i < historyPerRoot; i++) tx.insert(schema.workflowRuns).values({
          id: `${rootId}-child-${i}`, taskId: `${rootId}-childtask-${i % tasksPerRoot}`, name: `child-${i}`, status: i >= 80 ? 'gated' : 'done',
          defJson, resolvedGraphJson: graphJson, rootRunId: rootId, parentRunId: rootId, depth: 1, createdAt: i + 2, updatedAt: i + 2,
        }).run()
      }
    })
    meter(dbFixture.db)
    const navigation = await measure('task-navigation', () => workflowTaskNavigation(dbFixture.db))
    const runList = await measure('node-run-list', async () => (await workflowRunList(dbFixture.db)).runs.length)
    const taskRead = await measure('one-child-task-history', async () => (await workflowRunsForTask(dbFixture.db, 'root-0-childtask-0')).length)
    const plan = dbFixture.db.$client.prepare('EXPLAIN QUERY PLAN SELECT * FROM workflow_runs WHERE parent_run_id IS NOT NULL OR trigger = ? ORDER BY updated_at DESC').all('reprocess')
    result = { roots, historicalChildren: roots * historyPerRoot, latestDescendantTasks: roots * tasksPerRoot,
      defJsonBytes: Buffer.byteLength(defJson), graphJsonBytes: Buffer.byteLength(graphJson), navigation, runList, taskRead, plan,
      expected: 'Task navigation selects compact scalar columns and latest child rows per task, never frozen execution bodies; projected groups remain exact.' }
  } else if (kind === 'processing') {
    const schema = await source('plugins/workflows/src/node/schema.ts')
    const { workflowSelectionPage } = await source('plugins/workflows/src/server/workflowProcessingReadModel.ts')
    dbFixture = makeTestPluginDb('workflows')
    const children = 300, stepsPerChild = 4
    const defJson = JSON.stringify({ baseline: 'acorn-1', formatVersion: 1, name: 'Synthetic workflow', steps: [], padding: 'd'.repeat(8192) })
    const graphJson = JSON.stringify({ definitions: [], padding: 'g'.repeat(24576) })
    dbFixture.db.transaction(tx => {
      tx.insert(schema.workflowSelections).values({ id: 'selection', invocationKey: 'fixture', fingerprint: 'fixture', runId: 'root', stepId: 'root-loop', scopeKey: 'fixture',
        snapshotJson: JSON.stringify({ source: { pluginId: 'fixture', sourceId: 'fixture' }, completeness: { kind: 'complete' } }), createdAt: 1 }).run()
      for (let i = 0; i < children; i++) {
        tx.insert(schema.workflowRuns).values({ id: `run-${i}`, taskId: `task-${i}`, name: `run-${i}`, status: i % 2 ? 'failed' : 'done', defJson, resolvedGraphJson: graphJson,
          rootRunId: 'root', parentRunId: 'root', depth: 1, createdAt: i + 1, updatedAt: i + 1 }).run()
        tx.insert(schema.workflowDispatches).values({ id: `dispatch-${i}`, callerKey: `caller-${i}`, payloadFingerprint: 'fixture', payloadJson: JSON.stringify({ task: { title: `Record ${i}` }, padding: 'p'.repeat(4096) }),
          parentTaskId: 'root-task', taskId: `task-${i}`, runId: `run-${i}`, rootRunId: 'root', parentRunId: 'root', parentStepId: 'root-loop', itemKey: `item-${i}`, state: 'terminal', createdAt: i + 1, updatedAt: i + 1 }).run()
        tx.insert(schema.workflowRecordAttempts).values({ id: `attempt-${i}`, stateId: `state-${i}`, selectionId: 'selection', dispatchId: `dispatch-${i}`, createdAt: i + 1 }).run()
        tx.insert(schema.workflowSelectedRecords).values({ id: `selected-${i}`, selectionId: 'selection', position: i, recordKey: `item-${i}`, snapshotJson: JSON.stringify({ display: { title: `Record ${i}` }, padding: 's'.repeat(4096) }), decision: 'admitted', attemptId: `attempt-${i}` }).run()
        for (let step = 0; step < stepsPerChild; step++) tx.insert(schema.workflowSteps).values({ id: `run-${i}-step-${step}`, runId: `run-${i}`, idx: step, name: `step-${step}`,
          kind: 'terminal:command', status: i % 2 && step === 3 ? 'failed' : 'done', structuredJson: JSON.stringify({ result: 'r'.repeat(8192) }), createdAt: i + 1, updatedAt: i + 1 }).run()
      }
    })
    meter(dbFixture.db)
    const pages = []
    for (const filter of ['all', 'failed']) pages.push(await measure(`first-50-${filter}`, () => {
      const result = workflowSelectionPage(dbFixture.db, 'root', 'selection', -1, 50, 'root-loop', filter)
      return { records: result.records.length, next: result.next, counts: result.counts, first: result.records[0]?.recordKey, last: result.records.at(-1)?.recordKey }
    }))
    result = { children, stepsPerChild, pages,
      expected: 'Exact global category counts remain authoritative; each 50-row page reads only its full detail snapshots and bounded result prefixes, rather than every child frozen graph and full output.' }
  } else throw new Error('Unknown case.')
  fs.writeFileSync(output, JSON.stringify({ case: kind, node: process.version, platform: process.platform, result }, null, 2) + '\n')
  console.log(JSON.stringify({ output, result }, null, 2))
} finally {
  dbFixture?.cleanup(); os.homedir = originalHome; fsp.readFile = originalRead; syncBuiltinESMExports()
  fs.rmSync(fixture, { recursive: true, force: true })
}
