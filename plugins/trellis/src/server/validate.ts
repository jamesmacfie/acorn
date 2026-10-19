import {
  createParser,
  createStore,
  evaluate,
  evaluateRoot,
  parseExpression,
  split,
  tokenize,
  type ASTNode,
  type EvaluationContext,
  type OpenUIError,
} from '@openuidev/lang-core'
import { appLibrary, ROW_ACTION_TOOL, TASK_TOOL } from '../shared/library'

// The checks app_show runs before it publishes anything (docs/agent-built-apps.md § Validation). A
// failure lists every problem with its code, path, and a hint, and nothing is drawn.

export type AppProblem = { code: string; path: string; message: string; hint?: string }

const MAX_PROGRAM_BYTES = 64 * 1024
const QUERY_TOOLS = new Set([TASK_TOOL])
const MUTATION_TOOLS = new Set([ROW_ACTION_TOOL])

const library = appLibrary()
const schema = library.toJSONSchema()
const parser = createParser(schema)
const functions = Object.fromEntries(
  Object.entries(schema.functions ?? {}).flatMap(([name, spec]) => {
    const defined = library.functions[name]
    return defined ? [[name, { ...spec, fn: defined.fn }]] : []
  }),
)

function walk(node: ASTNode | null | undefined, visit: (node: ASTNode) => void) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const value of Object.values(node))
    if (Array.isArray(value)) value.forEach((item) => (Array.isArray(item) ? walk(item[1], visit) : walk(item, visit)))
    else if (value && typeof value === 'object' && 'k' in value) walk(value as ASTNode, visit)
}

/** Each statement's name and expression, for the checks that need the program as written. */
function statements(program: string): { id: string; ast: ASTNode | null }[] {
  return split(tokenize(program)).map((statement) => {
    try {
      return { id: statement.id, ast: parseExpression(statement.tokens) }
    } catch {
      return { id: statement.id, ast: null }
    }
  })
}

/** Checks 1 and 3 to 7. Check 2, the plans' own checks, needs the Node's data sources and runs in
 *  the caller. */
export function programProblems(
  program: string,
  planNames: readonly string[],
): { problems: AppProblem[]; warnings: AppProblem[] } {
  const problems: AppProblem[] = []
  const warnings: AppProblem[] = []
  const add = (code: string, path: string, message: string, hint?: string) =>
    problems.push({ code, path, message, ...(hint ? { hint } : {}) })

  if (new TextEncoder().encode(program).byteLength > MAX_PROGRAM_BYTES) {
    add('too-large', '/program', 'The program is over 64 KiB.', 'Move work into plans, or split the app.')
    return { problems, warnings }
  }

  const parsed = parser.parse(program)
  for (const error of parsed.meta.errors) {
    const path = `/program/${error.statementId ?? 'root'}${error.path}`
    if (error.severity === 'warning') warnings.push({ code: error.code, path, message: error.message })
    else add(error.code, path, error.message, 'See the component signatures in app_guide.')
  }
  if (!parsed.root && !parsed.rootExpression && !problems.some((problem) => problem.code === 'no-root'))
    add('no-root', '/program', 'The program draws nothing.', 'Write `root = …`.')

  const plans = new Set(planNames)
  const used = new Set<string>()
  for (const { id, ast } of statements(program)) {
    if (id === '$placement')
      add('reserved', `/program/${id}`, 'The host sets $placement.', 'Read $placement; never declare it.')
    walk(ast, (node) => {
      if (node.k === 'Comp' && (node.name === 'Set' || node.name === 'Reset')) {
        if (node.args.some((arg) => arg.k === 'StateRef' && arg.n === '$placement'))
          add('reserved', `/program/${id}`, 'The host sets $placement.', 'Read $placement; never set it.')
      }
      if (node.k === 'Assign' && node.target === '$placement')
        add('reserved', `/program/${id}`, 'The host sets $placement.', 'Read $placement; never bind it.')
      if (node.k !== 'Comp' || !['Query', 'Mutation', 'Panel'].includes(node.name)) return
      const target = node.args[0]
      if (target?.k !== 'Str') {
        add(
          'unknown-plan',
          `/program/${id}`,
          `${node.name} names its ${node.name === 'Mutation' ? 'tool' : 'plan'} with an expression.`,
          'Write the name as a string literal.',
        )
        return
      }
      if (node.name === 'Mutation') {
        if (!MUTATION_TOOLS.has(target.v))
          add('unknown-tool', `/program/${id}`, `No mutation tool is called ${target.v}.`, `Use "${ROW_ACTION_TOOL}".`)
        return
      }
      if (plans.has(target.v)) used.add(target.v)
      else if (node.name === 'Panel' || !QUERY_TOOLS.has(target.v))
        add(
          'unknown-plan',
          `/program/${id}`,
          `This app has no plan called ${target.v}.`,
          `Write plans/${target.v} with app_write, or use one of: ${[...plans].join(', ') || 'none yet'}.`,
        )
    })
  }
  for (const name of plans)
    if (!used.has(name))
      add(
        'unused-plan',
        `/plans/${name}`,
        `No Query or Panel reads the plan ${name}.`,
        'Use it, or delete it with app_write and content null.',
      )

  if (parsed.root?.typeName === 'Panel')
    add(
      'single-panel',
      '/program/root',
      'This program is one Panel and nothing else, which is a dashboard panel.',
      'Show the plan with panel_show instead.',
    )

  if (!problems.length) {
    // One evaluation against each query's defaults, the way the card first draws it.
    const store = createStore()
    store.initialize(parsed.stateDeclarations, { $placement: 'card' })
    const defaults = new Map<string, unknown>()
    const ctx: EvaluationContext = {
      getState: (name) => store.get(name),
      resolveRef: (name) => defaults.get(name),
      functions,
      actions: schema.actions,
    }
    for (const query of parsed.queryStatements)
      defaults.set(query.statementId, query.defaultsAST ? evaluate(query.defaultsAST, ctx) : null)
    const errors: OpenUIError[] = []
    evaluateRoot(parsed, { ctx, library, store, errors })
    for (const error of errors)
      if (error.code === 'runtime-error')
        add(
          error.code,
          `/program/${error.statementId ?? 'root'}`,
          error.message,
          'Guard values a query may not have yet.',
        )
  }
  return { problems, warnings }
}

// lang-core's messages end without a period, and the hint is its own sentence.
export const describeProblem = (problem: AppProblem) =>
  `${problem.code} ${problem.path}: ${problem.message.replace(/([^.!?])$/, '$1.')}${problem.hint ? ` ${problem.hint}` : ''}`
