import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writePrivateAtomic } from '@acorn/node-core/server/storage/dataRoot.ts'
import { configDir } from '../node/paths'

/** The terminal host's file-backed implementation of the device preference storage client-core uses.
 * Only acorn preference keys are written here; Node-owned preferences still use the Node API. */
export function installDevicePreferenceStorage(): void {
  const dir = configDir()
  const file = join(dir, 'device-prefs.json')
  let values: Record<string, string> = {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      values = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    }
  } catch { /* First run or an unreadable file: no device preferences are trusted from it. */ }
  const persist = () => {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writePrivateAtomic(file, `${JSON.stringify(values, null, 2)}\n`)
  }
  const storage: Storage = {
    get length() { return Object.keys(values).length },
    key(index) { return Object.keys(values)[index] ?? null },
    getItem(key) { return values[key] ?? null },
    setItem(key, value) { values[key] = value; persist() },
    removeItem(key) { delete values[key]; persist() },
    clear() { values = {}; persist() },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
}
