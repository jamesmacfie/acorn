export type Concern = {
  id: string
  feature: string
  message: string
  severity: 'warn' | 'danger'
  // Optional opt-in side action shown as a checkbox under the concern (e.g. docker's "also stop
  // its containers"). onDecision fires once, when the dialog resolves, with the user's choices.
  checkbox?: { label: string; checked: boolean }
  onDecision?: (confirmed: boolean, checked: boolean) => void
}

export type WillEventMap = {
  'task:archive': { taskId: string }
  'workspace:remove': { workspaceId: string; name: string }
  'app:quit': Record<string, never>
}

type WillEventKind = keyof WillEventMap
type WillHandler<K extends WillEventKind> = (payload: WillEventMap[K]) => Concern | Concern[] | null | Promise<Concern | Concern[] | null>
type RegisteredHandler = { feature: string; run: (payload: never) => Concern | Concern[] | null | Promise<Concern | Concern[] | null> }

const handlers = new Map<WillEventKind, RegisteredHandler[]>()

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

export async function collectConcerns<K extends WillEventKind>(kind: K, payload: WillEventMap[K], timeoutMs = 250): Promise<Concern[]> {
  const collect = (entry: RegisteredHandler) => new Promise<Concern[]>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      console.warn(`[will:${kind}] dropped slow concern handler: ${entry.feature}`)
      resolve([])
    }, timeoutMs)
    Promise.resolve(entry.run(payload as never)).then((result) => {
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
  return (await Promise.all((handlers.get(kind) ?? []).map(collect))).flat()
}
