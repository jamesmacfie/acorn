export type Concern = {
  id: string
  feature: string
  message: string
  severity: 'warn' | 'danger'
  // Up to five lines under the message, capped at `DETAILS_MAX` (docs/plugins.md § Task checks): the
  // host draws `detailsMore` as "+N more", so no producer has to invent that string.
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

// How long each kind's handlers get, per kind rather than one number: the budget is a property of
// what is being asked, not of the dialog. `app:quit` and `workspace:remove` are answered from state
// the client already holds, so 250ms is generous for reading a signal. `task:archive` waits on the
// node, whose own check budget is docs/plugins.md § Task checks' two seconds plus the slowest check,
// so it gets room for that round trip and no more. It lives here rather than at the call sites: a
// caller opening a confirmation should not have to know what the handlers behind it cost.
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
 * Not the plugin seam any more (docs/plugins.md § Task checks, the `registerWillHandler` paragraph):
 * a plugin declares what it has to say about archiving a task on the node, through `ctx.taskChecks`
 * or a manifest `taskChecks` entry. What is left here is core's own use for the two events that have
 * no node meaning: the app quitting, or a workspace being removed.
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
      console.warn(`[will:${kind}] dropped slow concern handler: ${entry.feature}`)
      resolve([])
    }, timeoutMs)
    // `Promise.try`-shaped: `Promise.resolve(entry.run(...))` would evaluate the call first, so a
    // handler that threw synchronously would throw out of this executor and reject the whole fan-out,
    // one bad handler taking the dialog with it, which is the opposite of what the catch below is
    // for.
    new Promise<Concern | Concern[] | null>((ok) => ok(entry.run(payload as never))).then((result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result ? (Array.isArray(result) ? result : [result]) : [])
    }).catch((error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      console.error(`[will:${kind}] ${entry.feature}`, error)
      resolve([])
    })
  })
  return dedupe((await Promise.all((handlers.get(kind) ?? []).map(collect))).flat())
}

/**
/**
 * One row per (feature, id) (docs/plugins.md § Task checks, the `registerWillHandler` paragraph).
 *
 * Belt to the disposal braces, not a substitute for them: two identical rows is how a handler
 * registered twice presented for real, sharing a checkbox because the state map is keyed on `id` and
 * confirming ran the teardown twice.
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
