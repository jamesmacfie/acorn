import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SEALED_NODE_KEYS_FILE } from '@acorn/protocol/serviceProtocol.ts'
import { nodeKeyCustody } from './nodeKeys'
import type { TokenCipher } from './deviceTokenStore'

// The same AES-256-GCM shape the desktop helper builds over its keychain data key.
const cipherFor = (key: Buffer): TokenCipher => ({
  available: () => true,
  encrypt: (value) => {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), body])
  },
  decrypt: (blob) => {
    const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12))
    decipher.setAuthTag(blob.subarray(12, 28))
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8')
  },
})

const roots: string[] = []
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-node-keys-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const SESSION = 'a'.repeat(64)
const OLD_SIGNING = 'old-signing-key-from-before-the-upgrade'
const upgraded = (): string => {
  const dir = root()
  writeFileSync(join(dir, 'session.key'), `${SESSION}\n`)
  writeFileSync(join(dir, 'internal-token'), OLD_SIGNING)
  return dir
}
const dataKey = randomBytes(32)

describe('node key custody', () => {
  it('seals a fresh install without writing a plain key', () => {
    // The Node creates its root on first start, which is after the helper seals.
    const dir = join(root(), 'node')
    const custody = nodeKeyCustody(dir, cipherFor(dataKey))
    const keys = custody.prepare()
    expect(keys.sessionKey).toMatch(/^[0-9a-f]{64}$/)
    custody.settle(keys, 'none')
    expect(readdirSync(dir)).toEqual([SEALED_NODE_KEYS_FILE])
    // Neither key appears in the file in plain form, and the next start gets the same pair.
    const sealed = readFileSync(join(dir, SEALED_NODE_KEYS_FILE), 'utf8')
    expect(sealed).not.toContain(keys.sessionKey)
    expect(sealed).not.toContain(keys.signingKey)
    expect(nodeKeyCustody(dir, cipherFor(dataKey)).prepare()).toEqual(keys)
  })

  it('upgrades by sealing the old session key, rotating the signing key, then deleting both plain files', () => {
    const dir = upgraded()
    const custody = nodeKeyCustody(dir, cipherFor(dataKey))
    const keys = custody.prepare()
    expect(keys.sessionKey).toBe(SESSION)
    // A new signing key, and the old one isn't passed on: nothing re-signs with it.
    expect(keys).toEqual({ sessionKey: SESSION, signingKey: expect.not.stringMatching(OLD_SIGNING) })
    // Nothing is deleted before the Node has started and answered.
    expect(existsSync(join(dir, 'session.key'))).toBe(true)
    expect(existsSync(join(dir, 'internal-token'))).toBe(true)

    custody.settle(keys, 'ok')
    expect(readdirSync(dir)).toEqual([SEALED_NODE_KEYS_FILE])
    expect(nodeKeyCustody(dir, cipherFor(dataKey)).prepare()).toEqual({
      sessionKey: SESSION,
      signingKey: keys.signingKey,
    })
  })

  it('finishes the same migration after a crash between sealing and deleting', () => {
    const dir = upgraded()
    const first = nodeKeyCustody(dir, cipherFor(dataKey)).prepare()
    // The helper died here: sealed file written, the Node never answered, both plain files remain.
    const custody = nodeKeyCustody(dir, cipherFor(dataKey))
    const again = custody.prepare()
    expect(again).toEqual(first)
    custody.settle(again, 'ok')
    expect(readdirSync(dir)).toEqual([SEALED_NODE_KEYS_FILE])
  })

  it('keeps the plain session key when the Node could not open a credential with it', () => {
    const dir = upgraded()
    const custody = nodeKeyCustody(dir, cipherFor(dataKey))
    const keys = custody.prepare()
    custody.settle(keys, 'failed')
    expect(readFileSync(join(dir, 'session.key'), 'utf8').trim()).toBe(SESSION)
    // The signing key is spent either way: the Node re-signed its session files at boot.
    expect(existsSync(join(dir, 'internal-token'))).toBe(false)
  })

  it('refuses a sealed file this data key cannot open, even with a plain session key beside it', () => {
    const dir = upgraded()
    nodeKeyCustody(dir, cipherFor(dataKey)).prepare()
    // The keychain item was lost, or an agent damaged the file and planted its own session.key.
    // Either way, sealing whatever plain key is there would be the wrong answer.
    writeFileSync(join(dir, 'session.key'), `${'d'.repeat(64)}\n`)
    expect(() => nodeKeyCustody(dir, cipherFor(randomBytes(32))).prepare()).toThrow(
      /can't be opened with this app's data key/,
    )
    writeFileSync(join(dir, SEALED_NODE_KEYS_FILE), 'damaged')
    expect(() => nodeKeyCustody(dir, cipherFor(dataKey)).prepare()).toThrow(/can't be opened with this app's data key/)
  })

  it('never reads a plain signing key, so one an agent writes signs nothing the Node trusts', () => {
    const dir = upgraded()
    const custody = nodeKeyCustody(dir, cipherFor(dataKey))
    const sealed = custody.prepare()
    custody.settle(sealed, 'ok')
    // Planted after the migration, or with the sealed file deleted to make the next start look like one.
    writeFileSync(join(dir, 'internal-token'), 'agent-chosen-signing-key')
    expect(nodeKeyCustody(dir, cipherFor(dataKey)).prepare()).toEqual(sealed)
    rmSync(join(dir, SEALED_NODE_KEYS_FILE))
    const reset = nodeKeyCustody(dir, cipherFor(dataKey))
    const keys = reset.prepare()
    expect(Object.values(keys)).not.toContain('agent-chosen-signing-key')
    reset.settle(keys, 'none')
    expect(existsSync(join(dir, 'internal-token'))).toBe(false)
  })

  it('lets a developer key from the environment win, and keeps a plain key it never used', () => {
    const dir = upgraded()
    const pinned = 'b'.repeat(64)
    const custody = nodeKeyCustody(dir, cipherFor(dataKey), pinned)
    const keys = custody.prepare()
    expect(keys.sessionKey).toBe(pinned)
    custody.settle(keys, 'ok')
    expect(readFileSync(join(dir, 'session.key'), 'utf8').trim()).toBe(SESSION)
  })

  it('refuses a damaged plain session key rather than sealing it', () => {
    const dir = root()
    writeFileSync(join(dir, 'session.key'), 'truncated')
    expect(() => nodeKeyCustody(dir, cipherFor(dataKey)).prepare()).toThrow(/64-hex/)
    expect(existsSync(join(dir, SEALED_NODE_KEYS_FILE))).toBe(false)
  })
})
