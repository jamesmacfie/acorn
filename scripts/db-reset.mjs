// Delete the development SQLite databases so the next launch is a first run again.
//
// The chains start from a single baseline migration and there is no upgrade path from an older
// database (docs/data-layer.md § Migrations), so "throw it away and boot fresh" is the supported
// way to get back to the onboarding experience.
//
// Only the databases go: node identity, the listener key, and the internal token stay, because they
// are not what onboarding reads. Core's `devices` table is one of the files deleted here, so the
// desktop re-pairs on the next launch.
//
//   pnpm db:reset          # asks first
//   pnpm db:reset --yes    # for scripts and non-interactive shells
//   ACORN_DATA_DIR=… pnpm db:reset
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Same dev root the desktop and standalone node use when ACORN_DATA_DIR is unset.
const dataDir = resolve(process.env.ACORN_DATA_DIR ?? join(ROOT, 'apps/node/.acorn'))

// The database and its WAL/SHM sidecars — deleting the database alone would leave a WAL that SQLite
// replays into the new file.
const isDatabaseFile = (name) => /\.sqlite(-wal|-shm)?$/.test(name)

const listIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter(isDatabaseFile).sort().map((name) => join(dir, name)) : [])

const targets = [...listIn(dataDir), ...listIn(join(dataDir, 'plugins'))]

if (!targets.length) {
  console.log(`Nothing to delete: no SQLite databases in ${dataDir}`)
  process.exit(0)
}

const bytes = targets.reduce((total, path) => total + statSync(path).size, 0)
console.log(`Data root: ${dataDir}\n`)
for (const path of targets) console.log(`  ${path}`)
console.log(`\n${targets.length} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB. Quit acorn first — deleting a database out from under a running node corrupts it.`)

const preapproved = process.argv.includes('--yes') || process.argv.includes('-y')
if (!preapproved) {
  if (!process.stdin.isTTY) {
    console.error('\nRefusing to delete without confirmation. Re-run with --yes.')
    process.exit(1)
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('\nDelete these databases? [y/N] ')
  rl.close()
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Left alone.')
    process.exit(1)
  }
}

for (const path of targets) rmSync(path, { force: true })
console.log(`Deleted ${targets.length} file(s). The next launch migrates a fresh database.`)
