import { realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

// All Editor mutations of one canonical file share a queue, even when task roots are aliases.
// Future folder operations must acquire their descendant file keys in sorted order.
const tails = new Map<string, Promise<void>>()

export async function canonicalFileKey(path: string): Promise<string> {
  try { return await realpath(path) }
  catch { return join(await realpath(dirname(path)), basename(path)) }
}

export async function withFileWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve()
  let release!: () => void
  const tail = new Promise<void>((resolve) => { release = resolve })
  tails.set(key, tail)
  await previous
  try { return await operation() }
  finally {
    if (tails.get(key) === tail) tails.delete(key)
    release()
  }
}
