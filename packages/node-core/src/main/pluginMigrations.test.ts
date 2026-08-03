import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { pluginMigrationsFolder } from './pluginMigrations'

// The built layout puts a plugin's chain at out/migrations/<plugin>/ and CORE's at out/migrations/, one
// directory apart, and the resolver walks up from out/main/. Preferring the bare directory therefore
// handed every plugin core's 42-migration chain — 46 core tables, none of the plugin's own — silently,
// because a plugin only notices when it first touches one of its own tables. These tests pin the
// ordering; the second one fails if the plugin-scoped candidate is checked after the bare one.

const roots: string[] = []
const chain = (dir: string) => {
  mkdirSync(join(dir, 'meta'), { recursive: true })
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ version: '6', dialect: 'sqlite', entries: [] }))
  return dir
}
const root = () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-plugin-migrations-'))
  roots.push(dir)
  return dir
}

describe('pluginMigrationsFolder', () => {
  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('finds the plugin package chain in the source layout', () => {
    const dir = root()
    const expected = chain(join(dir, 'plugins/http/migrations'))
    const module = join(dir, 'plugins/http/src/node/migrations.ts')
    mkdirSync(join(dir, 'plugins/http/src/node'), { recursive: true })
    expect(pluginMigrationsFolder('http', pathToFileURL(module).href)).toBe(expected)
  })

  it('prefers the plugin-scoped chain over core’s in the built layout', () => {
    const dir = root()
    const core = chain(join(dir, 'out/migrations'))
    const expected = chain(join(dir, 'out/migrations/http'))
    const module = join(dir, 'out/main/service.js')
    mkdirSync(join(dir, 'out/main'), { recursive: true })

    const resolved = pluginMigrationsFolder('http', pathToFileURL(module).href)
    expect(resolved).toBe(expected)
    expect(resolved).not.toBe(core)
  })

  it('throws rather than silently applying nothing when no chain exists', () => {
    const dir = root()
    const module = join(dir, 'out/main/service.js')
    mkdirSync(join(dir, 'out/main'), { recursive: true })
    // A `migrations` directory with no journal must not end the search either.
    mkdirSync(join(dir, 'out/migrations'), { recursive: true })
    expect(() => pluginMigrationsFolder('nosuch', pathToFileURL(module).href)).toThrow("No migrations chain found for plugin 'nosuch'")
  })
})
