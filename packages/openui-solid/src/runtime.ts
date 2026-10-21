import {
  ACTION_STEPS,
  BuiltinActionType,
  ToolNotFoundError,
  createParser,
  createQueryManager,
  createStore,
  evaluate,
  evaluateRoot,
  extractToolResult,
  type ActionEvent,
  type ActionPlan,
  type ElementNode,
  type EvaluationContext,
  type Library,
  type McpClientLike,
  type OpenUIError,
  type ParseResult,
  type QuerySnapshot,
  type Store,
  type ToolProvider,
} from '@openuidev/lang-core'
import { createComputed, createMemo, createSignal, onCleanup, untrack, type Accessor, type Component } from 'solid-js'
import { createStore as createSolidStore, reconcile, unwrap } from 'solid-js/store'
import type { JSX } from 'solid-js'

/** What every component renderer receives. `props` is reactive: read it inside JSX or a memo. */
export type ComponentRenderProps<P = Record<string, unknown>> = {
  props: P
  renderNode: (value: unknown) => JSX.Element
  statementId?: string
}

export type ComponentRenderer<P = Record<string, unknown>> = Component<ComponentRenderProps<P>>

export type SolidLibrary = Library<ComponentRenderer<any>>

/** Async functions by tool name, or an MCP client. */
export type Tools = Record<string, (args: Record<string, unknown>) => Promise<unknown>> | McpClientLike

export type OpenUIRuntimeOptions = {
  /** The whole program text. A new value is parsed again; state the user set survives it. */
  program: Accessor<string>
  library: SolidLibrary
  tools?: Tools
  onAction?: (event: ActionEvent) => void
  /** `$name` keys seed `$` variables; other keys restore form state as stored. */
  initialState?: Record<string, unknown>
}

export type OpenUIRuntime = ReturnType<typeof createOpenUIRuntime>

// A form field is stored as `{ value, componentType }`; a `$` variable holds the plain value.
function fieldValue(stored: unknown): unknown {
  return stored && typeof stored === 'object' && !Array.isArray(stored) && 'value' in stored
    ? (stored as { value: unknown }).value
    : stored
}

function copyPlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyPlain) as T
  if (!value || typeof value !== 'object') return value
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copyPlain(v)])) as T
}

// A hidden window gets no animation frames, so a timer runs the work too, and whichever fires first
// cancels the other.
const FRAME_FALLBACK_MS = 50
function waitForFrame(run: () => void): () => void {
  const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : undefined
  const timer = setTimeout(run, FRAME_FALLBACK_MS)
  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    clearTimeout(timer)
  }
}

// How long typing pauses before a query whose arguments it changed runs again.
const QUERY_DELAY_MS = 250

function toolProvider(tools: Tools): ToolProvider {
  return {
    async callTool(name, args) {
      if (typeof (tools as McpClientLike).callTool === 'function') {
        return extractToolResult(await (tools as McpClientLike).callTool({ name, arguments: args }))
      }
      // Own names only, so a program naming `toString` or `constructor` finds no tool.
      const fn = Object.hasOwn(tools, name)
        ? (tools as Record<string, (a: Record<string, unknown>) => Promise<unknown>>)[name]
        : undefined
      if (!fn) throw new ToolNotFoundError(name, Object.keys(tools))
      return fn(args)
    },
  }
}

/**
 * Parses, evaluates, and runs one program under the current Solid owner, and disposes with it.
 *
 * The evaluated tree is reconciled into a Solid store by position, so a component keeps its
 * instance, and its focus, while the state it draws from changes.
 */
