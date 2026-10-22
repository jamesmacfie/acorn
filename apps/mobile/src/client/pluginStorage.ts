import { createStore, del, get, getMany, keys, set } from 'idb-keyval'
import type { BundleStorage, TrustStorage } from '@acorn/custody/rules'

// Where the phone keeps plugin bundles and its own decisions about running them, in IndexedDB
// (docs/mobile/plugin-custody.md). The database is `acorn-phone-plugins`, with three kinds of key:
//
//   index          the bundle index, as the text the custody rules write
//   trust          this phone's decisions, the same way
//   bundle:<hash>  a bundle's bytes, as an ArrayBuffer
//
// The rules read the index and the decisions as they go, and IndexedDB only answers later. So both are
// read once when this opens, and a write goes to the rules' copy first and to IndexedDB behind it.
// `flush` waits for the behind-writes, so an answer to the person can wait until what it says was kept.
// A bundle's bytes are written ahead of the index row that names them, as the rules ask.
//
// It imports nothing that reads the platform seam, because `platform.ts` loads it before the app does.

const store = createStore('acorn-phone-plugins', 'custody')
const INDEX = 'index'
const TRUST = 'trust'
const bundleKey = (hash: string) => `bundle:${hash}`

export type PhonePluginStorage = {
  bundles: BundleStorage
  trust: TrustStorage
  /** The bytes of a bundle the rules stored, for the sandbox to start. */
  readBundle(hash: string): Promise<ArrayBuffer>
  /** Resolves once every write so far is in IndexedDB, and rejects if one failed. */
  flush(): Promise<void>
}

export async function openPluginStorage(): Promise<PhonePluginStorage> {
  const [index, trust] = await getMany<string>([INDEX, TRUST], store)
  let indexText = index ?? null
  let trustText = trust ?? null

  let behind: Promise<void> = Promise.resolve()
  let failure: { error: unknown } | null = null
  const writeBehind = (work: () => Promise<unknown>): void => {
    behind = behind.then(work).then(
      () => {},
      (error: unknown) => void (failure ??= { error }),
    )
  }

  return {
    bundles: {
      readIndex: () => indexText,
      writeIndex: (text) => {
        indexText = text
        writeBehind(() => set(INDEX, text, store))
      },
      // An exact-size copy, because IndexedDB stores the whole buffer behind a view.
      writeBundle: (hash, bytes) => set(bundleKey(hash), bytes.slice().buffer, store),
      keepOnly: (hashes) =>
        writeBehind(async () => {
          for (const key of await keys<string>(store)) {
            if (key.startsWith('bundle:') && !hashes.has(key.slice('bundle:'.length))) await del(key, store)
          }
        }),
    },
    trust: {
      read: () => trustText,
      write: (text) => {
        trustText = text
        writeBehind(() => set(TRUST, text, store))
      },
      // The rules call this for a record they can't read. It keeps its own key, so the next write
      // can't replace it, and nothing reads it back: this phone asks about each plugin again.
      setAside: () => {
        writeBehind(() => set(`${TRUST}.corrupt`, trustText, store))
        return `${TRUST}.corrupt`
      },
    },
    readBundle: async (hash) => {
      const bytes = await get<ArrayBuffer>(bundleKey(hash), store)
      if (!bytes) throw new Error(`This phone holds no bundle ${hash.slice(0, 12)}.`)
      return bytes
    },
    flush: async () => {
      await behind
      if (failure) {
        const { error } = failure
        failure = null
        throw error
      }
    },
  }
}
