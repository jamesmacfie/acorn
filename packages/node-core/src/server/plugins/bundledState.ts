import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writePrivateAtomic } from '../storage/dataRoot'
import { z } from 'zod'
import { PLUGIN_DB_DIR } from './storage'
import { createLogger } from '../telemetry/logger'

const log = createLogger('plugins')

// Visible rather than dot-prefixed, because dot names in this directory are reserved for installer
// staging and debris sweeps. The manifest id grammar forbids dots, so this cannot collide with a
// package.
const STATE_FILE = 'bundled-state.json'

const entrySchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('installed'),
    version: z.string().min(1),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    installedAt: z.number().int(),
  }),
  z.strictObject({ status: z.literal('user'), installedAt: z.number().int() }),
  z.strictObject({ status: z.literal('removed'), installedAt: z.number().int() }),
])
export type BundledPluginStateEntry = z.infer<typeof entrySchema>

const stateSchema = z.strictObject({ version: z.literal(1), plugins: z.record(z.string(), entrySchema) })
type BundledPluginState = z.infer<typeof stateSchema>

const rootFor = (dataRoot: string): string => join(resolve(dataRoot), PLUGIN_DB_DIR)
export const bundledPluginStatePath = (dataRoot: string): string => join(rootFor(dataRoot), STATE_FILE)

const readState = (dataRoot: string): BundledPluginState => {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(readFileSync(bundledPluginStatePath(dataRoot), 'utf8')))
    if (parsed.success) return parsed.data
    log.warn('bundled plugin state is unreadable; preserving packages already on disk')
  } catch {
    // First launch, before the app has reconciled any bundled package.
  }
  return { version: 1, plugins: {} }
}

const writeState = (dataRoot: string, state: BundledPluginState): void => {
  const root = rootFor(dataRoot)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const file = bundledPluginStatePath(dataRoot)
  writePrivateAtomic(file, `${JSON.stringify(state, null, 2)}\n`)
}

const setEntry = (dataRoot: string, id: string, entry: BundledPluginStateEntry): void => {
  const state = readState(dataRoot)
  writeState(dataRoot, { ...state, plugins: { ...state.plugins, [id]: entry } })
}

export const readBundledPluginState = (dataRoot: string, id: string): BundledPluginStateEntry | undefined =>
  readState(dataRoot).plugins[id]

/** Every id whose ownership row says an owner installed it, so reconciliation never replaces it.
 *
 * Read on its own, not only as reconciliation's `preserved` list, because the row is what freezes a
 * copy, and a node with no bundled root to reconcile from never produces that list. That is the
 * `dev:node` case where a `build:plugin` output outlives every later build and nothing says so. */
export const userManagedPluginIds = (dataRoot: string): string[] =>
  Object.entries(readState(dataRoot).plugins)
    .filter(([, entry]) => entry.status === 'user')
    .map(([id]) => id)
    .sort()

export const markBundledPluginInstalled = (
  dataRoot: string,
  id: string,
  version: string,
  fingerprint: string,
  installedAt = Date.now(),
): void => setEntry(dataRoot, id, { status: 'installed', version, fingerprint, installedAt })

/** A package installed through the owner-facing installer is an override. Keeping this row after the
 * package disappears stops a later app release from claiming the id. */
export const markPluginUserManaged = (dataRoot: string, id: string): void =>
  setEntry(dataRoot, id, { status: 'user', installedAt: Date.now() })

/** An uninstall is sticky across app restarts and app upgrades. The tombstone lives outside the
 * package directory because uninstall removes that directory by definition. */
export const markPluginRemoved = (dataRoot: string, id: string): void =>
  setEntry(dataRoot, id, { status: 'removed', installedAt: Date.now() })
