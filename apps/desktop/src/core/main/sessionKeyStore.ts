import { safeStorage } from 'electron'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'

// Migration C (docs/next Phase 9): SESSION_ENC_KEY via Electron safeStorage, not keytar. safeStorage
// is built in (no native rebuild) and encrypts against the OS keychain. This is the FIRST secret to
// move; integration tokens ride the same key at rest (session.ts encryptSecret), so losing it logs
// everyone out AND strands every stored provider token — hence the deliberate throw-not-regenerate
// on decrypt failure below (acceptance: a failure mode that never silently creates a second identity).
//
// Env always wins: `.env` (dev), the real environment, and tests can set SESSION_ENC_KEY directly.
// When safeStorage is available, an env key is also persisted so env-only installations migrate
// without changing identity. With no env or key file, an existing DB is a hard stop: only a genuinely
// fresh data root may mint a new identity.

const KEY_FILE = 'session.key' // safeStorage-encrypted 64-hex-char key, mode 0600, under the data root
const DB_FILE = 'acorn.sqlite'
const VALID_KEY = /^[0-9a-fA-F]{64}$/

function assertValidKey(key: string, source: string): void {
  if (!VALID_KEY.test(key)) throw new Error(`${source} must be exactly 64 hex chars (32 bytes)`)
}

function persistKey(path: string, key: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, safeStorage.encryptString(key), { mode: 0o600 })
  chmodSync(path, 0o600) // enforce perms when replacing a file created under a looser umask
}

// Resolve SESSION_ENC_KEY and publish it to process.env so makeBindings' plain `secret()` lookup
// works unchanged (dev:node and tests keep their env-only path). Call AFTER app.whenReady() —
// safeStorage.isEncryptionAvailable() is only meaningful once the app is ready.
export function resolveSessionKey(dataDir: string): void {
  const path = join(dataDir, KEY_FILE)
  const envKey = process.env.SESSION_ENC_KEY
  if (envKey) {
    assertValidKey(envKey, 'SESSION_ENC_KEY')
    if (!safeStorage.isEncryptionAvailable()) return // explicit env remains the supported fallback

    // Migration/repair path: make the authoritative env identity durable. Avoid rewriting the
    // ciphertext on every launch when the keychain copy already resolves to the same key.
    let persistedKey: string | null = null
    if (existsSync(path)) {
      try {
        persistedKey = safeStorage.decryptString(readFileSync(path))
      } catch {
        // The explicit env key is the recovery authority for a corrupt/unreadable keychain copy.
      }
    }
    if (persistedKey !== envKey) persistKey(path, envKey)
    else chmodSync(path, 0o600)
    return
  }

  if (!safeStorage.isEncryptionAvailable()) {
    // No OS keychain (e.g. a Linux session with no keyring). Refuse rather than fabricate a
    // throwaway plaintext key that would silently change identity on the next launch.
    throw new Error(
      'safeStorage encryption is unavailable and SESSION_ENC_KEY is unset — set SESSION_ENC_KEY in the environment, or run where the OS keychain is reachable.',
    )
  }

  if (existsSync(path)) {
    // Existing identity: decrypt it. A failure here (keychain rotated, corrupt file) is fatal on
    // purpose — regenerating would invalidate every session and encrypted provider token at once.
    const key = safeStorage.decryptString(readFileSync(path))
    assertValidKey(key, `${KEY_FILE} decrypted value`)
    process.env.SESSION_ENC_KEY = key
    return
  }

  // Missing key material beside an existing DB is an incomplete migration, not a first run. The old
  // env key can recover both sessions and provider tokens; inventing one here would strand both.
  if (existsSync(join(dataDir, DB_FILE))) {
    throw new Error(
      `${KEY_FILE} is missing for an existing ${DB_FILE} — restore the original SESSION_ENC_KEY in the environment so it can be migrated to safeStorage.`,
    )
  }

  // Genuinely fresh data root: mint a key, persist it keychain-encrypted, and adopt it.
  const key = randomBytes(32).toString('hex') // 64 hex chars = 32 bytes, what A256GCM needs
  persistKey(path, key)
  process.env.SESSION_ENC_KEY = key
}
