import { createPrivateKey, generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHANNEL_DIR = 'channel'
const KEY_FILE = 'key.pem'

// The Node's identity for a phone's encrypted channel (docs/relay/phone-channel.md): an Ed25519 key pair
// kept beside its TLS key. A phone pins the public half, which the Node registers with its account when
// remote access is turned on. It has to be made with no channel library, because registering is account
// code and the channel's code loads only when a phone connects.
export type ChannelKey = { seed: Buffer; publicKey: Buffer }

export function ensureChannelKey(root: string): ChannelKey {
  const dir = join(root, CHANNEL_DIR)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const path = join(dir, KEY_FILE)
  if (!existsSync(path)) {
    const { privateKey } = generateKeyPairSync('ed25519')
    writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  }
  chmodSync(path, 0o600)
  const jwk = createPrivateKey(readFileSync(path, 'utf8')).export({ format: 'jwk' })
  return { seed: Buffer.from(jwk.d!, 'base64url'), publicKey: Buffer.from(jwk.x!, 'base64url') }
}

/** The public key as the account API and a phone write it: 64 lowercase hex characters. */
export const channelPublicKey = (root: string): string => ensureChannelKey(root).publicKey.toString('hex')
