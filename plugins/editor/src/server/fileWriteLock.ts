import { realpath } from 'node:fs/promises'

// Editor saves and file actions share a canonical checkout queue across task-root aliases.
const tails = new Map<string, Promise<void>>()

export async function withFileWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve()
  let release!: () => void
  const tail = new Promise<void>((resolve) => {
    release = resolve
  })
  tails.set(key, tail)
  await previous
  try {
    return await operation()
  } finally {
    if (tails.get(key) === tail) tails.delete(key)
    release()
  }
}

/** A canonical checkout lock includes queued saves, so folder mutations cannot pass a writer
 * admitted for any descendant. Aliased task roots resolve to the same key. */
export async function canonicalCheckoutKey(root: string): Promise<string> {
  return realpath(root)
}
