import { randomBytes } from 'node:crypto'
import { existsSync, chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writePrivateAtomic } from './dataRoot'

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
// integration credentials in it. Directory mode 0700 and file mode 0600 stand behind that, the same
// posture main/tls.ts relies on.
export function ensureSessionKey(dataDir: string): string {
  const fromEnv = process.env.SESSION_ENC_KEY?.trim()
  if (fromEnv) return fromEnv

  const path = join(dataDir, KEY_FILE)
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
