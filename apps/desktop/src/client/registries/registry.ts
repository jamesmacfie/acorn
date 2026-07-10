import { createSignal, type Accessor } from 'solid-js'

export type Disposable = { dispose(): void }

type Identified = { id: string }

// Small process-local registry used by the client extension seams. Registration is synchronous
// and side-effect free apart from publishing the new descriptor list; feature activation owns any
// real work. A duplicate id is a programming error because silently replacing a contribution would
// make activation order observable.
export class Registry<T extends Identified> {
  readonly #entries: Accessor<readonly T[]>
  readonly #setEntries: (next: readonly T[] | ((prev: readonly T[]) => readonly T[])) => readonly T[]

  constructor(readonly name: string) {
    const [entries, setEntries] = createSignal<readonly T[]>([])
    this.#entries = entries
    this.#setEntries = setEntries
  }

  entries(): readonly T[] {
    return this.#entries()
  }

  get(id: string): T | undefined {
    return this.#entries().find((entry) => entry.id === id)
  }

  register(entry: T): Disposable {
    if (this.get(entry.id)) throw new Error(`${this.name} contribution already registered: ${entry.id}`)
    this.#setEntries((entries) => [...entries, entry])
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        this.#setEntries((entries) => entries.filter((candidate) => candidate !== entry))
      },
    }
  }
}
