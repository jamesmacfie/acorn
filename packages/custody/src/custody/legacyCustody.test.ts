import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deviceTokens, type TokenCipher } from './deviceTokenStore'
import { adoptLegacyCustody } from './legacyCustody'

// The one-time adoption of an Electron build's custody root. The interesting part is that it decrypts
// under Chromium's os_crypt and re-encrypts under this shell's own cipher, so the test writes real
// os_crypt blobs rather than a stand-in: a derivation constant that drifted would otherwise pass.

const PASSWORD = 'a-safe-storage-password'

// The Electron side of the boundary: exactly what `safeStorage.encryptString` writes on macOS.
const osCryptEncrypt = (value: string): Buffer => {
  const key = pbkdf2Sync(PASSWORD, 'saltysalt', 1003, 16, 'sha1')
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
  return Buffer.concat([Buffer.from('v10'), cipher.update(value, 'utf8'), cipher.final()])
}

// A stand-in for the Tauri helper's AES-256-GCM under the key Rust holds. Reversible and obviously
// not os_crypt, which is what makes "the token was re-encrypted" observable.
const key = randomBytes(1)[0]
const xor = (bytes: Buffer): Buffer => Buffer.from(bytes.map((byte) => byte ^ key))
const cipher: TokenCipher = {
  available: () => true,
  encrypt: (value) => Buffer.concat([Buffer.from('gcm:'), xor(Buffer.from(value, 'utf8'))]),
  decrypt: (blob) => xor(Buffer.from(blob.subarray(4))).toString('utf8'),
}

let legacyDir: string
let userDataDir: string

beforeEach(() => {
  legacyDir = mkdtempSync(join(tmpdir(), 'acorn-legacy-'))
  userDataDir = mkdtempSync(join(tmpdir(), 'acorn-custody-'))
  writeFileSync(join(legacyDir, 'fleet.json'), '{"version":1,"nodes":[]}')
  writeFileSync(join(legacyDir, 'plugin-trust.json'), '{"version":1,"acks":[]}')
  mkdirSync(join(legacyDir, 'plugin-cache'), { recursive: true })
  writeFileSync(join(legacyDir, 'plugin-cache', 'index.json'), '{"version":1,"entries":{}}')
  writeFileSync(join(legacyDir, 'device-token-local'), osCryptEncrypt('local-token'))
  writeFileSync(join(legacyDir, 'device-token-node-2'), osCryptEncrypt('remote-token'))
})
afterEach(() => {
  for (const dir of [legacyDir, userDataDir]) rmSync(dir, { recursive: true, force: true })
})

const adopt = (safeStorageKey = PASSWORD): void => adoptLegacyCustody(userDataDir, cipher, { userDataDir: legacyDir, safeStorageKey })

describe('adopting an Electron build custody root', () => {
  it('copies the fleet, the trust store and the cache, and re-encrypts every token', () => {
    adopt()

    // The tokens are worthless without the rows that name their nodes, which is why this copies the
    // whole root rather than only the secrets.
    expect(readFileSync(join(userDataDir, 'fleet.json'), 'utf8')).toBe('{"version":1,"nodes":[]}')
    expect(existsSync(join(userDataDir, 'plugin-trust.json'))).toBe(true)
    expect(existsSync(join(userDataDir, 'plugin-cache', 'index.json'))).toBe(true)

    const tokens = deviceTokens(userDataDir, cipher)
    expect(tokens.read('local')).toBe('local-token')
    expect(tokens.read('node-2')).toBe('remote-token')
    // Re-encrypted, not copied: the legacy blob would not decrypt under this cipher.
    expect(readFileSync(join(userDataDir, 'device-token-local')).subarray(0, 4).toString()).toBe('gcm:')
  })

  it('leaves an owner who already has a fleet of their own alone', () => {
    writeFileSync(join(userDataDir, 'fleet.json'), '{"version":1,"nodes":["mine"]}')
    adopt()

    expect(readFileSync(join(userDataDir, 'fleet.json'), 'utf8')).toBe('{"version":1,"nodes":["mine"]}')
    expect(deviceTokens(userDataDir, cipher).read('local')).toBeUndefined()
  })

  it('does nothing when there is no Electron root to adopt', () => {
    rmSync(join(legacyDir, 'fleet.json'))
    adopt()

    expect(existsSync(join(userDataDir, 'fleet.json'))).toBe(false)
  })

  it('takes the fleet even when the key no longer opens the tokens, so the owner can re-pair', () => {
    // The realistic failure: a rebuilt or re-signed Electron app left a keychain item that no longer
    // matches its blobs. Forgetting the tokens is the supported outcome; forgetting the fleet as well
    // would mean the owner cannot even see which nodes to pair again.
    adopt('the-wrong-password')

    expect(existsSync(join(userDataDir, 'fleet.json'))).toBe(true)
    expect(deviceTokens(userDataDir, cipher).read('local')).toBeUndefined()
  })
})
