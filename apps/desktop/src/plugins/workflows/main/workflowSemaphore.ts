export class Semaphore {
  #active = 0
  readonly #queue: (() => void)[] = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Semaphore limit must be a positive integer.')
  }

  async use<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    await this.acquire(signal)
    try {
      return await work()
    } finally {
      this.release()
    }
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
    if (this.#active < this.limit) {
      this.#active += 1
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener('abort', abort)
        this.#active += 1
        resolve()
      }
      const abort = () => {
        const index = this.#queue.indexOf(ready)
        if (index >= 0) this.#queue.splice(index, 1)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', abort, { once: true })
      this.#queue.push(ready)
    })
  }

  private release(): void {
    this.#active -= 1
    this.#queue.shift()?.()
  }
}
