import { createHash } from 'node:crypto'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { sql } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { makeTestNodeContext } from '../../packages/node-core/src/testkit/pluginContext'
import { AgentStore } from '../../plugins/agents/src/server/sessions/store'

it('measures committed stream writes and current search at three read cadences', async () => {
  const results = []
  const chunk = ('synthetic alpha beta gamma delta ' + 'word '.repeat(4000)).slice(0, 16384)
  for (const commits of [16, 64, 256]) for (const cadence of [0, 16, 1]) {
    const ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    const db = ctx.storage.open()
    const store = new AgentStore(db, ctx.core)
    try {
      db.run(sql.raw(`CREATE TABLE search_probe (writes INTEGER, bytes INTEGER)`))
      db.run(sql`INSERT INTO search_probe VALUES (0, 0)`)
      db.run(sql.raw(`CREATE TRIGGER search_probe_update AFTER UPDATE OF search_text ON agent_events
        BEGIN UPDATE search_probe SET writes = writes + 1, bytes = bytes + ifnull(length(CAST(NEW.search_text AS BLOB)), 0); END`))
      const session = await store.createSession({ taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} }, {
        id: 'fake', profileId: 'fake', label: 'Synthetic', driverKind: 'acp', driverVersion: 'probe', installed: true,
        authenticated: true, statusAuthority: 'protocol', capabilities: [], configOptions: [], commands: [], skills: [], diagnostics: [],
      })
      const files = (folder: string): number => readdirSync(folder, { withFileTypes: true }).reduce((total, entry) =>
        total + (entry.isDirectory() ? files(join(folder, entry.name)) : statSync(join(folder, entry.name)).size), 0)
      const filesystemFileBytesBefore = files(ctx.dataDir)
      let statements = 0, writes = 0
      const prepare = db.$client.prepare.bind(db.$client)
      db.$client.prepare = (query: string) => {
        statements++
        if (/^(INSERT|UPDATE|DELETE)/i.test(query.trim())) writes++
        return prepare(query)
      }
      const cpu = process.cpuUsage(), started = performance.now()
      let recordElapsedMs = 0, recordCpuMs = 0, searchElapsedMs = 0, searchCpuMs = 0
      const search = async () => {
        const searchCpu = process.cpuUsage(), searchStart = performance.now()
        const hits = await store.searchSessions('alpha beta')
        searchElapsedMs += performance.now() - searchStart
        const used = process.cpuUsage(searchCpu)
        searchCpuMs += (used.user + used.system) / 1000
        return hits
      }
      for (let n = 1; n <= commits; n++) {
        const recordCpu = process.cpuUsage(), recordStart = performance.now()
        await store.recordEvent(session.id, null, { type: 'assistant_message', append: true, messageId: 'm', text: chunk })
        recordElapsedMs += performance.now() - recordStart
        const used = process.cpuUsage(recordCpu)
        recordCpuMs += (used.user + used.system) / 1000
        if (cadence && n % cadence === 0) await search()
      }
      const hits = await search()
      const elapsedMs = performance.now() - started, cpuUsage = process.cpuUsage(cpu)
      const measuredStatements = statements, measuredWrites = writes
      const snapshot = await store.exportSnapshot(session.id)
      const final = snapshot.events[0]!.searchText!
      expect(final).toBe(chunk.repeat(commits))
      expect(hits.map((hit) => hit.id)).toEqual([session.id])
      const logical = db.get<{ writes: number; bytes: number }>(sql`SELECT * FROM search_probe`)!
      results.push({ commits, cadence, messageBytes: Buffer.byteLength(final), elapsedMs,
        node: process.version, recordElapsedMs, recordCpuMs, searchElapsedMs, searchCpuMs,
        cpuMs: (cpuUsage.user + cpuUsage.system) / 1000, statements: measuredStatements, writeStatements: measuredWrites,
        headUpdates: logical.writes, logicalHeadRewriteBytes: logical.bytes,
        logicalMaterializedBytes: logical.bytes + Buffer.byteLength(chunk), ftsRowReplacements: logical.writes + 1,
        finalSha256: createHash('sha256').update(final).digest('hex'), filesystemFileBytesBefore, filesystemFileBytes: files(ctx.dataDir) })
    } finally { ctx.cleanup() }
  }
  writeFileSync(new URL(`./unit12-search-${process.env.ACORN_PERF_TAG ?? 'sample'}.json`, import.meta.url), JSON.stringify(results, null, 2) + '\n')
})
