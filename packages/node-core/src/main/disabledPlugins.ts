import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join } from 'node:path'

// Which plugins this node has been told not to run (docs/vNext/ui.md § New surfaces, "Settings →
// Plugins — enable/disable toggles (per node)").
//
// **Why the node owns this and not the client.** `serviceStartConfigSchema.disabledPlugins` landed in
// Phase 3 so the toggle would be a list rather than a refactor, and the obvious next step looks like
// storing the list in the desktop app's `fleet.json` and passing it down at spawn. That only works for
// the node the client spawns. A remote node is started by launchd/systemd/a shell, and nothing about
// that boot consults a client's fleet file — so the setting would silently do nothing for exactly the
// deployment the fleet exists to serve. Which plugins a node runs decides which routes exist and which
// SQLite files open; that is the node's state, so it lives in the node's data root.
//
// The start-config field survives as an override, unioned with this file: tests and `dev:node` want to
// pin a list without writing to a data root.
//
// A plain file rather than a `settings` row, matching `internal-token` and `active-identity`: the plugin
// host runs BEFORE any route can answer, and reading it must not depend on a plugin's database being
// open. Mode 0600 in the 0700 data root, atomic rename on write, same as active-identity — a truncated
// write here would disable an arbitrary subset of the app on the next boot.
export type DisabledPluginsStore = {
  get(): readonly string[]
  set(names: readonly string[]): void
}

const FILE_NAME = 'disabled-plugins.json'

// Anything unparseable reads as "nothing disabled". The opposite default (fail the boot) would turn a
// corrupted 40-byte file into an app that cannot start, and the recovery — delete the file — is the same
// state this produces.
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
