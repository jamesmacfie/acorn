import { existsSync, writeFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'
import { makeTestPluginDb } from '../../packages/plugin-api/src/testkit'
import type { PluginRequestContext } from '@acorn/plugin-api/node'
import { MAX_DOCUMENT_BYTES } from '@acorn/protocol/plugin/bridge.ts'
import { createDatabaseFetch } from '../../plugins/database/src/server/routes/database'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()))

it('characterizes UTF8 scratch limits and an edit beyond the write limit', async () => {
  const plugin = makeTestPluginDb('database')
  cleanups.push(plugin.cleanup)
  const core = { tasks: { load: async () => ({ id: 'task', projectId: 'project' }) } }
  const fetch = createDatabaseFetch(plugin.db, core as Parameters<typeof createDatabaseFetch>[1], {} as Parameters<typeof createDatabaseFetch>[2])
  const context = { userId: 'synthetic', principal: { kind: 'device', userId: 'synthetic' } } as PluginRequestContext
  const path = 'http://synthetic/tasks/task/scratch'
  const put = (text: string) => fetch(new Request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }), context)
  const read = async () => (await (await fetch(new Request(path), context)).json() as { text: string }).text

  const unicode = 'é'.repeat(MAX_DOCUMENT_BYTES)
  const accepted = await put(unicode)
  const unicodeRead = await read()
  const ascii = 'x'.repeat(MAX_DOCUMENT_BYTES)
  const acceptedAscii = await put(ascii)
  const edited = await put(ascii + 'x')
  const afterFailedEdit = await read()
  const output = {
    owner: 'actual portable Database scratch route and disposable plugin SQLite; no PostgreSQL',
    documentByteCap: MAX_DOCUMENT_BYTES,
    unicode: { characters: unicode.length, bytes: Buffer.byteLength(unicode), writeStatus: accepted.status,
      readBytes: Buffer.byteLength(unicodeRead), hostByteGateWouldRefuse: Buffer.byteLength(unicodeRead) > MAX_DOCUMENT_BYTES },
    ascii: { acceptedStatus: acceptedAscii.status, acceptedBytes: Buffer.byteLength(ascii), editedBytes: Buffer.byteLength(ascii + 'x'),
      editedStatus: edited.status, storedBytesAfterFailedEdit: Buffer.byteLength(afterFailedEdit), editRetainedAtNode: afterFailedEdit === ascii + 'x' },
  }
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'
  const destination = new URL(`13-scratch-${tag}.json`, import.meta.url)
  if (tag.startsWith('before') && existsSync(destination)) throw new Error('Use another before tag.')
  writeFileSync(destination, JSON.stringify(output, null, 2) + '\n')
  expect(accepted.status).toBe(200)
  expect(Buffer.byteLength(unicodeRead)).toBe(2 * MAX_DOCUMENT_BYTES)
  expect(edited.status).toBe(400)
  expect(afterFailedEdit).toBe(ascii)
})
