import { randomBytes } from 'node:crypto'
import { existsSync, chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writePrivateAtomic } from './dataRoot'

const KEY_FILE = 'session.key'

// The key that encrypts stored credentials at rest (server/secretBox.ts). 32 bytes as 64 hex chars,
// the size A256GCM requires.
//
// Read from the environment when it is there — the desktop supplies it from safeStorage before any
// binding reads it, and a service manager may pass one in. Otherwise mint it into the data root, for
// the same reason the TLS private key already sits there: a headless node has no keychain, and making
// an operator invent a 64-hex secret before the process will boot is a step that adds no security
// whatsoever on a machine where the key would land beside the database anyway.
//
// Its blast radius is the same as that private key's: whoever can read the data root can decrypt the
// integration credentials in it. Directory mode 0700 and file mode 0600 are what stand behind that,
// which is exactly the posture main/tls.ts already relies on.
export function ensureSessionKey(dataDir: string): string {
  const fromEnv = process.env.SESSION_ENC_KEY?.trim()
  if (fromEnv) return fromEnv

  const path = join(dataDir, KEY_FILE)
  if (existsSync(path)) {
    const stored = readFileSync(path, 'utf8').trim()
    // Never silently re-mint. A key that failed to validate means the file was truncated or edited,
    // and generating a fresh one would turn "something is wrong with this file" into "every stored
    // credential is permanently undecryptable" — with no error to explain it.
    if (!/^[0-9a-fA-F]{64}$/.test(stored)) {
      throw new Error(
        `${path} does not hold a 64-hex key. Fix or remove it — refusing to mint a second key, which would orphan every secret already encrypted under the first.`,
      )
    }
    chmodSync(path, 0o600) // migrate a file created under a permissive umask
    return stored
  }

  const minted = randomBytes(32).toString('hex')
  writePrivateAtomic(path, `${minted}\n`)
  return minted
}