export function createOpenUIRuntime(options: OpenUIRuntimeOptions) {
  const { library } = options
  const schema = library.toJSONSchema()
  const parser = createParser(schema, library.root)
  const functions = Object.fromEntries(
    Object.entries(schema.functions ?? {}).flatMap(([name, spec]) => {
      const fn = library.functions?.[name]?.fn
      return fn ? [[name, { ...spec, fn }]] : []
    }),
  )

  const store: Store = createStore()
  const queries = createQueryManager(options.tools ? toolProvider(options.tools) : null)
  const [stateVersion, bumpState] = createSignal<void>(undefined, { equals: false })
  const [queryVersion, bumpQueries] = createSignal<void>(undefined, { equals: false })
  // The tree is evaluated once per animation frame, from whatever the store holds then. A field reads
  // its own value through `stateVersion`, so typing still draws at once.
  const [treeVersion, bumpTree] = createSignal<void>(undefined, { equals: false })
  let cancelFrame: (() => void) | undefined
  const evaluateSoon = () => {
    cancelFrame ??= waitForFrame(() => {
      cancelFrame?.()
      cancelFrame = undefined
      bumpTree()
    })
  }
  let queryTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    cancelFrame?.()
    clearTimeout(queryTimer)
  })
  onCleanup(
    store.subscribe(() => {
      bumpState()
      evaluateSoon()
      clearTimeout(queryTimer)
      queryTimer = setTimeout(runQueries, QUERY_DELAY_MS)
    }),
  )
  onCleanup(
    queries.subscribe(() => {
      bumpQueries()
      evaluateSoon()
    }),
  )
  queries.activate()
  onCleanup(() => {
    queries.dispose()
    store.dispose()
  })

  const parsed = createMemo<{ result: ParseResult | null; error: OpenUIError | null }>(() => {
    try {
      return { result: parser.parse(options.program()), error: null }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { result: null, error: { source: 'parser', code: 'parse-failed', message } }
    }
  })
  const result = () => parsed().result

  const ctx: EvaluationContext = {
    getState: (name) => fieldValue(store.get(name)),
    resolveRef: (name) => queries.getMutationResult(name) ?? queries.getResult(name),
    functions,
    actions: schema.actions,
  }

  // Seed once. Each later parse only adds the defaults of newly declared variables, so a program edit
  // keeps what the user set.
  let seeded: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(options.initialState ?? {})) {
    if (key.startsWith('$')) seeded[key] = value
    else store.set(key, value)
  }
  createComputed(() => {
    store.initialize(result()?.stateDeclarations ?? {}, seeded)
    seeded = {}
  })

  // Runs from a program change at once, and from a state change once typing has paused. An action that
  // sets state or runs a query runs it first, because `invalidate` reads the arguments this last saw.
  function runQueries() {
    clearTimeout(queryTimer)
    const statements = untrack(() => result()?.queryStatements ?? [])
    queries.evaluateQueries(
      statements.map((q) => ({
        statementId: q.statementId,
        toolName: q.toolAST ? String(evaluate(q.toolAST, ctx)) : '',
        args: q.argsAST ? evaluate(q.argsAST, ctx) : null,
        defaults: q.defaultsAST ? evaluate(q.defaultsAST, ctx) : null,
        refreshInterval: q.refreshAST ? (evaluate(q.refreshAST, ctx) as number) : undefined,
        deps: q.deps?.length ? Object.fromEntries(q.deps.map((name) => [name, store.get(name)])) : undefined,
        complete: q.complete,
      })),
    )
  }
  createComputed(() => {
    result()
    untrack(runQueries)
  })
  createComputed(() => {
    const statements = result()?.mutationStatements ?? []
    untrack(() =>
      queries.registerMutations(
        statements.map((m) => ({
          statementId: m.statementId,
          toolName: m.toolAST ? String(evaluate(m.toolAST, ctx)) : '',
        })),
      ),
    )
  })

  // `reconcile` adopts the objects it is given and later edits them in place. An evaluated tree shares
  // objects with the parser's result, so the store gets copies.
  const [tree, setTree] = createSolidStore<{ root: ElementNode | null }>({ root: null })
  const [evaluationErrors, setEvaluationErrors] = createSignal<OpenUIError[]>([])
  const [renderErrors, setRenderErrors] = createSignal<OpenUIError[]>([])
  createComputed(() => {
    treeVersion()
    const current = result()
    const errors: OpenUIError[] = []
    const root = current ? untrack(() => evaluateRoot(current, { ctx, library, store, errors })) : null
    setTree('root', reconcile(copyPlain(root), { merge: true, key: null }))
    setEvaluationErrors(errors)
  })

  /** Every problem with the program as it stands: parse, validation, evaluation, and query errors. */
  const errors = createMemo<OpenUIError[]>(() => {
    queryVersion()
    const { result: current, error } = parsed()
    const snapshot = queries.getSnapshot() as QuerySnapshot
    return [
      ...(error ? [error] : []),
      ...(current?.meta.errors ?? []).map((e): OpenUIError => ({ source: 'parser', ...e })),
      ...evaluationErrors(),
      ...renderErrors(),
      ...snapshot.__openui_errors,
    ]
  })

  function formPayload(formName?: string): Record<string, unknown> {
    const form = formName ? store.get(formName) : undefined
    return form && typeof form === 'object' && !Array.isArray(form) ? { [formName!]: form } : store.getSnapshot()
  }

  function getFieldValue(formName: string | undefined, name: string): unknown {
    if (!formName) return fieldValue(store.get(name))
    const form = store.get(formName)
    return form && typeof form === 'object' ? fieldValue((form as Record<string, unknown>)[name]) : undefined
  }

  function setFieldValue(
    formName: string | undefined,
    componentType: string | undefined,
    name: string,
    value: unknown,
  ) {
    const field = { value, componentType }
    if (!formName) return store.set(name, field)
    const form = store.get(formName)
    store.set(formName, { ...(form && typeof form === 'object' ? form : {}), [name]: field })
  }

  function emit(event: Omit<ActionEvent, 'formState' | 'formName'>, formName?: string) {
    options.onAction?.({ ...event, formState: formPayload(formName), formName })
  }

  /** Runs a button's action steps in order, and stops at a mutation that fails. No action sends the label. */
  async function triggerAction(label: string, formName?: string, action?: ActionPlan | null) {
    const plan = unwrap(action)
    if (!plan?.steps) {
      return emit({ type: BuiltinActionType.ContinueConversation, params: {}, humanFriendlyMessage: label }, formName)
    }
    for (const step of plan.steps) {
      switch (step.type) {
        case ACTION_STEPS.Run: {
          if (step.refType !== 'mutation') {
            runQueries()
            queries.invalidate([step.statementId])
            break
          }
          const mutation = result()?.mutationStatements.find((m) => m.statementId === step.statementId)
          const args = mutation?.argsAST ? (evaluate(mutation.argsAST, ctx) as Record<string, unknown>) : {}
          if (!(await queries.fireMutation(step.statementId, args))) return
          break
        }
        case ACTION_STEPS.ToAssistant:
          emit(
            {
              type: BuiltinActionType.ContinueConversation,
              params: step.context !== undefined ? { context: step.context } : {},
              humanFriendlyMessage: step.message,
            },
            formName,
          )
          break
        case ACTION_STEPS.OpenUrl:
          emit({ type: BuiltinActionType.OpenUrl, params: { url: step.url }, humanFriendlyMessage: '' }, formName)
          break
        case 'custom_action':
          emit({ type: step.name, params: step.params, humanFriendlyMessage: '' }, formName)
          break
        case ACTION_STEPS.Set:
          if (step.valueAST) store.set(step.target, evaluate(step.valueAST, ctx))
          runQueries()
          break
        case ACTION_STEPS.Reset: {
          const declared = result()?.stateDeclarations ?? {}
          for (const target of step.targets) store.set(target, declared[target] ?? null, { pristine: true })
          runQueries()
          break
        }
      }
    }
  }

  return {
    library,
    /** The evaluated root, as a store whose nodes keep their identity across evaluations. */
    root: () => tree.root,
    errors,
    isQueryLoading: () => (queryVersion(), queries.isAnyLoading()),
    /** Reads a `$` variable, or a page-level field, as a signal. */
    state: (name: string) => (stateVersion(), fieldValue(store.get(name))),
    setState: (name: string, value: unknown) => store.set(name, value),
    /** Everything the store holds, for a host that saves an app's state. */
    snapshot: () => (stateVersion(), store.getSnapshot()),
    store,
    evaluationContext: ctx,
    /** Records a component that failed to draw. The renderer calls it from each component's boundary. */
    reportRenderError(component: string, error: unknown) {
      const message = `${component} failed to draw: ${error instanceof Error ? error.message : String(error)}`
      setRenderErrors((all) => [...all, { source: 'runtime', code: 'render-error', component, message }])
    },
    triggerAction,
    /** Runs the program's queries again: every one, or only those calling the named tools. */
    refresh(tools?: readonly string[]) {
      const statements = untrack(() => result()?.queryStatements ?? [])
      const ids = statements
        .filter((q) => !tools || (q.toolAST && tools.includes(String(untrack(() => evaluate(q.toolAST!, ctx))))))
        .map((q) => q.statementId)
      // An empty list would make lang-core run every query.
      if (ids.length) queries.invalidate(ids)
    },
    getFieldValue,
    setFieldValue,
  }
}
