import { randomBytes } from 'node:crypto'
import { existsSync, chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ne } from 'drizzle-orm'
import { SEALED_NODE_KEYS_FILE, type NodeKeyCheck } from '@acorn/protocol/serviceProtocol.ts'
import { schema, type AppDatabase } from './db'
import type { SecretService } from './core/secrets'
import { writePrivateAtomic } from './storage/dataRoot'
import { recordAudit } from './audit'
import { createLogger } from './telemetry/logger'

const log = createLogger('session-key')

const KEY_FILE = 'session.key'

// The key that encrypts stored credentials at rest (server/secretBox.ts). 32 bytes as 64 hex chars,
// the size A256GCM requires.
//
// Read it from the environment when it is there: the desktop supplies it from safeStorage before any
// binding reads it, and a service manager may pass one in. Otherwise mint it into the data root, the
// same place the TLS private key sits. A headless node has no keychain, and making an operator
// invent a 64-hex secret before boot buys nothing on a machine where the key lands beside the
// database anyway.
//
// The blast radius matches that private key's: whoever can read the data root can decrypt the
// integration credentials in it, and that includes an agent running as the same user. File modes don't
// stop the owner's own processes. A desktop-supervised Node doesn't come here: the helper delivers
// its keys in the start message (docs/security/credentials.md § Node keys).
export function ensureSessionKey(dataDir: string): string {
  const fromEnv = process.env.SESSION_ENC_KEY?.trim()
  if (fromEnv) return fromEnv

  const path = join(dataDir, KEY_FILE)
  // A root the desktop has sealed has no plain key left. Minting one here would leave every stored
  // credential unreadable.
  if (!existsSync(path) && existsSync(join(dataDir, SEALED_NODE_KEYS_FILE))) {
    throw new Error(
      `${dataDir} keeps its keys sealed by the desktop app. Start this Node from the desktop app, or set SESSION_ENC_KEY to the key it uses.`,
    )
  }
  if (existsSync(path)) {
    const stored = readFileSync(path, 'utf8').trim()
    // Never re-mint. A key that fails to validate means the file was truncated or edited, and a
    // fresh one would turn "something is wrong with this file" into "every stored credential is
    // undecryptable", with no error to explain it.
    if (!/^[0-9a-fA-F]{64}$/.test(stored)) {
      throw new Error(
        `${path} does not hold a 64-hex key. Fix or remove it. Minting a second key would orphan every secret encrypted under the first.`,
      )
    }
    chmodSync(path, 0o600) // repair a file created under a permissive umask
    return stored
  }

  const minted = randomBytes(32).toString('hex')
  writePrivateAtomic(path, `${minted}\n`)
  return minted
}

// The Node's half of the key migration check: can the session key open a stored credential? The
// helper deletes a plain session.key only after this answers `ok` or `none`.
export async function checkSessionKey(db: AppDatabase, secrets: SecretService): Promise<NodeKeyCheck> {
  const rows = db
    .select({ sealed: schema.integrations.encryptedCredentials })
    .from(schema.integrations)
    .where(ne(schema.integrations.encryptedCredentials, ''))
    .all()
  if (rows.length === 0) return 'none'
  for (const row of rows) {
    if (await secrets.useOptional(row.sealed, 'session key check', () => true)) return 'ok'
  }
  log.warn(`the session key opened none of ${rows.length} stored credentials`)
  recordAudit(db, { actor: 'system', action: 'keys.check.failed', details: { credentials: rows.length } })
  return 'failed'
}

// What security diagnostics says about this Node's keys. Read live, so a plain file the migration
// kept, or one put back by hand, shows up on the next check.
export type NodeKeyCustody = {
  // The desktop helper delivered the keys in the start message, or this Node read them from files.
  delivery: 'desktop' | 'files'
  // The session key check from this boot. Null when the Node didn't run one.
  keyCheck: NodeKeyCheck | null
  // Plain key files still in the data root, which any process running as this user can read.
  plainFiles: string[]
}

export function nodeKeyCustody(dataDir: string, delivery: NodeKeyCustody['delivery'], keyCheck: NodeKeyCheck | null = null): { snapshot(): NodeKeyCustody } {
  return {
    snapshot: () => ({ delivery, keyCheck, plainFiles: [KEY_FILE, 'internal-token'].filter((name) => existsSync(join(dataDir, name))) }),
  }
}
