import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { openDataRoot } from './dataRoot'
import { readNodeRelay, recordNodeRelay } from './nodeRelay'

const CREDENTIAL = 'decoy-relay-credential'
const relay = { url: 'wss://relay.example', credential: CREDENTIAL }
const owner = {
  accountId: 'acct_1',
  keys: { keys: [{ kty: 'OKP' as const, crv: 'Ed25519' as const, x: 'x', kid: 'k1' }] },
}
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function freshRoot(identity: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-node-relay-'))
  dirs.push(dir)
  const base = { baseline: ACORN_BASELINE, nodeId: randomUUID(), createdAt: 1 }
  writeFileSync(join(dir, 'node.json'), JSON.stringify({ ...base, ...identity }))
  return dir
}
const nodeJson = (dir: string) => readFileSync(join(dir, 'node.json'), 'utf8')

// A read-blocked agent's shell may read node.json, so Remote access's credential lives elsewhere.
describe('the relay Remote access records', () => {
  it('stays out of node.json, in a file only this user can read', () => {
    const dir = freshRoot()
    recordNodeRelay(dir, { relay, owner })
    recordNodeRelay(dir, { previews: true })
    expect(nodeJson(dir)).not.toContain(CREDENTIAL)
    expect(JSON.parse(nodeJson(dir))).toMatchObject({ previews: true })
    expect(statSync(join(dir, 'relay.json')).mode & 0o777).toBe(0o600)
    expect(readNodeRelay(dir)).toEqual({ relay, owner, previews: true })

    recordNodeRelay(dir, { relay: undefined, owner: undefined, previews: undefined })
    expect(readNodeRelay(dir)).toEqual({})
    expect(readFileSync(join(dir, 'relay.json'), 'utf8')).not.toContain(CREDENTIAL)
  })

  it('still reads a relay written by hand into node.json, with no owner', () => {
    const dir = freshRoot({ relay })
    expect(readNodeRelay(dir)).toEqual({ relay })
    openDataRoot(dir).release()
    expect(JSON.parse(nodeJson(dir))).toMatchObject({ relay })
  })

  it('moves a relay recorded with an owner out of node.json when the root opens', () => {
    const dir = freshRoot({ relay, owner, previews: true })
    openDataRoot(dir).release()
    expect(nodeJson(dir)).not.toContain(CREDENTIAL)
    expect(JSON.parse(nodeJson(dir))).not.toHaveProperty('owner')
    expect(statSync(join(dir, 'relay.json')).mode & 0o777).toBe(0o600)
    expect(readNodeRelay(dir)).toEqual({ relay, owner, previews: true })
  })
})
