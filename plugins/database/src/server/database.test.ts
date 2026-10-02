import { expect, it, vi } from 'vitest'
import { databaseBridge, type DatabaseCoreServices } from './database'

it.each(['connect', 'schema'] as const)('retires a pending %s before disposal and never republishes connection state', async (method) => {
  let release!: (value: unknown) => void
  const pending = new Promise(resolve => { release = resolve })
  const disconnect = vi.fn(async () => {})
  const data = { connect: () => pending, schema: () => pending, disconnect } as unknown as DatabaseCoreServices['data']
  const bridge = databaseBridge({ data })
  const request = bridge[method]('task')
  await bridge.dispose(); await bridge.dispose()
  expect(disconnect).toHaveBeenCalledExactlyOnceWith('task')
  release(method === 'connect' ? { database: 'fixture' } : { text: 'fixture', source: 'file' })
  expect(await request).toHaveProperty('error', 'Database connection retired.')
  expect(await bridge.tables('task')).toEqual({ error: 'Not connected.' })
  expect(await bridge.connect('task')).toEqual({ ok: false, error: 'Database plugin disposed.' })
})

it('does not let a held connect overwrite the state after disconnect and reconnect', async () => {
  let release!: (value: { database: string }) => void
  const pending = new Promise<{ database: string }>(resolve => { release = resolve })
  const connect = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ database: 'replacement' })
  const disconnect = vi.fn(async () => {})
  const catalog = vi.fn(async () => [])
  const bridge = databaseBridge({ data: { connect, disconnect, catalog } as unknown as DatabaseCoreServices['data'] })
  const old = bridge.connect('task')
  await bridge.disconnect('task')
  expect(await bridge.connect('task')).toEqual({ ok: true, database: 'replacement' })
  release({ database: 'old' })
  expect(await old).toEqual({ ok: false, error: 'Database connection retired.' })
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(await bridge.tables('task')).toEqual({ tables: [] })
  await bridge.dispose()
  expect(disconnect).toHaveBeenCalledTimes(2)
})


it.each(['dispose', 'reconnect'] as const)('refuses late row and write admission after %s while another consumer holds the catalog', async (action) => {
  let release!: (value: unknown) => void
  const pending = new Promise(resolve => { release = resolve })
  const query = vi.fn(async () => { throw new Error('Unexpected query') })
  const data = {
    connect: async () => ({ database: 'fixture' }), disconnect: async () => {}, catalog: () => pending, query,
  } as unknown as DatabaseCoreServices['data']
  const bridge = databaseBridge({ data })
  await bridge.connect('task')
  const requests = [
    bridge.rows('task', 'public', 't'),
    bridge.update('task', 'public', 't', 'v', 'x', { id: '1' }),
    bridge.insert('task', 'public', 't', { v: 'x' }),
    bridge.remove('task', 'public', 't', { id: '1' }),
  ]
  if (action === 'dispose') await bridge.dispose()
  else { await bridge.disconnect('task'); await bridge.connect('task') }
  release([{ schema: 'public', name: 't', columns: [{ name: 'id', isPk: true }, { name: 'v' }] }])
  for (const result of await Promise.all(requests)) expect(result).toHaveProperty('error', 'Database connection retired.')
  expect(query).not.toHaveBeenCalled()
  await bridge.dispose()
})
