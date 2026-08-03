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
// Scoped to the local bundled node, and deliberately NOT keyed by nodeId: the token has to be read
// *before* the service starts, which is the only thing that can tell us the nodeId. There is exactly
// one bundled node per userData dir, so the dir is the scope. Paired remote nodes are keyed by
// nodeId inside the fleet store, which is a superset of this.
//
// A stale token (the data root was wiped, so the node no longer knows it) needs no detection here:
// the service fails to authenticate it, issues a fresh one, and we overwrite.

const TOKEN_FILE = 'local-device-token'

// A token remembered from a previous launch, or undefined. Every failure mode — no file, encryption
// unavailable, ciphertext from a different keychain entry — returns undefined, because the recovery
// is identical and cheap: the node issues a fresh token and we store that.
export function readLocalDeviceToken(userDataDir: string): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined
  try {
    return safeStorage.decryptString(readFileSync(join(userDataDir, TOKEN_FILE))).trim() || undefined
  } catch {
    return undefined
  }
}

export function writeLocalDeviceToken(userDataDir: string, token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Without a keychain the token is simply not remembered: the node issues a new one next launch.
    // Writing it in plaintext to "make it work" would be strictly worse than an extra device row.
    console.warn('[device-token] safeStorage unavailable; the device token will not be remembered across launches')
    return
  }
  const path = join(userDataDir, TOKEN_FILE)
  mkdirSync(userDataDir, { recursive: true, mode: 0o700 })
  writeFileSync(path, safeStorage.encryptString(token), { mode: 0o600 })
  chmodSync(path, 0o600) // enforce perms when replacing a file created under a looser umask
}

export function forgetLocalDeviceToken(userDataDir: string): void {
  rmSync(join(userDataDir, TOKEN_FILE), { force: true })
}
