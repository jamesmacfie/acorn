import { safeStorage } from 'electron'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Device-token custody, in Electron main (docs/vNext/architecture.md § How the client talks to
// nodes): the renderer never holds a token, so the credential lives here and only here.
//
// safeStorage encrypts against the OS keychain and is built in — no native module, which is why
// docs/vNext/data.md's "OS keychain" needs no keytar dependency. Same mechanism as
// sessionKeyStore.ts; this is a second independent secret, not a second mechanism.
//
// One file per scope, where a scope is a nodeId — except the bundled local node, which uses the
// constant below. The local node cannot be keyed by nodeId because its token has to be read *before*
// the service starts, and starting it is the only thing that can tell us the nodeId; there is exactly
// one bundled node per userData dir, so the dir is its scope. fleetStore.ts owns that mapping.
//
// A stale token (the data root was wiped, so the node no longer knows it) needs no detection here:
// the node fails to authenticate it, issues a fresh one, and we overwrite.

export const LOCAL_TOKEN_SCOPE = 'local'

// Scopes come from our own node.json / PairResult, but they end up in a filename, so anything that
// could climb out of the directory is rejected rather than sanitized — a scope we cannot name is a
// token we simply do not remember, which is already a supported state.
const tokenPath = (userDataDir: string, scope: string): string | null =>
  /^[A-Za-z0-9._-]{1,128}$/.test(scope) ? join(userDataDir, `device-token-${scope}`) : null

// A token remembered from a previous launch, or undefined. Every failure mode — no file, encryption
// unavailable, ciphertext from a different keychain entry — returns undefined, because the recovery
// is identical and cheap: the node issues a fresh token and we store that.
export function readDeviceToken(userDataDir: string, scope: string): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined
  const path = tokenPath(userDataDir, scope)
  if (!path) return undefined
  try {
    return safeStorage.decryptString(readFileSync(path)).trim() || undefined
  } catch {
    return undefined
  }
}

export function writeDeviceToken(userDataDir: string, scope: string, token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Without a keychain the token is simply not remembered: the node issues a new one next launch
    // (or, for a remote node, the owner re-pairs). Writing it in plaintext to "make it work" would be
    // strictly worse than an extra device row.
    console.warn('[device-token] safeStorage unavailable; the device token will not be remembered across launches')
    return
  }
  const path = tokenPath(userDataDir, scope)
  if (!path) return
  mkdirSync(userDataDir, { recursive: true, mode: 0o700 })
  writeFileSync(path, safeStorage.encryptString(token), { mode: 0o600 })
  chmodSync(path, 0o600) // enforce perms when replacing a file created under a looser umask
}

export function forgetDeviceToken(userDataDir: string, scope: string): void {
  const path = tokenPath(userDataDir, scope)
  if (path) rmSync(path, { force: true })
}
