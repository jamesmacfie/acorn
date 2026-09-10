import { createLogger } from '../../../infra/telemetry/logger'

const log = createLogger('will')
export type Concern = {
  id: string
  feature: string
  message: string
  severity: 'warn' | 'danger'
  // Up to five lines under the message, capped at `DETAILS_MAX` (docs/plugins.md § Task checks). The
  // host draws `detailsMore` as "+N more", so no producer invents that string.
  details?: string[]
  detailsMore?: number
  // Optional opt-in side action shown as a checkbox under the concern, such as docker's "also stop
  // its containers" (docs/plugins.md § Task checks). `onDecision` fires once, when the dialog
  // resolves, with the user's choices.
  checkbox?: { label: string; checked: boolean }
  onDecision?: (confirmed: boolean, checked: boolean) => void
}

/** What the dialog will draw before it starts counting. */
export const DETAILS_MAX = 5

export type WillEventMap = {
  'task:archive': { taskId: string }
  'workspace:remove': { workspaceId: string; name: string }
  'app:quit': Record<string, never>
}

type WillEventKind = keyof WillEventMap
type WillHandler<K extends WillEventKind> = (payload: WillEventMap[K]) => Concern | Concern[] | null | Promise<Concern | Concern[] | null>
type RegisteredHandler = { feature: string; run: (payload: never) => Concern | Concern[] | null | Promise<Concern | Concern[] | null> }

// How long each kind's handlers get. Per kind, because the budget is a property of what is being
// asked. `app:quit` and `workspace:remove` are answered from state the client holds, so 250ms is
// generous for reading a signal. `task:archive` waits on the node, whose own check budget is two
// seconds plus the slowest check (docs/plugins.md § Task checks), so it gets room for that round trip.
// It lives here so a caller opening a confirmation need not know what the handlers cost.
const BUDGET_MS: Record<WillEventKind, number> = {
  'task:archive': 2_500,
  'workspace:remove': 250,
  'app:quit': 250,
}

const handlers = new Map<WillEventKind, RegisteredHandler[]>()

/**
/**
 * A client-side concern producer.
 *
 * Not the plugin seam (docs/plugins.md § Task checks, the `registerWillHandler` paragraph). A plugin
 * says what it has to about archiving a task on the node, through `ctx.taskChecks` or a manifest
 * `taskChecks` entry. What is left here is core's use for the two events with no node meaning: the app
 * quitting, and a workspace being removed.
 */
export function registerWillHandler<K extends WillEventKind>(kind: K, feature: string, handler: WillHandler<K>): () => void {
  const entry: RegisteredHandler = { feature, run: handler as RegisteredHandler['run'] }
  const list = handlers.get(kind) ?? []
  list.push(entry)
  handlers.set(kind, list)
  return () => {
    const current = handlers.get(kind)
    if (current) handlers.set(kind, current.filter((candidate) => candidate !== entry))
  }
}

export async function collectConcerns<K extends WillEventKind>(kind: K, payload: WillEventMap[K], timeoutMs = BUDGET_MS[kind]): Promise<Concern[]> {
  const collect = (entry: RegisteredHandler) => new Promise<Concern[]>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      log.warn(`${kind}: dropped slow concern handler ${entry.feature}`, undefined, { 'will.kind': kind, 'will.feature': entry.feature })
      resolve([])
    }, timeoutMs)
    // `Promise.try`-shaped. `Promise.resolve(entry.run(...))` evaluates the call first, so a handler
    // that throws synchronously throws out of this executor and rejects the whole fan-out.
    new Promise<Concern | Concern[] | null>((ok) => ok(entry.run(payload as never))).then((result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result ? (Array.isArray(result) ? result : [result]) : [])
    }).catch((error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      log.error(`${kind}: ${entry.feature}`, error, { 'will.kind': kind, 'will.feature': entry.feature })
      resolve([])
    })
  })
  return dedupe((await Promise.all((handlers.get(kind) ?? []).map(collect))).flat())
}

/**
/**
 * One row per (feature, id) (docs/plugins.md § Task checks, the `registerWillHandler` paragraph).
 *
 * Belt to the disposal braces, not a substitute. A handler registered twice showed two identical rows
 * sharing one checkbox, because the state map is keyed on `id`, and confirming ran the teardown twice.
 */
const dedupe = (concerns: readonly Concern[]): Concern[] => {
  const seen = new Set<string>()
  return concerns.filter((concern) => {
    const key = `${concern.feature}:${concern.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
