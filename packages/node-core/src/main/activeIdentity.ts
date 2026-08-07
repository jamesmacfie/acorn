import { chmodSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { join } from 'node:path'

// The identity bound to the machine-side internal token. Persisting the explicit login avoids
// guessing from whichever prefs/repo row SQLite happens to return first after an account switch.
// It is not a credential, but it still lives in the private data root and is written mode 0600.
export type ActiveIdentityStore = {
  get(): string | null
  set(userId: string): void
  clear(userId?: string): void
}

const FILE_NAME = 'active-identity'

export function activeIdentityStore(dataDir: string): ActiveIdentityStore {
  const file = join(dataDir, FILE_NAME)
  let current: string | null = null
  try {
    current = readFileSync(file, 'utf8').trim() || null
    chmodSync(file, 0o600)
  } catch {
    current = null
  }

  return {
    get: () => current,
    set(userId) {
      const next = userId.trim()
      if (!next || next === current) return
      const temporary = `${file}.${process.pid}.tmp`
      const fd = openSync(temporary, 'w', 0o600)
      try {
        writeSync(fd, `${next}\n`)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temporary, file)
      chmodSync(file, 0o600)
      current = next
    },
    clear(userId) {
      if (userId !== undefined && current !== userId) return
      current = null
      if (existsSync(file)) rmSync(file)
    },
  }
}

// The same contract with no file behind it, for callers that build CoreServices without a data root —
// today only tests. It is a separate export rather than a `dataDir?` default so a composition root
// cannot get a process-local identity by forgetting an argument: omitting it there is a type error.
export function memoryIdentityStore(initial: string | null = null): ActiveIdentityStore {
  let current = initial
  return {
    get: () => current,
    set: (userId) => {
      const next = userId.trim()
      if (next) current = next
    },
    clear: (userId) => {
      if (userId !== undefined && current !== userId) return
      current = null
    },
  }
}
