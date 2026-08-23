import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Device-token custody. See docs/architecture-overview.md, "How the client talks to nodes". The
// renderer never holds a token, so the credential lives here and only here.
//
// The encryption is the shell's, injected as a `TokenCipher`, because it is the one part of custody
// that is not portable. See docs/shell.md, "Keys and custody". The scope rules, the file discipline,
// and the forget-quietly failure mode are the same on every shell.
//
// One file per scope, where a scope is a nodeId, except the bundled local node, which uses the
// constant below. The local node cannot be keyed by nodeId, because its token has to be read before
// the service starts and starting it is the only thing that reports the nodeId. There is one bundled
// node per userData dir, so the dir is its scope. fleetStore.ts owns that mapping.
//
// A stale token, from a wiped data root the node no longer knows, needs no detection here. The node
// fails to authenticate it, issues a fresh one, and this overwrites.

export const LOCAL_TOKEN_SCOPE = 'local'

// Whatever the host encrypts secrets with. `available` is allowed to say no, and a machine with no
// keychain does not remember tokens.
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

// Scopes come from node.json or a PairResult, but they end up in a filename, so anything that could
// climb out of the directory is rejected rather than sanitized. A scope this cannot name is a token
// it does not remember, which is a supported state.
const tokenPath = (userDataDir: string, scope: string): string | null =>
  /^[A-Za-z0-9._-]{1,128}$/.test(scope) ? join(userDataDir, `device-token-${scope}`) : null

export function deviceTokens(userDataDir: string, cipher: TokenCipher): DeviceTokens {
  return {
    // A token remembered from a previous launch, or undefined. No file, no encryption, and ciphertext
    // from a different key all return undefined, because the recovery is the same either way: the
    // node issues a fresh token and this stores it.
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
        // Without a keychain the token is not remembered. The node issues a new one next launch, or
        // the owner re-pairs a remote node. Writing plaintext to "make it work" would be worse than
        // an extra device row.
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
