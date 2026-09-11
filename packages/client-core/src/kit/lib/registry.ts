import { createSignal, untrack, type Accessor } from 'solid-js'

export type Disposable = { dispose(): void }

type Identified = { id: string }

// Small process-local registry used by the client extension seams. Registration is synchronous
// and side-effect free apart from publishing the new descriptor list; feature activation owns any
// real work. A duplicate id is a programming error because silently replacing a contribution would
// make activation order observable.
//
// It also answers who contributed each entry. Eight of the contribution types have no plugin id on
// them, and a telemetry record has to name an owner (docs/telemetry.md § The attribute vocabulary),
// so the owner is a side-map here rather than a field added to eight types and every registration
// site. The three passes that know the owner fill it: the descriptor pass in
// host/chrome/chromeRegister.ts, the frame pass in host/frames/register.ts, and `makeContext` in
// host/registries/extensionPoints/plugin.ts. Everything else is core's, and `ownerOf` answers
// undefined for those rather than guessing.
export class Registry<T extends Identified> {
  readonly #entries: Accessor<readonly T[]>
  readonly #setEntries: (next: readonly T[] | ((prev: readonly T[]) => readonly T[])) => readonly T[]
  // Plain, not reactive. Nothing renders from it: the seams read it while building a record, and a
  // signal here would make every telemetry emit a reactive read inside whatever effect it fired in.
  readonly #owners = new Map<string, string>()

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

  /** Which plugin contributed this entry, or undefined for one of core's own. */
  ownerOf(id: string): string | undefined {
    return this.#owners.get(id)
  }

  register(entry: T, owner?: string): Disposable {
    // Registration is a mutation boundary, not a registry subscription. A surface may legitimately
    // reconcile registrations from a reactive effect; tracking this duplicate check would make that
    // effect depend on the signal it writes below, so register -> rerun -> cleanup -> unregister
    // feeds back synchronously until the JavaScript stack is exhausted.
    if (untrack(() => this.get(entry.id))) throw new Error(`${this.name} contribution already registered: ${entry.id}`)
    this.#setEntries((entries) => [...entries, entry])
    if (owner) this.#owners.set(entry.id, owner)
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        this.#setEntries((entries) => entries.filter((candidate) => candidate !== entry))
        // Dropped with the entry, so a plugin that reloads and comes back under a different id does
        // not leave the old one answering.
        this.#owners.delete(entry.id)
      },
    }
  }
}
