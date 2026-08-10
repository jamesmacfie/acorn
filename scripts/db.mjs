// Migration tooling for EVERY chain in the workspace, not just core's.
//
// Phase 2 split the single 45-table core.sqlite into core plus one SQLite file per plugin
// (docs/vNext/data.md § Plugin DBs), so "the migration chain" became N chains: core's plus one per
// plugin that owns tables. This script discovers them from the filesystem — any package with a
// drizzle.config.ts is a chain — so adding a plugin DB needs no edit here.
//
// It lives at the root because migrations are a workspace concern now. Putting the loop in
// @acorn/node-core would mean a shared library's build scripts naming plugin directories, which is
// the coupling the split removes.
//
//   node scripts/db.mjs generate   # drizzle-kit generate for every chain, then replay them all
//   node scripts/db.mjs check      # replay every chain against a throwaway database
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Every package that owns a Drizzle chain, in a stable order so output is diffable.
function chains() {
  const out = []
  for (const base of ['packages', 'plugins']) {
    const dir = join(ROOT, base)
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue
      const pkgDir = join(dir, entry.name)
      if (existsSync(join(pkgDir, 'drizzle.config.ts'))) out.push({ name: `${base}/${entry.name}`, dir: pkgDir })
    }
  }
  return out
}

function generate(chain) {
  console.log(`\n→ drizzle-kit generate (${chain.name})`)
  // drizzle-kit resolves the config's relative `schema`/`out` against the CWD, so it must run from
  // the package directory. The binary comes from the root devDependency.
  execFileSync(join(ROOT, 'node_modules/.bin/drizzle-kit'), ['generate'], { cwd: chain.dir, stdio: 'inherit' })
}

// Apply a full chain to a fresh throwaway database, statement by statement.
//
// Why replay rather than trust the generator: drizzle's SQLite dialect handles "add a NOT NULL column
// to a populated table" as a table rebuild — CREATE `__new_<table>` + `INSERT INTO __new_… SELECT
// <cols>` — and the generated SELECT lists the NEW column, which does not exist in the source table.
// That copy is invalid SQL even on an empty database, so a fresh-DB replay catches it at generate
// time instead of at db:migrate or app startup. It must be hand-trimmed (docs/local-development.md).
async function check(chain, Database) {
  const migrationsDir = join(chain.dir, 'migrations')
  const journalPath = join(migrationsDir, 'meta/_journal.json')
  if (!existsSync(journalPath)) {
    console.log(`- ${chain.name}: no migrations yet`)
    return true
  }
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  const dir = mkdtempSync(join(tmpdir(), 'acorn-migrations-check-'))
  const db = new Database(join(dir, 'check.sqlite'))
  let failed = false
  try {
    for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
      const file = `${entry.tag}.sql`
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      for (const statement of sql.split('--> statement-breakpoint')) {
        const trimmed = statement.trim()
        if (!trimmed) continue
        try {
          db.exec(trimmed)
        } catch (e) {
          failed = true
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`\n✗ ${chain.name}/migrations/${file} fails on a fresh DB:\n  ${msg}\n\n  Statement:\n${trimmed.replace(/^/gm, '    ')}\n`)
          if (/INSERT INTO\s+["`]?__new_/i.test(trimmed) && /no such column/i.test(msg)) {
            console.error(
              '  This is the drizzle NOT-NULL table-rebuild quirk: the INSERT INTO __new_… SELECT\n' +
                '  copies a column that does not exist in the source table. Hand-trim the new column\n' +
                '  from the SELECT list (see docs/local-development.md → "Schema change workflow").',
            )
          }
          break // later statements in this file depend on this one; later files on this file
        }
      }
      if (failed) break
    }
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
  if (!failed) console.log(`✓ ${chain.name} (${journal.entries.length} file(s)) applies cleanly to a fresh DB`)
  return !failed
}

const command = process.argv[2] ?? 'check'
const all = chains()
if (!all.length) throw new Error('No drizzle.config.ts found under packages/ or plugins/.')

if (command === 'generate') for (const chain of all) generate(chain)

// node:sqlite: same engine, no native build to keep in step with the runtime (main/sqlite.ts).
const { DatabaseSync: Database } = await import('node:sqlite')
let ok = true
console.log('')
for (const chain of all) ok = (await check(chain, Database)) && ok
if (!ok) process.exit(1)
