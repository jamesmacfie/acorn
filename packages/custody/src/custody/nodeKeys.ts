import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SEALED_NODE_KEYS_FILE, type NodeKeyCheck, type NodeKeys } from '@acorn/protocol/serviceProtocol.ts'
import { writePrivateAtomic } from '@acorn/node-core/server/storage/dataRoot.ts'
import { createLogger, describeError } from '@acorn/node-core/server/telemetry'
import type { TokenCipher } from './deviceTokenStore'

const log = createLogger('node-keys')

// Custody of the Node's two secrets: the session key that encrypts stored credentials, and the key
// that signs internal tokens. See docs/security/credentials.md § Node keys.
//
// Both live in one file in the Node's data root, sealed under the data key Rust keeps in the OS
// keychain, and reach the Node only in its start message. An agent runs as the same OS user as the
// Node, so a plain key file is as readable to it as its own worktree. A sealed copy is useless
// without the keychain item, which another process can't read without a prompt the person sees.
//
// The protection is only as good as where the data key lives. A dev build, or a machine where the
// keychain refused the item, keeps it in a plain `data.key` file (apps/desktop/src-tauri/src/keychain.rs).
//
// A Node that ran before this wrote both keys in plain form. The first start after upgrade seals the
// session key as it is, because a new one would make every stored credential unreadable, and mints a
// new signing key, because any agent that ran before could have read the old one. `settle` deletes
// each plain file only once the Node has shown it no longer needs it.

const PLAIN_SESSION_KEY = 'session.key'
const PLAIN_SIGNING_KEY = 'internal-token'
const HEX_KEY = /^[0-9a-fA-F]{64}$/

// `previousSigningKey` is the plain key from before the migration. It lives in the sealed file, not the
// plain one, because an agent can write a plain `internal-token` at any time. Trusting that file would
// let it sign a forged session file that the Node then re-signs with the real key. `settle` drops it
// once the Node has re-signed.
type SealedKeys = { sessionKey: string; signingKey: string; previousSigningKey?: string }

export type NodeKeyCustody = {
  // The keys for the next start, sealing them first when the data root has no sealed file.
  prepare(): NodeKeys
  // After the Node started with `keys`: delete the plain files it has shown it no longer needs.
  settle(keys: NodeKeys, check: NodeKeyCheck): void
}

// `envSessionKey` is SESSION_ENC_KEY from the helper's environment or a `.env` file. It wins over the
// sealed key, as it won over session.key before, so a developer's pinned key keeps working.
export function nodeKeyCustody(dataDir: string, cipher: TokenCipher, envSessionKey?: string): NodeKeyCustody {
  const sealedPath = join(dataDir, SEALED_NODE_KEYS_FILE)

  const readPlain = (name: string): string | undefined => {
    try {
      return readFileSync(join(dataDir, name), 'utf8').trim() || undefined
    } catch {
      return undefined
    }
  }

  // Null for no file. 'unreadable' for a file this data key can't open.
  const unseal = (): SealedKeys | null | 'unreadable' => {
    let body: string
    try {
      body = readFileSync(sealedPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    try {
      const keys = JSON.parse(cipher.decrypt(Buffer.from(body, 'base64'))) as Partial<SealedKeys>
      if (typeof keys.sessionKey === 'string' && HEX_KEY.test(keys.sessionKey) && typeof keys.signingKey === 'string' && keys.signingKey) {
        const previous = typeof keys.previousSigningKey === 'string' && keys.previousSigningKey ? { previousSigningKey: keys.previousSigningKey } : {}
        return { sessionKey: keys.sessionKey, signingKey: keys.signingKey, ...previous }
      }
    } catch {
      // A different data key or a damaged file. The caller decides whether anything can rebuild it.
    }
    return 'unreadable'
  }

  const seal = (keys: SealedKeys): void => {
    // A fresh install seals before the Node has created its root. Same private mode the Node uses.
    mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    writePrivateAtomic(sealedPath, Buffer.from(cipher.encrypt(JSON.stringify(keys))).toString('base64'))
    const back = unseal()
    if (back === null || back === 'unreadable' || JSON.stringify(back) !== JSON.stringify(keys)) {
      rmSync(sealedPath, { force: true })
      throw new Error(`${sealedPath} didn't read back after sealing, so the plain key files stay where they are.`)
    }
  }

  const remove = (name: string): void => {
    try {
      rmSync(join(dataDir, name), { force: true })
      log.info(`removed the plain ${name}; the sealed copy replaces it`)
    } catch (error) {
      log.warn(`could not remove the plain ${name}: ${describeError(error).message}`)
    }
  }

  return {
    prepare() {
      const plainSession = readPlain(PLAIN_SESSION_KEY)
      // The same refusal as the Node's own (node-core server/sessionKey.ts): sealing a damaged key
      // would turn a broken file into credentials nobody can read.
      if (plainSession && !HEX_KEY.test(plainSession)) {
        throw new Error(`${join(dataDir, PLAIN_SESSION_KEY)} does not hold a 64-hex key. Fix or remove it. Minting a second key would orphan every secret encrypted under the first.`)
      }

      let sealed = unseal()
      // Never rebuilt from plain files. An agent can damage this file and plant its own session.key,
      // and a rebuild would seal the agent's key. Deleting the file is the person's decision.
      if (sealed === 'unreadable') {
        throw new Error(`${sealedPath} can't be opened with this app's data key, so the Node's stored credentials can't be read. Restore the "acorn" keychain item, or delete the file to start over. A plain session.key beside it is sealed again.`)
      }
      if (!sealed) {
        const previousSigningKey = readPlain(PLAIN_SIGNING_KEY)
        sealed = {
          sessionKey: envSessionKey ?? plainSession ?? randomBytes(32).toString('hex'),
          signingKey: randomBytes(32).toString('hex'),
          ...(previousSigningKey ? { previousSigningKey } : {}),
        }
        seal(sealed)
      }
      return {
        sessionKey: envSessionKey ?? sealed.sessionKey,
        signingKey: sealed.signingKey,
        ...(sealed.previousSigningKey ? { previousSigningKey: sealed.previousSigningKey } : {}),
      }
    },

    settle(keys, check) {
      // The Node's boot pass has re-signed every session file under the sealed key, so the old
      // signing key has nothing left to do. A plain file is never read again after sealing, so one an
      // agent wrote goes too.
      const sealed = unseal()
      if (sealed && sealed !== 'unreadable' && sealed.previousSigningKey) seal({ sessionKey: sealed.sessionKey, signingKey: sealed.signingKey })
      if (readPlain(PLAIN_SIGNING_KEY)) remove(PLAIN_SIGNING_KEY)
      // The plain session key goes only when it's the key the Node used and that key opened a stored
      // credential, or there was none to open. Anything else keeps it, and the Node records why.
      if (check !== 'failed' && readPlain(PLAIN_SESSION_KEY) === keys.sessionKey) remove(PLAIN_SESSION_KEY)
    },
  }
}
