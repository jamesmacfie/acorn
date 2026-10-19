import {
  createLibrary,
  createParser,
  createStore,
  createStreamingParser,
  defineComponent,
  evaluate,
  evaluateRoot,
  jsonToOpenUI,
  mergeStatements,
  parseStructuredRules,
  validate,
  type ElementNode,
  type EvaluationContext,
  type LibraryJSONSchema,
  type OpenUIError,
  type ParseResult,
} from '@openuidev/lang-core'
import { describe, expect, it } from 'vitest'
import { caseFiles, caseIds, json, propsOf, same, spec } from '../test/conformanceCases.ts'

// Level 1 of OpenUI's conformance cases: every case's program check, through lang-core alone. It follows
// OpenUI's reference runner (packages/lang-core/src/__tests__/conformance.test.ts at the copied commit),
// so a case reads the same way here as there.

type Dict = Record<string, unknown>

const schema = spec.schema as unknown as LibraryJSONSchema
const library = {
  ...createLibrary({
    components: Object.entries(spec.components).map(([name, { description }]) =>
      defineComponent({ name, description, props: propsOf(name), component: null }),
    ),
    root: spec.root,
  }),
  toJSONSchema: () => schema,
}
// library.json's one function has no implementation in the file, so the runner supplies it.
const functions = {
  Upper: { ...spec.schema.functions!.Upper, fn: ({ text }: Dict) => String(text ?? '').toUpperCase() },
}
const actionParams = Object.fromEntries(
  Object.entries(spec.schema.actions ?? {}).map(([name, action]) => [
    name,
    Object.keys(action.params.properties ?? {}),
  ]),
)

const parse = (text: string) => createParser(schema, spec.root).parse(text)

// ─── The summary of an evaluated tree (conformance/1.0/README.md, "How the tree is summarized") ───

type Evaluate = (ast: unknown) => unknown

function summarizeAction(step: Dict, ev: Evaluate): Dict {
  switch (step.type) {
    case 'continue_conversation':
      return { action: 'ToAssistant', args: step.context == null ? [step.message] : [step.message, step.context] }
    case 'open_url':
      return { action: 'OpenUrl', args: [step.url] }
    case 'set':
      return { action: 'Set', args: [step.target, ev(step.valueAST) ?? null] }
    case 'reset':
      return { action: 'Reset', args: step.targets }
    case 'run':
      return { action: 'Run', args: [step.statementId] }
    default: {
      const params = (step.params as Dict) ?? {}
      const keys = actionParams[step.name as string] ?? Object.keys(params)
      return { action: step.name, args: keys.map((k) => summarize(params[k], ev)) }
    }
  }
}

function summarize(value: unknown, ev: Evaluate): unknown {
  if (value == null || typeof value !== 'object') return value ?? null
  if (Array.isArray(value)) return value.map((v) => summarize(v, ev))
  const o = value as Dict
  if (o.type === 'element') {
    const props = Object.entries(o.props as Dict)
      .map(([k, v]) => [k, summarize(v, ev)])
      .filter(([, v]) => v !== null)
    return { type: o.typeName, props: Object.fromEntries(props) }
  }
  if (Array.isArray(o.steps)) return { actions: (o.steps as Dict[]).map((s) => summarizeAction(s, ev)) }
  if (o.__reactive === 'assign') return { $binding: o.target }
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, summarize(v, ev)]))
}

/** The canonical result at stream end, plus the evaluated tree for the roundtrip check. */
function evaluateResult(result: ParseResult) {
  const store = createStore()
  store.initialize(result.stateDeclarations ?? {}, {})
  // At stream end no fetch has returned: a query reads its defaults, and a mutation is idle.
  const ctx: EvaluationContext = {
    getState: (name) => store.get(name) ?? null,
    resolveRef: (name) => {
      const query = result.queryStatements.find((s) => s.statementId === name)
      if (query) return query.defaultsAST ? evaluate(query.defaultsAST, ctx) : null
      const mutation = result.mutationStatements.some((s) => s.statementId === name)
      return mutation ? { status: 'idle', data: null, error: null } : null
    },
    functions,
    actions: schema.actions,
  }
  const runtimeErrors: OpenUIError[] = []
  const tree = evaluateRoot(result, { ctx, library, store, errors: runtimeErrors })
  const errorObjects = [
    ...result.meta.errors.map((e) => ({ source: 'parser', ...e, path: e.path || undefined })),
    ...runtimeErrors,
  ]
  return {
    tree,
    root: summarize(tree, (ast) => evaluate(ast as never, ctx)),
    errors: errorObjects.map(({ code, statementId }) => ({ code, statementId })),
    errorObjects,
    unresolved: result.meta.unresolved,
    orphans: result.meta.orphaned,
    incomplete: result.meta.incomplete,
    state: json(result.stateDeclarations ?? {}),
  }
}

