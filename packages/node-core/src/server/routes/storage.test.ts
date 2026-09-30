import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeStorageReport } from '@acorn/protocol/api.ts'
import type { AppEnv, Principal } from '../middleware/auth'
import { requireDevice } from '../middleware/requireUser'
import { requestIdMiddleware } from '../respond'
import type { Env } from '../bindings'
import { nodeStorageReport } from '../storage/footprint'
import { storage } from './storage'

// The same envelope server/index.ts mounts, so the refusal can be driven with either principal.
// mountCoverage.test.ts is what proves the real mount stayed gated.
const DEVICE: Principal = { kind: 'device', userId: 'u1', deviceId: 'd1' }
const AGENT: Principal = { kind: 'internal', userId: 'u1', scope: 'task', taskId: 't1' }

const get = (principal: Principal, dataDir: string) =>
  new Hono<AppEnv>()
    .use('*', requestIdMiddleware)
    .use('*', async (c, next) => {
      c.set('principal', principal)
      await next()
    })
    .use('/v1/core/storage', requireDevice)
    .route('/v1/core/storage', storage)
    .fetch(new Request('http://acorn.test/v1/core/storage'), { DATA_DIR: dataDir } as Env)

const bytes = (path: string, size: number) => writeFileSync(path, Buffer.alloc(size))

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'acorn-storage-'))
  bytes(join(dataDir, 'core.sqlite'), 4096)
  bytes(join(dataDir, 'core.sqlite-wal'), 1000)
  mkdirSync(join(dataDir, 'plugins', 'rollbar'), { recursive: true })
  bytes(join(dataDir, 'plugins', 'agents.sqlite'), 8192)
  bytes(join(dataDir, 'plugins', 'agents.sqlite-wal'), 2000)
  bytes(join(dataDir, 'plugins', 'agents.sqlite-shm'), 32)
  bytes(join(dataDir, 'plugins', 'github.sqlite'), 4096)
  // An installed package, which is not a database however large it is.
  bytes(join(dataDir, 'plugins', 'rollbar', 'index.js'), 50_000)
  mkdirSync(join(dataDir, 'blobs', 'ab'), { recursive: true })
  bytes(join(dataDir, 'blobs', 'ab', 'one'), 300)
  bytes(join(dataDir, 'blobs', 'two'), 200)
})
afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

describe('GET /v1/core/storage', () => {
  it('reports memory, each database with its WAL, and the blob cache, but not plugin packages', async () => {
    const response = await get(DEVICE, dataDir)
    expect(response.status).toBe(200)
    const report = await response.json() as NodeStorageReport
    expect(report.rssBytes).toBeGreaterThan(0)
    expect(report).toMatchObject({
      coreDatabaseBytes: 5096,
      pluginDatabases: [{ plugin: 'agents', bytes: 10_224 }, { plugin: 'github', bytes: 4096 }],
      blobCacheBytes: 500,
    })
  })

  it('refuses a task-scoped agent', async () => {
    expect((await get(AGENT, dataDir)).status).toBe(403)
  })

  it('reuses a disk measurement for 30 seconds, so polling does not walk the blob cache each time', async () => {
    expect((await nodeStorageReport(dataDir, 1_000)).blobCacheBytes).toBe(500)
    bytes(join(dataDir, 'blobs', 'three'), 100)
    expect((await nodeStorageReport(dataDir, 20_000)).blobCacheBytes).toBe(500)
    expect((await nodeStorageReport(dataDir, 31_000)).blobCacheBytes).toBe(600)
  })
})
