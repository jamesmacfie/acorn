export type Concern = {
  id: string
  feature: string
  message: string
  severity: 'warn' | 'danger'
  // Up to five lines under the message — changed paths, container names. The host slices to
  // DETAILS_MAX and draws `detailsMore` as "+N more", so no producer has to invent that string.
  details?: string[]
  detailsMore?: number
  // Optional opt-in side action shown as a checkbox under the concern (e.g. docker's "also stop
  // its containers"). onDecision fires once, when the dialog resolves, with the user's choices.
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

// How long each kind's handlers get. Per-KIND rather than one number, because the budget is a
// property of what is being asked, not of the dialog: `app:quit` and `workspace:remove` are answered
// from state the client already holds, and 250ms is generous for reading a signal. `task:archive`
// waits on the node — one request that itself bounds every plugin check at two seconds
// (node-core/server/plugin/taskChecks.ts) — so it gets room for that round trip plus the slowest
// check, and no more.
//
// It lives here and not at the call sites deliberately: a caller opening a confirmation should not
// have to know what the handlers behind it cost.
const BUDGET_MS: Record<WillEventKind, number> = {
  'task:archive': 2_500,
  'workspace:remove': 250,
  'app:quit': 250,
}

const handlers = new Map<WillEventKind, RegisteredHandler[]>()

/**
 * A client-side concern producer.
 *
 * NOT the plugin seam any more. A plugin declares what it has to say about archiving a task on the
 * NODE, through `ctx.taskChecks` or a manifest `taskChecks` entry, because that is where the answer
 * lives and because a loaded plugin ships no client bundle to register from
 * (node-core/server/plugin/taskChecks.ts). What is left here is core's own use for the two events
 * that have no node meaning: the app is quitting, or a workspace is being removed.
 *
 * The caller owns the returned unregister function. That is the whole reason this is not a plugin
 * seam: the client plugin host records a disposable for every contribution it hands out, and a bare
 * call from `init` — which is what the docker plugin used to make — accumulated one more handler on
 * every re-activation, which is twice per boot and once per node switch.
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
    // `Promise.try`-shaped on purpose. `Promise.resolve(entry.run(...))` evaluates the call FIRST, so a
    // handler that threw synchronously threw out of this executor and rejected the whole fan-out —
    // one bad handler taking the dialog with it, which is the opposite of what the catch below is for.
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
 * One row per (feature, id).
 *
 * Belt to the disposal braces, not a substitute for them. Two identical rows is how a handler
 * registered twice presents, and it presented for real: the dialog drew docker's containers warning
 * twice, the two rows shared a checkbox because the state map is keyed on `id`, and confirming ran
 * the teardown twice. The braces are the host owning every plugin's disposable; this is so the next
 * one costs a cosmetic bug instead of a repeated side effect.
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
