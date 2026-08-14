import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown
  const invoke = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => invoke.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => invoke.delete(channel)),
  }
  return { invoke, ipcMain }
})

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }))

const { PLUGINS_TRUST_RECORD, registerPluginIpc } = await import('./pluginIpc')
const { PluginTrustStore } = await import('./pluginTrustStore')

// Recording a trust decision must not be defeatable by a node running a newer manifest schema than
// this shell. It used to be: one combined schema meant an unparseable disclosure threw before
// `trust.record` ran, so neither arm of the prompt could be answered and it re-queued on every boot.

const HASH = 'a'.repeat(64)
const NONE = { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } }

let dir = ''
let trust: InstanceType<typeof PluginTrustStore>
let dispose = () => {}

// Only the two members the handler touches.
const cache = { has: () => true } as unknown as Parameters<typeof registerPluginIpc>[0]

const record = async (raw: unknown): Promise<void> => {
  await electron.invoke.get(PLUGINS_TRUST_RECORD)!({}, raw)
}

const decision = (over: Record<string, unknown> = {}) => ({
  pluginId: 'sparkline',
  hash: HASH,
  nodeId: 'node-a',
  version: '1.0.0',
  permissions: NONE,
  webviews: [],
  keyClaims: [],
  decision: 'accepted',
  ...over,
})

beforeEach(() => {
  electron.invoke.clear()
  dir = mkdtempSync(join(tmpdir(), 'acorn-plugin-ipc-'))
  trust = new PluginTrustStore(dir)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  dispose = registerPluginIpc(cache, trust)
})

afterEach(() => {
  dispose()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('recording a trust decision', () => {
  it('stores the disclosure when it parses', async () => {
    await record(decision({ webviews: [{ surface: 'docs', label: 'Docs', hosts: ['docs.example.com'] }] }))
    const ack = trust.decisionFor('sparkline', HASH)
    expect(ack).toMatchObject({ decision: 'accepted' })
    expect(ack?.webviews).toEqual([{ surface: 'docs', label: 'Docs', hosts: ['docs.example.com'] }])
    expect(ack?.partial).toBeUndefined()
  })

  it('still records a REJECTION when the disclosure is from a newer schema', async () => {
    // The one that hurts most to lose. Without a recorded rejection the plugin the owner explicitly
    // turned away asks again on every boot, forever.
    await record(decision({ decision: 'rejected', webviews: [{ surface: 'docs', label: 'Docs', hosts: ['x.example.com'], mode: 'strict' }] }))
    expect(trust.decisionFor('sparkline', HASH)).toMatchObject({ decision: 'rejected', partial: true })
  })

  it('still records an ACCEPTANCE when the disclosure is from a newer schema, marked partial', async () => {
    // The lines the owner actually read were rendered from the roster row, and the renderer already
    // folds anything it does not recognise into its own "requests this version of acorn does not
    // recognise" line — so the consent was informed. What is lost is only the stored snapshot.
    await record(decision({ permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: 'yes', net: [] } } }))
    const ack = trust.decisionFor('sparkline', HASH)
    expect(ack).toMatchObject({ decision: 'accepted', partial: true })
    // Nothing invented: the snapshot is empty rather than half-guessed.
    expect(ack?.permissions).toEqual(NONE)
    // And it can never become a "what changed" baseline.
    expect(trust.previousFor('sparkline', 'b'.repeat(64))).toBeUndefined()
  })

  it('refuses a decision whose identity half is malformed', async () => {
    // This half is entirely our own vocabulary, so nothing a node does can make it unparseable — a
    // bad one is a renderer bug, and storing it would leave a row nothing can ever match.
    await expect(record(decision({ hash: 'not-a-hash' }))).rejects.toThrow()
    expect(trust.list()).toEqual([])
  })

  it('refuses a decision about a bundle this device does not hold', async () => {
    dispose()
    dispose = registerPluginIpc({ has: () => false } as unknown as Parameters<typeof registerPluginIpc>[0], trust)
    await expect(record(decision())).rejects.toThrow(/No cached bundle/)
    expect(trust.list()).toEqual([])
  })
})
