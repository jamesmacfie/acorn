import type { RpcFunctionLifetime } from './rpcOwnership'

export type RpcFunction = (...args: never[]) => unknown
export type FunctionMode = (path: string, fn: RpcFunction) => 'sync' | 'async'
export type RpcScope = { id: number; functions: Set<number>; active: number; retired: boolean; sent: boolean }
export type FunctionEntry = { fn: RpcFunction; path: string; scope?: RpcScope; terminal: boolean; scopedResult: boolean; lifetime: RpcFunctionLifetime; claims: number; published: boolean }
export type WireFunction = { __acornRpc: 'function'; id: number; sync: boolean; scopeId?: number; terminal?: boolean } & RpcFunctionLifetime

/** Strong exports keep a live remote proxy callable. Only its explicit owner can retire it. */
export class RpcReferences {
  readonly functions = new Map<number, FunctionEntry>()
  readonly scopes = new Set<RpcScope>()
  readonly #identities = new WeakMap<RpcFunction, Map<string, number>>()
  readonly #bindings = new WeakMap<object, WeakMap<RpcFunction, RpcFunction>>()
  #nextFunctionId = 1
  #nextScopeId = 1
  #closed = false

  readonly mode: FunctionMode
  readonly release: (ids: number[]) => void

  constructor(mode: FunctionMode, release: (ids: number[]) => void) {
    this.mode = mode
    this.release = release
  }

  scope(): RpcScope {
    if (this.#closed) throw new Error('Plugin RPC endpoint has closed.')
    const scope = { id: this.#nextScopeId++, functions: new Set<number>(), active: 0, retired: false, sent: false }
    this.scopes.add(scope)
    return scope
  }

  bind(owner: object, fn: RpcFunction): RpcFunction {
    let methods = this.#bindings.get(owner)
    if (!methods) this.#bindings.set(owner, methods = new WeakMap())
    let bound = methods.get(fn)
    if (!bound) methods.set(fn, bound = fn.bind(owner))
    return bound
  }

  export(fn: RpcFunction, path: string, created: Set<number>, scope?: RpcScope, terminal = false, lifetime: RpcFunctionLifetime = {}, scopedResult = false): WireFunction {
    if (this.#closed) throw new Error('Plugin RPC endpoint has closed.')
    if (scope?.retired) throw new Error('Plugin RPC invocation has ended.')
    const sync = this.mode(path, fn) === 'sync'
    if (this.#closed) throw new Error('Plugin RPC endpoint has closed.')
    const key = `${scope?.id ?? 0}:${sync}:${terminal}:${scopedResult}:${lifetime.scopedArguments ?? false}:${lifetime.resultTerminal ?? ''}:${lifetime.persistentResult ?? false}`
    let identities = this.#identities.get(fn)
    if (!identities) this.#identities.set(fn, identities = new Map())
    let id = identities.get(key)
    if (id === undefined || !this.functions.has(id)) {
      id = this.#nextFunctionId++
      identities.set(key, id)
      this.functions.set(id, { fn, path, scope, terminal, scopedResult, lifetime, claims: 0, published: false })
      scope?.functions.add(id)
    }
    if (!created.has(id)) { created.add(id); this.functions.get(id)!.claims++ }
    return { __acornRpc: 'function', id, sync, ...(scope ? { scopeId: scope.id } : {}), ...lifetime, ...(terminal ? { terminal: true } : {}) }
  }

  enter(entry: FunctionEntry): () => void {
    const scope = entry.scope
    if (scope?.retired) throw new Error('Plugin RPC invocation has ended.')
    if (scope) scope.active++
    return () => {
      if (!scope) return
      scope.active--
      if (entry.terminal) scope.retired = true
      this.#collect(scope)
    }
  }

  retire(scope: RpcScope): void {
    scope.retired = true
    this.#collect(scope)
  }

  rollback(ids: Set<number>): void {
    for (const id of ids) {
      const entry = this.functions.get(id)
      if (!entry) continue
      entry.claims--
      if (!entry.published && !entry.claims) this.#remove([id])
    }
    ids.clear()
  }

  commit(ids: Set<number>): void {
    for (const id of ids) {
      const entry = this.functions.get(id)
      if (entry) { entry.published = true; entry.claims-- }
    }
    ids.clear()
  }

  close(): void {
    this.#closed = true
    for (const scope of this.scopes) { scope.retired = true; scope.functions.clear() }
    this.scopes.clear()
    this.functions.clear()
  }

  #collect(scope: RpcScope): void {
    if (!scope.retired || scope.active) return
    this.scopes.delete(scope)
    const ids = [...scope.functions]
    this.#remove(ids)
    // The peer retires argument scopes at its reply seam. Resource scopes need an explicit release.
    if (ids.length && !scope.sent) this.release(ids)
  }

  #remove(ids: number[]): void {
    for (const id of ids) {
      const entry = this.functions.get(id)
      if (!entry) continue
      this.functions.delete(id)
      entry.scope?.functions.delete(id)
      const identities = this.#identities.get(entry.fn)
      if (identities) for (const [key, candidate] of identities) if (candidate === id) identities.delete(key)
    }
  }
}
