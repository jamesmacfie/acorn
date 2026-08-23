import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deviceTokens, type TokenCipher } from './deviceTokenStore'

// One-time adoption of the custody root an Electron build left behind
// (docs/future/tauri/architecture.md § Keys and custody).
//
// The two shells cannot share a root: Electron's userData is named after the app, Tauri's after the
// bundle identifier. So this is a copy, not a handover — and it copies the whole root rather than only
// the tokens, because a device token without the `fleet.json` row that names its node is a secret for
// a machine nobody remembers.
//
// Everything here is best-effort by design. If any of it fails, the owner loses remembered pairings
// and nothing else: the local node mints a fresh device row, remote nodes ask to be paired again, and
// the fleet UI says so honestly. That is a supported product state, which is what lets this be one
// pass with no retry, no marker file, and no migration ledger.

/// What the shell found: the old root, and the safeStorage password from the keychain item beside it.
export type LegacyCustody = { userDataDir: string; safeStorageKey: string }

// Chromium's os_crypt, which is what `safeStorage` is. On macOS the keychain holds a password and the
// AES key is derived from it with these exact constants; they are Chromium's and are not ours to
// choose. The `v10` prefix is os_crypt's version tag, and an IV of sixteen spaces is likewise theirs.
const OS_CRYPT = { salt: 'saltysalt', iterations: 1003, keyLength: 16, prefix: 'v10' } as const

// The files that make a custody root. Copied verbatim except the tokens, which have to change hands
// from one cipher to the other.
const FLEET = 'fleet.json'
const TRUST = 'plugin-trust.json'
const CACHE = 'plugin-cache'
const TOKEN_PREFIX = 'device-token-'

function legacyDecrypt(blob: Buffer, password: string): string | null {
  if (blob.subarray(0, OS_CRYPT.prefix.length).toString('latin1') !== OS_CRYPT.prefix) return null
  const key = pbkdf2Sync(password, OS_CRYPT.salt, OS_CRYPT.iterations, OS_CRYPT.keyLength, 'sha1')
  const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
  try {
    return Buffer.concat([decipher.update(blob.subarray(OS_CRYPT.prefix.length)), decipher.final()]).toString('utf8')
  } catch {
    // A password that no longer opens these blobs, which is what a rebuilt or re-signed Electron app
    // leaves behind. Nothing to salvage and nothing to warn twice about; the caller reports the count.
    return null
  }
}

/**
 * Copy an Electron build's custody root into this one, re-encrypting its device tokens under the
 * cipher this shell uses. Does nothing at all unless the new root is empty and the old one is there,
 * so it is safe to call on every boot and only ever runs once in practice.
 */
export function adoptLegacyCustody(userDataDir: string, cipher: TokenCipher, legacy: LegacyCustody): void {
  // An owner who has already used this build has a fleet of their own, and it wins. This is the whole
  // guard: no marker file, because the presence of a fleet is the marker.
  if (existsSync(join(userDataDir, FLEET)) || !existsSync(join(legacy.userDataDir, FLEET))) return

  mkdirSync(userDataDir, { recursive: true, mode: 0o700 })
  for (const name of [FLEET, TRUST]) {
    const from = join(legacy.userDataDir, name)
    if (existsSync(from)) copyFileSync(from, join(userDataDir, name))
  }
  // The plugin cache is content-addressed, so copying it is free of decisions: the same bytes hash to
  // the same names, and the trust records that came with it still point at them.
  const cacheFrom = join(legacy.userDataDir, CACHE)
  if (existsSync(cacheFrom)) cpSync(cacheFrom, join(userDataDir, CACHE), { recursive: true })

  const tokens = deviceTokens(userDataDir, cipher)
  let adopted = 0
  let lost = 0
  for (const entry of readdirSync(legacy.userDataDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(TOKEN_PREFIX)) continue
    const scope = entry.name.slice(TOKEN_PREFIX.length)
    const token = legacyDecrypt(readFileSync(join(legacy.userDataDir, entry.name)), legacy.safeStorageKey)?.trim()
    if (!token) {
      lost += 1
      continue
    }
    tokens.write(scope, token)
    adopted += 1
  }
  console.log(
    `[custody] adopted ${legacy.userDataDir}: ${adopted} device token(s)` +
      (lost ? `; ${lost} could not be decrypted and those nodes will ask to be paired again` : ''),
  )
}