// ─── Comparison (conformance/1.0/README.md, "Comparison") ───

/** Each expected entry claims an actual entry that agrees on the keys it lists; fuller entries go first. */
function claims(expected: Dict[], actual: object[]): boolean {
  const pool = [...actual] as Dict[]
  return [...expected]
    .sort((a, b) => Object.keys(b).length - Object.keys(a).length)
    .every((e) => {
      const i = pool.findIndex((a) => Object.entries(e).every(([k, v]) => same(v, a[k] ?? null)))
      return i !== -1 && pool.splice(i, 1).length === 1
    })
}

const asSet = (xs: unknown) => (Array.isArray(xs) ? [...new Set(xs)].sort() : xs)
const COMPARE: Record<string, (want: unknown, got: unknown) => boolean> = {
  root: same,
  errors: (w, g) => (w as Dict[]).length === (g as Dict[]).length && claims(w as Dict[], g as Dict[]),
  unresolved: (w, g) => same(asSet(w), asSet(g)),
  orphans: (w, g) => same(asSet(w), asSet(g)),
  incomplete: same,
  state: same,
  statements: same,
  errorObjects: (w, g) => claims(w as Dict[], g as Dict[]),
}
const OPTIONAL = ['state', 'statements', 'errorObjects']

function check(id: string, expected: Dict, result: ParseResult, statements?: string[]): string[] {
  const actual: Dict = { ...evaluateResult(result), statements }
  const diffs = Object.entries(COMPARE)
    .filter(([key, ok]) => (key in expected || !OPTIONAL.includes(key)) && !ok(expected[key], actual[key]))
    .map(([key]) => `${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`)
  if (id.includes('-roundtrip-') && actual.tree) {
    const text = jsonToOpenUI(actual.tree as ElementNode, library)
    const again = evaluateResult(parse(text)).root
    if (!same(again, expected.root)) diffs.push(`roundtrip: ${JSON.stringify(text)} parses to ${JSON.stringify(again)}`)
  }
  return diffs
}

function runProgram(id: string, files: Record<string, string>): string[] {
  const expected = JSON.parse(files['expected.json']) as Dict
  if (files['chunks.json']) {
    const chunks = JSON.parse(files['chunks.json']) as string[]
    const parser = createStreamingParser(schema, spec.root)
    chunks.forEach((chunk, i) => parser.push(chunk, i === chunks.length - 1))
    return [
      ...check(id, expected, parser.getResult(true)).map((d) => `streamed ${d}`),
      ...check(id, expected, parse(chunks.join(''))).map((d) => `batch ${d}`),
    ]
  }
  const patch = files['patch.oui']
  if (patch === undefined) return check(id, expected, parse(files['input.oui']))
  const merged = mergeStatements(files['input.oui'], patch)
  const statements = merged.split('\n').flatMap((line) => /^(\$?\w+)\s*=(?!=)/.exec(line)?.[1] ?? [])
  return check(id, expected, parse(merged), statements)
}

function runValidation(files: Record<string, string>): string[] {
  const { cases } = JSON.parse(files['validation.json']) as {
    cases: { rules: unknown; value: unknown; valid: boolean }[]
  }
  return cases.flatMap(({ rules, value, valid }, i) => {
    const error = validate(value, parseStructuredRules(rules))
    return (error === undefined) === valid
      ? []
      : [`case ${i} ${JSON.stringify(rules)} ${JSON.stringify(value)}: got ${error}`]
  })
}

describe('OpenUI conformance, program cases', () => {
  const ids = caseIds()

  it('reads every copied case', () => {
    expect(ids.filter((id) => caseFiles(id)['expected.json'])).toHaveLength(58)
    expect(ids.filter((id) => caseFiles(id)['validation.json'])).toHaveLength(1)
  })

  for (const id of ids) {
    it(id, () => {
      const files = caseFiles(id)
      const diffs = files['validation.json'] ? runValidation(files) : runProgram(id, files)
      expect(diffs, id).toEqual([])
    })
  }
})
