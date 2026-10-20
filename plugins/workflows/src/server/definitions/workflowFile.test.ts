import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'
import { writeWorkflowToml } from './toml'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { WORKFLOW_FILE_LOADER_ONLY, WORKFLOW_FILE_TABLES, type WorkflowFileTable } from '../../contract/workflowFile'

const literal = { address: { from: 'literal', value: 'x' } }

// A definition that sets every field the writer knows, so the file it writes holds every key.
const everything: WorkflowDef = {
  baseline: 'acorn-1',
  formatVersion: 1,
  name: 'Everything',
  posture: 'autonomous',
  maxDescendants: 10,
  maxConcurrency: 2,
  tools: { allow: ['read_file'], maxRisk: 'write' },
  budget: { maxWallTimeMs: 1, maxCostUsd: 1, maxInputTokens: 1, maxOutputTokens: 1, maxTurns: 1 },
  inputs: [
    { name: 'plain', label: 'Plain', description: 'A plain input.', required: true, default: 'x' },
    {
      name: 'typed',
      schema: { type: 'string' },
      default: 'x',
      connection: { source: { pluginId: 'p', sourceId: 's' } },
    },
  ] as unknown as WorkflowDef['inputs'],
  outputs: [{ name: 'out', schema: { type: 'string' }, binding: literal }] as unknown as WorkflowDef['outputs'],
  steps: [
    {
      id: 'a',
      name: 'A',
      kind: 'agent',
      after: [],
      isolation: 'worktree',
      inputs: 'template',
      configOptions: { reasoning: 'high' },
      profileId: 'codex',
      model: 'm',
      prompt: 'Do it.',
      goal: 'Done.',
      schema: { type: 'object' },
      requiresRun: 'web',
      policy: 'github:ci-settled',
      intervalMs: 1,
      timeoutMs: 1,
      maxIterations: 1,
      checksTimeoutMs: 1,
      branches: { pass: 'b' },
      query: { source: 'x' },
      incremental: true,
      record: literal,
      projection: ['/a'],
      condition: { op: 'exists' },
      dataset: { id: 'd', version: 1, rows: literal },
      repeat: { mode: 'changed', fields: ['/a'] },
      tools: { maxRisk: 'read' },
      budget: { maxTurns: 1 },
      with: { setting: 'x' },
      form: { fields: [{ name: 'f', schema: { type: 'string' } }], values: { f: literal } },
    } as unknown as WorkflowDef['steps'][number],
    {
      id: 'b',
      name: 'B',
      kind: 'workflow-map',
      agent: {
        prompt: 'Each.',
        goal: 'Done.',
        profileId: 'codex',
        model: 'm',
        configOptions: { reasoning: 'high' },
        schema: { type: 'object' },
        onFailure: 'stop',
      },
      childWorkflow: { ref: { source: 'repo', path: '.acorn/workflows/x.toml' }, inputs: { i: literal } },
      items: { step: 'a', pointer: '/list' },
      itemKey: '/id',
      title: { template: 'T ${n}', bindings: { n: literal } },
    } as unknown as WorkflowDef['steps'][number],
    {
      id: 'c',
      name: 'C',
      kind: 'workflow',
      childWorkflow: { ref: { source: 'database', id: 'w' } },
    },
  ],
}

// Every table's place in the file, including the places it appears again.
const tables = new Map<string, WorkflowFileTable>(
  WORKFLOW_FILE_TABLES.flatMap((table) => [table.path, ...(table.alsoAt ?? [])].map((path) => [path, table] as const)),
)
const join = (path: string, key: string) => (path ? `${path}.${key}` : key)

/** Every key path in a written file, as `steps[].agent.prompt`. A field whose table isn't described
 *  further, such as `with` or `branches`, is one key: its own keys are the author's. */
function keyPaths(value: Record<string, unknown>, path = ''): string[] {
  return Object.entries(value).flatMap(([key, item]) => {
    const at = join(path, key)
    const below = Array.isArray(item) ? `${at}[]` : at
    if (!tables.has(below)) return [at]
    const rows = Array.isArray(item) ? item : [item]
    return [at, ...rows.flatMap((row) => keyPaths(row as Record<string, unknown>, below))]
  })
}

/** Every key path the table describes, in the same form. */
const describedPaths = () => [...tables].flatMap(([path, table]) => table.fields.map((field) => join(path, field.key)))

describe('the workflow file field reference', () => {
  it('describes every key the writer writes, and nothing else', () => {
    const written = [...new Set(keyPaths(parse(writeWorkflowToml(everything))))]
    const described = describedPaths()
    expect(written.filter((path) => !described.includes(path))).toEqual([])
    // A table that appears in two places needs each of its keys written in one of them.
    const unwritten = WORKFLOW_FILE_TABLES.flatMap((table) =>
      table.fields
        .map((field) => [table.path, ...(table.alsoAt ?? [])].map((path) => join(path, field.key)))
        .filter((paths) => !paths.some((path) => written.includes(path) || WORKFLOW_FILE_LOADER_ONLY.includes(path)))
        .map(([path]) => path),
    )
    expect(unwritten).toEqual([])
  })

  it('gives every field a type and a description', () => {
    for (const table of WORKFLOW_FILE_TABLES)
      for (const field of table.fields) {
        expect(field.type, `${table.path}.${field.key}`).not.toBe('')
        expect(field.description.length, `${table.path}.${field.key}`).toBeGreaterThan(10)
      }
  })
})
