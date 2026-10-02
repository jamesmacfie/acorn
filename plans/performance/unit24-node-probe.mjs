// Run: rtk proxy node --expose-gc --import tsx plans/performance/unit24-node-probe.mjs <workflow|processing> [tag] [baseline-commit]
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const kind = process.argv[2] ?? 'workflow'
const tag = process.argv[3] ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe output tag.')
const output = resolve(`plans/performance/unit24-${kind}-${tag}.json`)
if (tag.startsWith('before') && fs.existsSync(output)) throw new Error('Before evidence is immutable.')
const fixture = fs.mkdtempSync(join(os.tmpdir(), 'acorn-perf24-'))
const baselineCommit = process.argv[4]
if (baselineCommit && !/^[a-f0-9]{40}$/.test(baselineCommit)) throw new Error('Use a full baseline commit hash.')
const owners = new Set([
  'plugins/workflows/src/server/runs/read/projection.ts',
  'plugins/workflows/src/server/runs/read/readModel.ts',
  'plugins/workflows/src/server/processing/readModel.ts',
])
const hashes = {}
const source = async path => {
  let target = resolve(path)
  if (owners.has(path)) {
    const body = baselineCommit ? execFileSync('git', ['show', `${baselineCommit}:${path}`], { encoding: 'utf8' }) : fs.readFileSync(target, 'utf8')
    hashes[path] = createHash('sha256').update(body).digest('hex')
    if (baselineCommit) {
      const require = createRequire(pathToFileURL(target))
      const rewritten = body.replace(/from\s+(['"])([^'"]+)\1/g, (_, quote, specifier) => `from ${quote}${specifier.startsWith('.') ? resolve(dirname(target), specifier) : require.resolve(specifier)}${quote}`)
      target = join(fixture, path.replaceAll('/', '-'))
      fs.writeFileSync(target, rewritten)
    }
  }
  return import(pathToFileURL(target).href)
}
const { makeTestPluginDb } = await source('packages/node-core/src/testkit/db.ts')
let dbFixture
let statements = [], selectedCellsBytes = 0, selectedBinaryBytes = 0, selectedRows = 0
const meter = db => {
  const client = db.$client, original = client.prepare.bind(client)
  client.prepare = query => {
    const stmt = original(query)
    if (/^EXPLAIN/i.test(query)) return stmt
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
            else if (cell instanceof Uint8Array) selectedBinaryBytes += cell.byteLength
          }
        }
        return value
      }
    }
    return stmt
  }
}
const measure = async (name, work) => {
  statements = []; selectedRows = 0; selectedCellsBytes = 0; selectedBinaryBytes = 0
  const cpu = process.cpuUsage(), start = performance.now()
  const answer = await work()
  const used = process.cpuUsage(cpu)
  const wallMs = performance.now() - start
  const plans = statements.filter(query => /^select/i.test(query.trim())).map(query => ({ query, plan: dbFixture.db.$client.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...Array.from(query.matchAll(/\?/g), () => 'fixture')) }))
  return { plans, name, wallMs, cpuMs: (used.user + used.system) / 1000,
    sqlStatements: statements.length, sqlVerbs: statements.reduce((all, s) => {
      const key = s.trim().split(/\s/)[0].toUpperCase(); all[key] = (all[key] ?? 0) + 1; return all
    }, {}), selectedRows, selectedStringBytes: selectedCellsBytes, selectedBinaryBytes, selectedValueBytes: selectedCellsBytes + selectedBinaryBytes, answer }
}
let result
try {
  if (kind === 'workflow') {
    const schema = await source('plugins/workflows/src/node/schema.ts')
    const { workflowTaskNavigation, workflowRunList } = await source('plugins/workflows/src/server/runs/read/projection.ts')
    const { workflowRunsForTask } = await source('plugins/workflows/src/server/runs/read/readModel.ts')
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
    const runList = await measure('node-run-list', () => workflowRunList(dbFixture.db))
    const taskRead = await measure('one-child-task-history', () => workflowRunsForTask(dbFixture.db, 'root-0-childtask-0'))
    result = { roots, historicalChildren: roots * historyPerRoot, latestDescendantTasks: roots * tasksPerRoot,
      defJsonBytes: Buffer.byteLength(defJson), graphJsonBytes: Buffer.byteLength(graphJson), navigation, runList, taskRead,
      expected: 'Task navigation selects compact scalar columns and groups latest child rows per task, never frozen execution bodies; projected groups remain exact.' }
  } else if (kind === 'processing') {
    const schema = await source('plugins/workflows/src/node/schema.ts')
    const { workflowSelectionPage, workflowRecordSnapshot, workflowRecordAttemptPage } = await source('plugins/workflows/src/server/processing/readModel.ts')
    dbFixture = makeTestPluginDb('workflows')
    const children = 300, stepsPerChild = 4
    const defJson = JSON.stringify({ baseline: 'acorn-1', formatVersion: 1, name: 'Synthetic workflow',
      steps: Array.from({ length: 4 }, (_, idx) => ({ id: `step-${idx}`, name: `Step ${idx}` })),
      outputs: [{ name: 'summary', schema: { type: 'string' }, binding: { address: { from: 'step', stepId: 'step-3', pointer: '/result' } } }],
      padding: 'd'.repeat(8192) })
    const graphJson = JSON.stringify({ definitions: [], padding: 'g'.repeat(24576) })
    dbFixture.db.transaction(tx => {
      tx.insert(schema.workflowSelections).values({ id: 'selection', invocationKey: 'fixture', fingerprint: 'fixture', runId: 'root', stepId: 'root-loop', scopeKey: 'fixture',
        snapshotJson: JSON.stringify({ source: { pluginId: 'fixture', sourceId: 'fixture' }, completeness: { kind: 'complete' } }), createdAt: 1 }).run()
      for (let i = 0; i < children; i++) {
        tx.insert(schema.workflowRuns).values({ id: `run-${i}`, taskId: `task-${i}`, name: `run-${i}`, status: i % 2 ? 'failed' : 'done', defJson, resolvedGraphJson: graphJson,
          rootRunId: 'root', parentRunId: 'root', depth: 1, createdAt: i + 1, updatedAt: i + 1 }).run()
        tx.insert(schema.workflowDispatches).values({ id: `dispatch-${i}`, callerKey: `caller-${i}`, payloadFingerprint: 'fixture', payloadJson: JSON.stringify({ task: { title: `Record ${i}` }, padding: 'p'.repeat(4096) }),
          parentTaskId: 'root-task', taskId: `task-${i}`, runId: `run-${i}`, rootRunId: 'root', parentRunId: 'root', parentStepId: 'root-loop', itemKey: `item-${i}`, state: 'terminal', createdAt: i + 1, updatedAt: i + 1 }).run()
        tx.insert(schema.workflowRecordStates).values({ id: `state-${i}`, scopeKey: 'fixture', recordKey: `item-${i}`, snapshotJson: '{}', fieldsJson: '[]', projection: '{}', attemptId: `attempt-${i}`, updatedAt: i + 1 }).run()
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
      return result
    }))
    for (const [filter, after] of [['all', 49], ['failed', 99], ['attention', -1]]) {
      pages.push(await measure(`later-${filter}-${after}`, () => workflowSelectionPage(dbFixture.db, 'root', 'selection', after, 50, 'root-loop', filter)))
    }
    const snapshot = await measure('full-snapshot-and-named-outputs', () => workflowRecordSnapshot(dbFixture.db, 'root', 'selected-1'))
    const attempts = await measure('full-attempt-history', () => workflowRecordAttemptPage(dbFixture.db, 'root', 'selected-1'))
    result = { children, stepsPerChild, pages, snapshot, attempts,
      expected: 'Exact global category counts remain authoritative; each 50-row page reads only its full detail snapshots and bounded result prefixes, rather than every child frozen graph and full output.' }
  } else throw new Error('Unknown case.')
  hashes.probe = createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex')
  fs.writeFileSync(output, JSON.stringify({ hashes, baselineCommit, case: kind, node: process.version, platform: process.platform, result }, null, 2) + '\n')
  console.log(JSON.stringify({ output, metrics: kind === 'workflow' ? [result.navigation, result.runList, result.taskRead].map(({ answer: _answer, plans: _plans, ...metric }) => metric) : [...result.pages, result.snapshot, result.attempts].map(({ answer: _answer, plans: _plans, ...metric }) => metric) }, null, 2))
} finally {
  dbFixture?.cleanup()
  fs.rmSync(fixture, { recursive: true, force: true })
}
