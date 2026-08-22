import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Device-token custody (docs/architecture-overview.md § How the client talks to nodes): the renderer
// never holds a token, so the credential lives here and only here.
//
// The encryption itself is the shell's, injected as a `TokenCipher`, because it is the one part of
// custody that is not portable: Electron has safeStorage against the OS keychain, and the Tauri
// helper has a data key Rust holds in the keychain instead (docs/future/tauri/architecture.md § Keys
// and custody). Everything else here — the scope rules, the file discipline, the forget-quietly
// failure mode — is the same on both.
//
// One file per scope, where a scope is a nodeId, except the bundled local node, which uses the
// constant below. The local node can't be keyed by nodeId, because its token has to be read before
// the service starts and starting it is the only thing that can tell us the nodeId. There's exactly
// one bundled node per userData dir, so the dir is its scope. fleetStore.ts owns that mapping.
//
// A stale token, where the data root was wiped so the node no longer knows it, needs no detection
// here: the node fails to authenticate it, issues a fresh one, and we overwrite.

export const LOCAL_TOKEN_SCOPE = 'local'

// Whatever the host encrypts secrets with. `available` is allowed to say no: a machine with no
// keychain simply does not remember tokens.
export type TokenCipher = {
  available(): boolean
  encrypt(value: string): Uint8Array
  decrypt(blob: Buffer): string
}

export type DeviceTokens = {
  read(scope: string): string | undefined
  write(scope: string, token: string): void
  forget(scope: string): void
}

// Scopes come from our own node.json or PairResult, but they end up in a filename, so anything that could
// climb out of the directory is rejected rather than sanitized. A scope we can't name is a token we
// simply don't remember, which is already a supported state.
const tokenPath = (userDataDir: string, scope: string): string | null =>
  /^[A-Za-z0-9._-]{1,128}$/.test(scope) ? join(userDataDir, `device-token-${scope}`) : null

export function deviceTokens(userDataDir: string, cipher: TokenCipher): DeviceTokens {
  return {
    // A token remembered from a previous launch, or undefined. Every failure mode (no file, encryption
    // unavailable, ciphertext from a different key) returns undefined, because the recovery is
    // identical and cheap: the node issues a fresh token and we store that.
    read(scope) {
      if (!cipher.available()) return undefined
      const path = tokenPath(userDataDir, scope)
      if (!path) return undefined
      try {
        return cipher.decrypt(readFileSync(path)).trim() || undefined
      } catch {
        return undefined
      }
    },

    write(scope, token) {
      if (!cipher.available()) {
        // Without a keychain the token isn't remembered: the node issues a new one next launch, or for a
        // remote node the owner re-pairs. Writing it in plaintext to "make it work" would be strictly worse
        // than an extra device row.
        console.warn('[device-token] no encryption available; the device token will not be remembered across launches')
        return
      }
      const path = tokenPath(userDataDir, scope)
      if (!path) return
      mkdirSync(userDataDir, { recursive: true, mode: 0o700 })
      writeFileSync(path, cipher.encrypt(token), { mode: 0o600 })
      chmodSync(path, 0o600) // enforce perms when replacing a file created under a looser umask
    },

    forget(scope) {
      const path = tokenPath(userDataDir, scope)
      if (path) rmSync(path, { force: true })
    },
  }
}
