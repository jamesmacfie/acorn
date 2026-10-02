// Runs only in the performance probe config. Owns disposable loopback clusters, never a host service.
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { expect, it, vi } from 'vitest'
import { createDataSourceService, dataSourceFor, type DataTable } from '../../packages/node-core/src/server/core/data'

const qid = (value: string) => `"${value.replace(/"/g, '""')}"`
const freePort = () => new Promise<number>((resolve, reject) => {
  const server = createServer()
  server.on('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') return reject(new Error('No port'))
    server.close(error => error ? reject(error) : resolve(address.port))
  })
})

async function originalCatalog(pool: pg.Pool): Promise<DataTable[]> {
  const tables = await pool.query(`SELECT table_schema, table_name FROM information_schema.tables
    WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name`)
  return Promise.all(tables.rows.map(async table => {
    const columns = await pool.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`, [table.table_schema, table.table_name])
    const pk = await pool.query(`SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary`, [`${qid(table.table_schema)}.${qid(table.table_name)}`])
    const keys = new Set(pk.rows.map(row => row.attname))
    return { schema: table.table_schema, name: table.table_name, columns: columns.rows.map(column => ({
      name: column.column_name, dataType: column.data_type, nullable: column.is_nullable === 'YES', isPk: keys.has(column.column_name),
    })) }
  }))
}

for (const version of [14, 15]) it(`verifies service, catalog equivalence, transactions, and resource retirement on PG ${version}`, async () => {
  const bin = `/opt/homebrew/opt/postgresql@${version}/bin`
  if (!existsSync(join(bin, 'initdb'))) throw new Error(`Required PostgreSQL ${version} binaries unavailable`)
  const dir = mkdtempSync(join(tmpdir(), `acorn-unit18-pg${version}-`))
  const data = join(dir, 'cluster')
  const log = join(dir, 'postgres.log')
  let port = 0
  const run = (command: string, args: string[]) => execFileSync(join(bin, command), args, { encoding: 'utf8', stdio: 'pipe' })
  let started = false
  let serverPid = 0
  let service: ReturnType<typeof createDataSourceService> | undefined
  let admin: pg.Pool | undefined
  let restricted: pg.Pool | undefined
  const url = (role = 'fixture_owner') => `postgresql://${role}@127.0.0.1:${port}/postgres`
  const report: Record<string, unknown> = { version, syntheticOnly: true }
  try {
    port = await freePort()
    report.port = port
    run('initdb', ['-D', data, '-U', 'fixture_owner', '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    run('pg_ctl', ['-D', data, '-l', log, '-o', `-h 127.0.0.1 -p ${port} -k ${dir} -c log_statement=all`, '-w', 'start'])
    started = true
    serverPid = Number(readFileSync(join(data, 'postmaster.pid'), 'utf8').split('\n')[0])
    admin = new pg.Pool({ connectionString: url(), max: 4, application_name: 'unit18-observer' })
    const root = join(dir, 'repo')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(root)
    writeFileSync(join(root, '.env'), `DATABASE_URL=${url()}\n`)
    const core = {
      tasks: { load: async () => ({ projectId: null }), root: async () => root },
      projects: {}, fs: {}, proc: {},
    } as unknown as Parameters<typeof createDataSourceService>[0]
    service = createDataSourceService(core)
    // Exactly 100 visible tables for the matched eight-reader workload.
    await admin.query(Array.from({ length: 96 }, (_, i) => `CREATE TABLE public.t${String(i).padStart(3, '0')} (id integer PRIMARY KEY, v text)`).join(';'))
    await admin.query(`CREATE SCHEMA "λ""space";
      CREATE DOMAIN public.positive AS integer CHECK (VALUE > 0);
      CREATE TYPE public.mood AS ENUM ('a', 'b');
      CREATE TABLE "λ""space"."Order""🙂" ("κ""id" integer, second integer, v text, custom public.mood, arr integer[], dom public.positive, PRIMARY KEY ("κ""id", second));
      CREATE TABLE public.empty ();
      CREATE TABLE public.restricted (id integer PRIMARY KEY, hidden text, permitted text);
      CREATE TABLE public.secret (id integer);
      CREATE VIEW public.filtered_view AS SELECT * FROM public.secret;
      CREATE ROLE fixture_reader LOGIN;
      GRANT USAGE ON SCHEMA public, "λ""space" TO fixture_reader;
      GRANT SELECT ON public.t000, "λ""space"."Order""🙂" TO fixture_reader;
      GRANT SELECT (id, permitted) ON public.restricted TO fixture_reader;`)
    await service.connect('task')
    const beforeLog = readFileSync(log, 'utf8').length
    const begin = performance.now()
    const catalogs = await Promise.all(Array.from({ length: 8 }, () => service!.catalog('task')))
    const elapsed = performance.now() - begin
    expect(catalogs[0]).toHaveLength(100)
    expect(catalogs.every(catalog => catalog === catalogs[0])).toBe(true)
    expect(catalogs[0]).toEqual(await originalCatalog(admin))
    const waveLog = readFileSync(log, 'utf8').slice(beforeLog)
    // Capture before running original SQL so count only the production wave.
    const statements = waveLog.match(/statement: SELECT t.table_schema/g)?.length ?? 0
    expect(statements).toBe(1)
    report.catalog = { readers: 8, tables: 100, statements, elapsedMs: elapsed }
    const oldLogStart = readFileSync(log, 'utf8').length
    const oldStart = performance.now()
    const original = await Promise.all(Array.from({ length: 8 }, () => originalCatalog(admin!)))
    const originalElapsed = performance.now() - oldStart
    expect(original.every(tables => JSON.stringify(tables) === JSON.stringify(catalogs[0]))).toBe(true)
    const originalLog = readFileSync(log, 'utf8').slice(oldLogStart)
    const originalStatements = originalLog.match(/(?:statement: SELECT table_schema|execute [^:]*: SELECT (?:column_name|a.attname))/g)?.length ?? 0
    expect(originalStatements).toBe(1608)
    report.originalCatalog = { readers: 8, tables: 100, statements: originalStatements, elapsedMs: originalElapsed }

    restricted = new pg.Pool({ connectionString: url('fixture_reader'), application_name: 'unit18-observer' })
    writeFileSync(join(root, '.env'), `DATABASE_URL=${url('fixture_reader')}\n`)
    await service.connect('task')
    const limited = await service.catalog('task')
    expect(limited).toEqual(await originalCatalog(restricted))
    expect(limited.some(table => table.name === 'secret' || table.name === 'filtered_view')).toBe(false)
    expect(limited.find(table => table.name === 'restricted')?.columns.map(column => column.name)).toEqual(['id', 'permitted'])
    report.permissionLimitedTables = limited.length
    await admin.query('REVOKE USAGE ON SCHEMA "λ""space" FROM fixture_reader')
    await service.connect('task')
    await expect(service.catalog('task')).rejects.toThrow(/permission denied/)
    await admin.query('GRANT USAGE ON SCHEMA "λ""space" TO fixture_reader')
    expect(await service.catalog('task')).toEqual(await originalCatalog(restricted))
    report.failedCatalogRetry = true

    writeFileSync(join(root, '.env'), `DATABASE_URL=${url()}\n`)
    await service.connect('task')
    await service.query('task', 'ALTER TABLE public.t000 ADD COLUMN added boolean', { readOnly: false })
    expect((await service.catalog('task')).find(table => table.name === 't000')?.columns.at(-1)?.name).toBe('added')
    await service.query('task', 'ALTER TABLE public.t000 RENAME COLUMN added TO renamed', { readOnly: false })
    expect((await service.catalog('task')).find(table => table.name === 't000')?.columns.at(-1)?.name).toBe('renamed')
    await service.query('task', 'ALTER TABLE public.t000 DROP COLUMN renamed; ALTER TABLE public.t000 RENAME TO renamed_table', { readOnly: false })
    expect(await service.catalog('task')).toEqual(await originalCatalog(admin))
    await service.query('task', 'DROP TABLE public.renamed_table', { readOnly: false })
    expect((await service.catalog('task')).some(table => table.name === 'renamed_table')).toBe(false)

    await service.query('task', 'CREATE TABLE public.drop_during_catalog (id integer)', { readOnly: false })
    const dropping = await Promise.allSettled([
      service.catalog('task'),
      service.query('task', 'DROP TABLE public.drop_during_catalog', { readOnly: false }),
    ])
    expect(dropping[1].status).toBe('fulfilled')
    expect((await service.catalog('task')).some(table => table.name === 'drop_during_catalog')).toBe(false)
    report.concurrentDrop = true

    // Function text passes the early SQL guard; PostgreSQL READ ONLY must enforce the refusal.
    await admin.query(`CREATE FUNCTION public.write_from_read() RETURNS integer LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO public.t001 VALUES (1, 'hidden write'); RETURN 1; END $$`)
    await expect(service.query('task', 'SELECT public.write_from_read()')).rejects.toThrow(/read-only/)
    expect((await service.query('task', 'SELECT count(*) FROM public.t001')).rows).toEqual([['0']])
    await expect(service.query('task', 'SELECT pg_sleep(1)', { timeoutMs: 20 })).rejects.toThrow(/statement timeout/)
    await expect(service.query('task', 'SELECT 1/0')).rejects.toThrow(/division by zero/)
    expect((await service.query('task', 'SELECT $1::text AS "λ🙂", NULL AS n, true AS b, 12.5::float8 AS x, \'2026-01-01T00:00:00Z\'::timestamptz AS d, \'{"v":1}\'::json AS j', { parameters: ['bound🙂'] })).rows)
      .toEqual([['bound🙂', null, 'true', '12.5', '2026-01-01T00:00:00.000Z', '{"v":1}']])
    const multi = await service.query('task', 'SELECT 7; SELECT generate_series(1, 9) AS v', { maxRows: 2 })
    expect(multi).toMatchObject({ columns: ['v'], rows: [['1'], ['2']], rowCount: 9, truncated: true, command: 'SELECT' })
    await service.query('task', 'INSERT INTO public.t001 VALUES (2, \'committed\')', { readOnly: false })
    expect((await service.query('task', 'SELECT v FROM public.t001')).rows).toEqual([['committed']])

    const sessions = async () => Number((await admin!.query(`SELECT count(*) FROM pg_stat_activity WHERE usename = 'fixture_owner' AND backend_type = 'client backend' AND application_name <> 'unit18-observer'`)).rows[0].count)
    await service.disconnect('task')
    try { await vi.waitFor(async () => expect(await sessions()).toBe(0), { timeout: 3000 }) }
    catch (error) { report.unexpectedSessions = (await admin!.query("SELECT pid, application_name, state, query FROM pg_stat_activity WHERE usename = 'fixture_owner'")).rows; throw error }
    // 20 actual cold queries use at most four backend sessions, distinct from one JS Pool.
    const queryCalls = Array.from({ length: 20 }, () => service!.query('task', 'SELECT pg_sleep(0.03)'))
    await Promise.all(queryCalls)
    const actualConnections = await sessions()
    expect(actualConnections).toBeLessThanOrEqual(4)
    expect(actualConnections).toBeGreaterThan(0)
    report.coldReaders = { readers: 20, backendConnections: actualConnections }

    const a = dataSourceFor(service, false); const b = dataSourceFor(service, false)
    await a.query('task', 'SELECT 1'); await b.query('task', 'SELECT 1')
    await a.disconnect('task')
    expect((await b.query('task', 'SELECT 2')).rows).toEqual([['2']])
    await b.disconnect('task')
    const held = service.query('task', 'SELECT pg_sleep(0.2), 3 AS v')
    await vi.waitFor(async () => {
      const active = await admin!.query(`SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(0.2)%' AND state = 'active'`)
      expect(Number(active.rows[0].count)).toBe(1)
    })
    await service.disconnect('task')
    expect((await held).rows[0]?.[1]).toBe('3')
    await vi.waitFor(async () => expect(await sessions()).toBe(0))
    report.backendConnectionsAfterDisconnect = await sessions()
  } finally {
    await service?.disconnect('task')
    await restricted?.end()
    await admin?.end()
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
    if (serverPid) expect(() => process.kill(serverPid, 0)).toThrow()
    expect(existsSync(join(dir, `.s.PGSQL.${port}`))).toBe(false)
    expect(existsSync(join(data, 'postmaster.pid'))).toBe(false)
    report.cleanup = { serverPid, pidGone: true, socketGone: true, postmasterFileGone: true }
    writeFileSync(new URL(`18-postgres-${version}-after.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n')
    rmSync(dir, { recursive: true, force: true })
  }
}, 60_000)
