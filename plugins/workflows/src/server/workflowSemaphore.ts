export class Semaphore {
  #active = 0
  readonly #queue: { ready: () => void; key?: string; limit: number }[] = []
  readonly #keys = new Map<string, number>()

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Semaphore limit must be a positive integer.')
  }

  async use<T>(signal: AbortSignal, work: () => Promise<T>, scope?: { key: string; limit: number }): Promise<T> {
    await this.acquire(signal, scope)
    try {
      return await work()
    } finally {
      this.release(scope?.key)
    }
  }

  private acquire(signal: AbortSignal, scope?: { key: string; limit: number }): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
    if (this.available(scope?.key, scope?.limit ?? this.limit)) {
      this.#active += 1
      if (scope) this.#keys.set(scope.key, (this.#keys.get(scope.key) ?? 0) + 1)
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener('abort', abort)
        this.#active += 1
        if (scope) this.#keys.set(scope.key, (this.#keys.get(scope.key) ?? 0) + 1)
        resolve()
      }
      const abort = () => {
        const index = this.#queue.findIndex(entry => entry.ready === ready)
        if (index >= 0) this.#queue.splice(index, 1)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', abort, { once: true })
      this.#queue.push({ ready, key: scope?.key, limit: scope?.limit ?? this.limit })
    })
  }

  private available(key: string | undefined, limit: number): boolean {
    return this.#active < this.limit && (key == null || (this.#keys.get(key) ?? 0) < limit)
  }

  private release(key?: string): void {
    this.#active -= 1
    if (key) {
      const active = (this.#keys.get(key) ?? 1) - 1
      if (active) this.#keys.set(key, active)
      else this.#keys.delete(key)
    }
    // Skip a saturated root without reserving a Node slot for its waiting work.
    for (let index = 0; index < this.#queue.length && this.#active < this.limit;) {
      const entry = this.#queue[index]!
      if (!this.available(entry.key, entry.limit)) { index += 1; continue }
      this.#queue.splice(index, 1)
      entry.ready()
    }
  }
}
