import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodesFileProvider } from './provider'

// The reference provider, which is also the seam's only consumer until the cloud plugin exists.
//
// The assertion that matters most is the last one: `list` never returns a device token in the shape the
// wire projection would carry. Everything else is a file being read and written.

const FINGERPRINT = 'b'.repeat(64)
const signal = new AbortController().signal

describe('nodesFileProvider', () => {
  let dir = ''
  let path = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-nodes-file-'))
    path = join(dir, 'nodes.json')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads an empty inventory from a file that is not there', async () => {
    // Not an error. A provider that reported one until somebody created a file would read as broken
    // rather than empty, and the fleet surface would show a banner for a normal state.
    await expect(nodesFileProvider(path).list(signal)).resolves.toEqual([])
  })

  it('lists what the file says, filling the absent fields with null', async () => {
    writeFileSync(path, JSON.stringify({
      nodes: [
        { providerNodeId: 'cloud-1', nodeId: '11111111-1111-4111-8111-111111111111', label: 'Big box', endpoint: 'https://big.example:4317', fingerprint: FINGERPRINT, deviceToken: 'acorn_dt_x' },
        { providerNodeId: 'cloud-2', label: 'Half-built', state: 'provisioning' },
      ],
    }))
    const listed = await nodesFileProvider(path).list(signal)
    expect(listed).toEqual([
      {
        providerNodeId: 'cloud-1',
        nodeId: '11111111-1111-4111-8111-111111111111',
        label: 'Big box',
        endpoint: 'https://big.example:4317',
        fingerprint: FINGERPRINT,
        // The file omitted `state`, and `ready` is the default: a node written down by hand is a node
        // somebody expects to work.
        state: 'ready',
        enrollment: { deviceToken: 'acorn_dt_x' },
      },
      { providerNodeId: 'cloud-2', nodeId: null, label: 'Half-built', endpoint: null, fingerprint: null, state: 'provisioning' },
    ])
  })

  it('says what is wrong with a file it cannot use', async () => {
    writeFileSync(path, JSON.stringify({ nodes: [{ label: 'no id' }] }))
    await expect(nodesFileProvider(path).list(signal)).rejects.toThrow(/not a usable node list/)
  })

  it('creates a node as provisioning, then destroys it', async () => {
    const provider = nodesFileProvider(path)
    const created = await provider.create!({ label: 'New one', options: {} }, signal)
    // No endpoint: this provider records the intent and builds nothing, which is the honest shape for a
    // file and still exercises the state a real provider spends its first minute in.
    expect(created).toMatchObject({ label: 'New one', state: 'provisioning', endpoint: null, nodeId: null })
    expect(await provider.list(signal)).toHaveLength(1)

    await provider.destroy!(created.providerNodeId, signal)
    expect(await provider.list(signal)).toEqual([])
    // Written back as a whole file, so what is left is readable rather than a truncated tail.
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ nodes: [] })
  })

  it('stops and starts a node, and refuses a node it does not list', async () => {
    const provider = nodesFileProvider(path)
    const created = await provider.create!({ label: 'New one', options: {} }, signal)
    await provider.start!(created.providerNodeId, signal)
    expect((await provider.list(signal))[0]!.state).toBe('ready')
    await provider.stop!(created.providerNodeId, signal)
    expect((await provider.list(signal))[0]!.state).toBe('stopped')
    await expect(provider.stop!('nope', signal)).rejects.toThrow(/lists no node/)
  })
})
