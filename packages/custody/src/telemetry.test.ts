import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeFetchRequest, NodeFetchResponse } from '@acorn/protocol/broker.ts'
import type { PostedTelemetryBatch, TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { flushTelemetry, startTelemetry } from '@acorn/node-core/server/telemetry/collector.ts'
import type { NodeBroker } from './broker/nodeBroker'
import { _resetHelperMarks, helperMark } from './bootMarks'
import { recordCrash } from './supervision/crashBudget'
import { startHelperTelemetry, type HelperTelemetry } from './telemetry'

// What the helper reports and how it leaves (docs/shell.md § What the helper reports).
//
// The broker is a stub rather than a real socket: what is under test is which batches this builds
// and when, and `nodeBroker.test.ts` already drives the real one against a real server.

type Posted = { runtime: string; records: TelemetryRecord[] }

let root: string
let posted: Posted[]
let prefValue: string
let telemetry: HelperTelemetry | null

/** A broker that answers the two routes this module calls and nothing else. */
const stubBroker = (): NodeBroker => ({
  fetch: async (_nodeId: string, request: NodeFetchRequest): Promise<NodeFetchResponse> => {
    const encode = (text: string) => new TextEncoder().encode(text)
    if (request.method === 'GET') {
      return { status: 200, headers: {}, body: encode(JSON.stringify({ 'telemetry.enabled': prefValue })) }
    }
    const body = request.body as { kind: 'bytes'; bytes: Uint8Array }
    const batch = JSON.parse(new TextDecoder().decode(body.bytes)) as PostedTelemetryBatch
    posted.push({ runtime: batch.runtime, records: batch.records })
    return { status: 202, headers: {}, body: encode('{"accepted":1}') }
  },
} as unknown as NodeBroker)

/** Turn the switch on and let the poll, the first flush and the post settle. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 6; turn += 1) await new Promise((done) => setTimeout(done, 1))
  flushTelemetry()
  for (let turn = 0; turn < 6; turn += 1) await new Promise((done) => setTimeout(done, 1))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acorn-helper-telemetry-'))
  posted = []
  prefValue = '1'
  telemetry = null
  _resetHelperMarks()
  startTelemetry({ node: 'test', version: '0' })
})

afterEach(() => {
  telemetry?.dispose()
  // Off again, so a case here cannot leave the collector armed for the next file in the process.
  startTelemetry({ node: 'test', version: '0' })
  rmSync(root, { recursive: true, force: true })
})

const start = async (): Promise<void> => {
  telemetry = startHelperTelemetry({ broker: stubBroker(), userDataDir: root, version: '1.2.3' })
  telemetry.setNode('n1')
  await settle()
}

const records = (runtime: string): TelemetryRecord[] => posted.filter((batch) => batch.runtime === runtime).flatMap((batch) => batch.records)

describe('the boot account', () => {
  it('becomes one root span with a child per mark, in the order they were taken', async () => {
    helperMark('handshake')
    helperMark('plugin-cache sweep')
    helperMark('ws bound')
    await start()

    const spans = records('helper').filter((record) => record.kind === 'span')
    const root_ = spans.find((span) => span.kind === 'span' && span.name === 'helper.boot')
    expect(root_, 'no helper.boot root').toBeDefined()
    const children = spans.filter((span) => span.kind === 'span' && span.name === 'helper.boot.mark')
    expect(children.map((span) => (span.kind === 'span' ? span.attrs.mark : null))).toEqual([
      'handshake',
      'plugin-cache sweep',
      'ws bound',
    ])
    for (const child of children) {
      if (child.kind !== 'span' || root_?.kind !== 'span') throw new Error('not a span')
      expect(child.traceId).toBe(root_.traceId)
      expect(child.parentSpanId).toBe(root_.spanId)
    }
  })

  it('posts nothing at all while the preference says no', async () => {
    prefValue = '0'
    helperMark('handshake')
    await start()
    expect(posted).toEqual([])
  })
})

describe('the crash budget', () => {
  it('raises an event per crash and a fatal error when the budget is spent', async () => {
    await start()
    const times: number[] = []
    const now = Date.now()
    for (let crash = 0; crash < 6; crash += 1) recordCrash(times, now + crash)
    await settle()

    const helper = records('helper')
    // Five permitted crashes, and the sixth is the one that stops the app trying.
    expect(helper.filter((record) => record.kind === 'event' && record.name === 'node.crash')).toHaveLength(5)
    const fatal = helper.filter((record) => record.kind === 'error' && record.level === 'fatal')
    expect(fatal).toHaveLength(1)
    expect(fatal[0]!.kind === 'error' && fatal[0].attrs.seam).toBe('node.crash')
  })
})

describe("the shell's crash file", () => {
  const panic = {
    at: Date.now(),
    name: 'ShellPanic',
    message: 'the window went away',
    stack: 'src/lib.rs:12:9',
    level: 'fatal',
    handled: false,
    attrs: { seam: 'shell.panic', thread: 'main', 'app.version': '1.2.3', location: 'src/lib.rs:12:9' },
  }

  it('reaches the node as one fatal error under the shell runtime, and the file is gone', async () => {
    writeFileSync(join(root, 'shell-crash.json'), JSON.stringify(panic))
    await start()

    const shell = records('shell')
    expect(shell).toHaveLength(1)
    expect(shell[0]!.kind).toBe('error')
    expect(shell[0]!.kind === 'error' && shell[0].level).toBe('fatal')
    expect(shell[0]!.kind === 'error' && shell[0].message).toBe('the window went away')
    expect(shell[0]!.attrs.seam).toBe('shell.panic')
    // Its own batch. The node re-stamps the runtime from the batch onto every record in it, so the
    // helper's own records must not travel with the shell's.
    expect(posted.filter((batch) => batch.runtime === 'shell')).toHaveLength(1)
    expect(existsSync(join(root, 'shell-crash.json'))).toBe(false)
  })

  it('deletes a record it cannot read rather than re-reading it every boot', async () => {
    writeFileSync(join(root, 'shell-crash.json'), '{"level":"catastrophic"}')
    await start()
    expect(records('shell')).toEqual([])
    expect(existsSync(join(root, 'shell-crash.json'))).toBe(false)
  })

  it('is not read at all while the preference says no', async () => {
    prefValue = '0'
    writeFileSync(join(root, 'shell-crash.json'), JSON.stringify(panic))
    await start()
    expect(existsSync(join(root, 'shell-crash.json'))).toBe(true)
  })
})


it('contains a crash file truncated during a shell panic', async () => {
  writeFileSync(join(root, 'shell-crash.json'), '{"message":')
  await start()
  expect(records('shell')).toEqual([])
  expect(existsSync(join(root, 'shell-crash.json'))).toBe(false)
})
