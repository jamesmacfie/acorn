import { beforeEach, describe, expect, it, vi } from 'vitest'

// idb-keyval over a map. What matters here is what is written, and a CryptoKey kept by reference is
// what IndexedDB's structured clone keeps too.
const db = vi.hoisted(() => ({ rows: new Map<string, unknown>() }))
vi.mock('idb-keyval', () => ({
  createStore: () => 'store',
  get: async (key: string) => db.rows.get(key),
  set: async (key: string, value: unknown) => void db.rows.set(key, value),
  del: async (key: string) => void db.rows.delete(key),
  entries: async () => [...db.rows],
}))

import { forgetPaired, pairedNodes, readToken, renamePaired, savePaired } from './pairedNodes'

const node = (nodeId: string, pairedAt: number) => ({
  nodeId,
  label: `Node ${nodeId}`,
  channelKey: 'cd'.repeat(32),
  pairedAt,
})

beforeEach(() => db.rows.clear())

describe('the Nodes this phone is paired with', () => {
  it('keeps a token as ciphertext under a key the browser won’t hand over, and reads it back', async () => {
    await savePaired(node('n1', 1), 'acorn_dt_secret-token')
    const key = db.rows.get('key') as CryptoKey
    expect(key.extractable).toBe(false)
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM' })

    const record = db.rows.get('node:n1') as { token: { iv: Uint8Array; data: ArrayBuffer } }
    const everything = JSON.stringify(record, (_name, value) =>
      value instanceof ArrayBuffer ? [...new Uint8Array(value)] : value instanceof Uint8Array ? [...value] : value,
    )
    expect(everything).not.toContain('secret-token')
    expect(new TextDecoder().decode(record.token.data)).not.toContain('secret-token')
    expect(await readToken('n1')).toBe('acorn_dt_secret-token')
  })

  it('uses one key for every Node, and a fresh nonce for each token', async () => {
    await savePaired(node('n1', 1), 'one')
    const key = db.rows.get('key')
    await savePaired(node('n2', 2), 'one')
    expect(db.rows.get('key')).toBe(key)
    const nonces = ['n1', 'n2'].map((id) =>
      [...(db.rows.get(`node:${id}`) as { token: { iv: Uint8Array } }).token.iv].join(),
    )
    expect(nonces[0]).not.toBe(nonces[1])
  })

  it('refuses a token moved to another Node’s record', async () => {
    await savePaired(node('n1', 1), 'one')
    await savePaired(node('n2', 2), 'two')
    const moved = { ...(db.rows.get('node:n2') as object), token: (db.rows.get('node:n1') as { token: unknown }).token }
    db.rows.set('node:n2', moved)
    expect(await readToken('n2')).toBeNull()
    expect(await readToken('n1')).toBe('one')
  })

  it('has no token for a Node it was never paired with', async () => {
    expect(await readToken('nobody')).toBeNull()
  })

  it('lists the Nodes in the order they were paired, without their tokens', async () => {
    await savePaired(node('late', 9), 'a')
    await savePaired(node('early', 1), 'b')
    const listed = await pairedNodes()
    expect(listed.map((paired) => paired.nodeId)).toEqual(['early', 'late'])
    expect(JSON.stringify(listed)).not.toContain('token')
  })

  it('renames a Node and forgets one, leaving the others', async () => {
    await savePaired(node('n1', 1), 'one')
    await savePaired(node('n2', 2), 'two')
    await renamePaired('n1', 'Studio')
    expect((await pairedNodes())[0]?.label).toBe('Studio')
    expect(await readToken('n1')).toBe('one')
    await forgetPaired('n1')
    expect((await pairedNodes()).map((paired) => paired.nodeId)).toEqual(['n2'])
    expect(await readToken('n1')).toBeNull()
    expect(await readToken('n2')).toBe('two')
  })
})
