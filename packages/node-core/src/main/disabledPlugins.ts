import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join } from 'node:path'

export type DisabledPluginsStore = {
  get(): readonly string[]
  set(names: readonly string[]): void
}

const FILE_NAME = 'disabled-plugins.json'

// Anything unparseable reads as "nothing disabled". The opposite default (fail the boot) would turn
// a corrupted 40-byte file into an app that cannot start, and the recovery, delete the file, is the
// same state this produces.
const parse = (raw: string): string[] => {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return [...new Set(value.filter((name): name is string => typeof name === 'string' && name.length > 0))].sort()
  } catch {
    return []
  }
}

export function disabledPluginsStore(dataDir: string): DisabledPluginsStore {
  const file = join(dataDir, FILE_NAME)
  let current: readonly string[] = []
  try {
    current = parse(readFileSync(file, 'utf8'))
    chmodSync(file, 0o600)
  } catch {
    current = []
  }

  return {
    get: () => current,
    set(names) {
      const next = [...new Set(names.filter((name) => name.length > 0))].sort()
      mkdirSync(dataDir, { recursive: true, mode: 0o700 })
      const temporary = `${file}.${process.pid}.tmp`
      const fd = openSync(temporary, 'w', 0o600)
      try {
        writeSync(fd, `${JSON.stringify(next)}\n`)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temporary, file)
      chmodSync(file, 0o600)
      current = next
    },
  }
}
