import { describe, expect, it, vi } from 'vitest'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import type { StepHandlerContext, StepValidationContext, WorkflowStepDef } from '@acorn/plugin-workflows/contract/extensions.ts'
import { MAX_QUERY_ROWS, readOnlyRefusal, type DatabaseQuery } from '../contract/query'
import type { DatabaseBridge } from './database'
import { databaseQuery, generateStep, MAX_QUERY_BYTES, queryStep } from './workflowSteps'

// The bridge is faked: what these two steps add on top of it is the cap, the size refusal and the
// read-only rule, and none of that needs a Postgres.

const resultSet = (rows: (string | null)[][]) => ({ columns: ['id'], rows, rowCount: rows.length, command: 'SELECT', ms: 1 })

const bridge = (over: Partial<DatabaseBridge> = {}): DatabaseBridge => ({
  connect: async () => ({ ok: true, database: 'app' }),
  query: async () => resultSet([['1']]),
  schema: async () => ({ schema: 'create table orders (id int)', source: 'introspection' }),
  ...over,
} as DatabaseBridge)

const core = (over: Record<string, unknown> = {}) => ({
  tasks: { load: async () => ({ id: 'task1', projectId: 'p1' }) },
  projects: { byId: async () => ({ id: 'p1' }) },
  identity: { active: () => 'james' },
  models: { generateText: async () => ({ text: 'select 1', providerId: 'anthropic', modelId: 'm' }) },
  ...over,
} as unknown as Pick<CoreServices, 'tasks' | 'projects' | 'models' | 'identity'>)

const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } as unknown as PluginDatabase

const services = (over: Partial<{ bridge: DatabaseBridge; core: ReturnType<typeof core>; db: PluginDatabase; query: DatabaseQuery }> = {}) => {
  const resolved = { db, core: core(), bridge: bridge(), ...over }
  return { ...resolved, query: over.query ?? databaseQuery(resolved.bridge) }
}

const validationContext: StepValidationContext = {
  label: "step 'rows'",
  index: 0,
  indexes: new Map([['rows', 0]]),
  stepAt: () => undefined,
  policies: new Set(),
  after: () => [],
  precedes: () => false,
}

const step = (kind: string, withTable: Record<string, unknown>): WorkflowStepDef => ({ name: 'rows', kind, with: withTable })

const context = (definition: WorkflowStepDef) => ({
  run: { id: 'run1', taskId: 'task1' },
  step: { id: 'step1' },
  def: definition,
  renderedPrompt: '',
  tools: {},
  budget: {},
  signal: new AbortController().signal,
  inputs: {},
  upstream: [],
  emit: () => {},
} as unknown as StepHandlerContext)

describe('the read-only rule', () => {
  it('lets a read through and names what a write was', () => {
    expect(readOnlyRefusal('select 1')).toBeNull()
    expect(readOnlyRefusal('-- a note\n with x as (select 1) select * from x')).toBeNull()
    expect(readOnlyRefusal('delete from orders')).toContain('writes')
    // A second statement smuggled after a read, and a data-modifying CTE, are both writes.
    expect(readOnlyRefusal('select 1; drop table orders')).toContain('writes')
    expect(readOnlyRefusal('with gone as (delete from orders returning id) select * from gone')).toContain('writes')
  })
})

describe('the database:query step', () => {
  const validate = queryStep(services()).validate!

  it('needs exactly one of a saved query and inline SQL', () => {
    expect(validate(step('database:query', {}), validationContext)).toEqual(["step 'rows' needs either a saved query or inline SQL"])
    expect(validate(step('database:query', { sql: 'select 1', savedQueryId: 'q1' }), validationContext))
      .toEqual(["step 'rows' sets both a saved query and inline SQL; keep one"])
    expect(validate(step('database:query', { sql: 'select 1' }), validationContext)).toEqual([])
  })

  it('caps the rows and says it did', async () => {
    const many = Array.from({ length: MAX_QUERY_ROWS + 5 }, (_, index) => [String(index)])
    const outcome = await queryStep(services({ bridge: bridge({ query: async () => resultSet(many) }) })).handler(context(step('database:query', { sql: 'select id from orders' })))
    expect(outcome).toMatchObject({ status: 'done', structured: { truncated: true } })
    expect((outcome as { structured: { rows: unknown[] } }).structured.rows).toHaveLength(MAX_QUERY_ROWS)
  })

  it('refuses a result too big to put in a prompt', async () => {
    const wide = [[('x').repeat(MAX_QUERY_BYTES + 1)]]
    const outcome = await queryStep(services({ bridge: bridge({ query: async () => resultSet(wide) }) })).handler(context(step('database:query', { sql: 'select body from posts' })))
    expect(outcome).toMatchObject({ status: 'failed' })
    expect((outcome as { error: string }).error).toContain('over the 256 KB')
  })

  it('refuses a write before it reaches the database', async () => {
    const query = vi.fn(async () => resultSet([]))
    const outcome = await queryStep(services({ bridge: bridge({ query }) })).handler(context(step('database:query', { sql: 'update orders set paid = true' })))
    expect(outcome).toMatchObject({ status: 'failed' })
    expect((outcome as { error: string }).error).toContain('only reads')
    expect(query).not.toHaveBeenCalled()
  })

  it('says so when the saved query is not this project’s', async () => {
    const outcome = await queryStep(services()).handler(context(step('database:query', { savedQueryId: 'q1' })))
    expect(outcome).toMatchObject({ status: 'failed', error: "This project has no saved query 'q1'." })
  })
})

describe('the database:generate step', () => {
  it('needs something to ask for and a connection', () => {
    const validate = generateStep(services()).validate!
    expect(validate(step('database:generate', {}), validationContext))
      .toEqual(["step 'rows' has nothing to ask for", "step 'rows' names no model connection"])
  })

  it('runs the SQL it generated and carries it in the output', async () => {
    const generateText = vi.fn(async () => ({ text: '```sql\nselect id from orders\n```', providerId: 'anthropic', modelId: 'm' }))
    const outcome = await generateStep(services({ core: core({ models: { generateText } }) }))
      .handler(context(step('database:generate', { prompt: 'every order', connectionId: 'c1' })))
    expect(outcome).toMatchObject({ status: 'done', structured: { sql: 'select id from orders', rowCount: 1 } })
  })

  it('fails with the SQL in hand when the model wrote a write', async () => {
    const generateText = vi.fn(async () => ({ text: 'delete from orders', providerId: 'anthropic', modelId: 'm' }))
    const outcome = await generateStep(services({ core: core({ models: { generateText } }) }))
      .handler(context(step('database:generate', { prompt: 'clear the orders', connectionId: 'c1' })))
    expect(outcome).toMatchObject({ status: 'failed', structured: { sql: 'delete from orders' } })
    expect((outcome as { error: string }).error).toContain('delete from orders')
  })
})
