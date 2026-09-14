// Reading a credential out of 1Password instead of out of our own database.
//
// A stored credential may be a 1Password secret reference, `op://Vault/Item/field`, rather than a
// token. It is sealed and stored exactly like a token (server/secretBox.ts); the difference is what
// happens when someone asks for the plaintext. `SecretService.use()` hands the reference here, and
// this file shells out to the `op` CLI to turn it into a value. See docs/security.md § Credential
// handling.
//
// This is the only file that knows `op` exists. Everything else deals in "a secret we could not
// read", which is a shape the rest of the system already had.
import { homedir } from 'node:os'
import { and, eq } from 'drizzle-orm'
import {
  ONEPASSWORD_PREF_DEFAULT,
  ONEPASSWORD_PREF_KEY,
  parseOnePasswordPref,
  type OnePasswordPref,
} from '@acorn/protocol/api.ts'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { runProcess } from './proc'
import { createLogger } from '../telemetry/logger'

const log = createLogger('secrets:1password')

// Long enough for someone to notice a Touch ID prompt, find their finger, and press it. A shorter
// timeout would report a healthy 1Password as broken.
const READ_TIMEOUT_MS = 60_000

// A reference names a vault, an item, and a field. Nothing in that needs a quote, a newline, or a
// shell character, so anything carrying one is malformed rather than exotic.
const REF_PATTERN = /^op:\/\/[A-Za-z0-9 ._%@+-]+(\/[A-Za-z0-9 ._%@+-]+){1,3}$/
const MAX_REF_LENGTH = 512

/** Whether a stored plaintext is a reference rather than the credential itself. */
export const isSecretRef = (value: string): boolean => value.startsWith('op://')

export type OnePasswordFailure = 'disabled' | 'not-installed' | 'malformed' | 'unreadable'

// Deliberately not a SecretUnavailableError. That one means "this connection has no usable
// credential", and callers act on it: forEachConnection demotes the connection to needs-auth and
// providerCredential converges it to ''. Neither is true here. The credential is fine; this machine
// could not reach 1Password, and saying otherwise would mark a working connection as broken.
export class OnePasswordError extends Error {
  constructor(readonly reason: OnePasswordFailure) {
    // Never the reference and never `op`'s stderr. Both can name a vault and an item, and an error
    // message travels further than the log line does.
    super('Could not read this credential from 1Password.')
    this.name = 'OnePasswordError'
  }
}

type CacheEntry = { value: string; expiresAt: number }
const cache = new Map<string, CacheEntry>()

// Every `op` invocation queues behind the last one. Two connections refreshing at the same moment
// would otherwise stack two unlock prompts, and the second one arrives with no context about what
// asked for it. Checking the cache after taking a place in the queue makes this single-flight as
// well: concurrent reads of the same reference cost one prompt, because the second read finds what
// the first one stored.
let queue: Promise<unknown> = Promise.resolve()

/** Drop every cached value. The Security page's "Refetch from 1Password now" button. */
export function forgetResolved(): void {
  cache.clear()
}

// Cache a freshly read value. Connect and rotate go through the same resolver, so connecting does
// not cost a second prompt when the next call tests the connection.
function rememberResolved(ref: string, value: string, settings: OnePasswordPref): void {
  if (!isSecretRef(ref)) return
  cache.set(ref, { value, expiresAt: settings.ttlMs === null ? Infinity : Date.now() + settings.ttlMs })
}

async function readSettings(db: AppDatabase, userId: string): Promise<OnePasswordPref> {
  const [row] = await db
    .select({ value: schema.prefs.value })
    .from(schema.prefs)
    .where(and(eq(schema.prefs.userId, userId), eq(schema.prefs.key, ONEPASSWORD_PREF_KEY)))
    .limit(1)
  return parseOnePasswordPref(row?.value)
}

/** Is `op` on this node's PATH, and which version. What the Security page shows under the switch. */
export async function probe(): Promise<{ available: boolean; version?: string }> {
  const result = await runProcess({ file: 'op', args: ['--version'], cwd: homedir(), timeoutMs: 10_000 })
  if (result.spawnError || result.code !== 0) return { available: false }
  return { available: true, version: result.stdout.trim() }
}

async function read(ref: string): Promise<string> {
  // `--` so a reference can never be read as a flag, on top of the pattern check above. runProcess
  // spawns directly with no shell, so this is about argv parsing rather than injection.
  const result = await runProcess({
    file: 'op',
    args: ['read', '--no-newline', '--', ref],
    cwd: homedir(),
    timeoutMs: READ_TIMEOUT_MS,
  })
  if (result.spawnError) {
    log.warn(`op is not runnable on this node: ${result.spawnError}`)
    throw new OnePasswordError('not-installed')
  }
  if (result.code !== 0 || !result.stdout.trim()) {
    // op's own diagnostics go here and nowhere else. They quote vault and item names, which is the
    // same reason a failed harness generate keeps its stderr off the wire (docs/security.md).
    log.warn(`op read failed (exit ${result.code}): ${result.stderr.trim().split('\n')[0] ?? ''}`)
    throw new OnePasswordError('unreadable')
  }
  return result.stdout.trim()
}

/**
 * The resolver `SecretService` calls. A closure over the database and the owner id rather than an
 * injected interface: those two values are the only reason this cannot be a bare function, and
 * SecretService has no business learning what a database is.
 */
export function createOnePasswordResolver(db: AppDatabase, ownerId: () => string | null) {
  return async (ref: string): Promise<string> => {
    const userId = ownerId()
    const settings = userId ? await readSettings(db, userId) : ONEPASSWORD_PREF_DEFAULT
    // Off is a refusal, not a fallback. Handing `op://…` to a provider as if it were a token would
    // fail somewhere far from here, with an error about a rejected credential.
    if (!settings.enabled) throw new OnePasswordError('disabled')
    if (ref.length > MAX_REF_LENGTH || !REF_PATTERN.test(ref)) throw new OnePasswordError('malformed')

    const run = queue.then(async () => {
      const hit = cache.get(ref)
      if (hit && hit.expiresAt > Date.now()) return hit.value
      const value = await read(ref)
      rememberResolved(ref, value, settings)
      return value
    })
    // The queue must survive a failed read, or one missing item wedges every later resolve.
    queue = run.catch(() => {})
    return run
  }
}
