import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEV_BUILD_MARKER, reconcileBundledPlugins } from './bundledPlugins'
import { markPluginUserManaged, readBundledPluginState } from './bundledPluginState'
import { installPlugin, pluginDir, uninstallPlugin } from './pluginInstaller'
import { PLUGIN_API_MAJOR } from './pluginManifest'
import { pluginDbPath } from './pluginStorage'
import { openDb } from './bindings'
import { schema } from '../server/db'

let root = ''
let resources = ''

const packageAt = (parent: string, version: string, marker = version): string => {
  const dir = join(parent, 'rollbar')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify({
    id: 'rollbar', name: 'Rollbar', version, apiVersion: PLUGIN_API_MAJOR, node: './dist/node.js',
  }))
  writeFileSync(join(dir, 'dist/node.js'), `export default ${JSON.stringify(marker)}\n`)
  return dir
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acorn-bundled-data-'))
  resources = mkdtempSync(join(tmpdir(), 'acorn-bundled-resources-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(resources, { recursive: true, force: true })
})

describe('bundled plugin reconciliation', () => {
  it('seeds a fresh profile and records app ownership', () => {
    packageAt(resources, '1.0.0')

    expect(reconcileBundledPlugins(root, resources)).toMatchObject({ installed: ['rollbar'], failures: [] })
    expect(readFileSync(join(pluginDir(root, 'rollbar'), 'dist/node.js'), 'utf8')).toContain('1.0.0')
    expect(readBundledPluginState(root, 'rollbar')).toMatchObject({ status: 'installed', version: '1.0.0' })
  })

  it('updates only the app-owned package while preserving an old profile\'s Rollbar records', async () => {
    const db = openDb(join(root, 'core.sqlite'))
    const now = Date.now()
    await db.insert(schema.workspaces).values({ id: 'workspace', name: 'Work', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await db.insert(schema.projects).values({ id: 'project', name: 'App', workspaceId: 'workspace', createdAt: now, updatedAt: now })
    await db.insert(schema.integrations).values({
      id: 'rollbar-connection', userId: 'owner', provider: 'rollbar', label: 'Production', authRef: 'encrypted-secret',
      createdAt: now, updatedAt: now,
    })
    await db.insert(schema.tasks).values({
      id: 'task', title: 'Checkout failed', origin: 'rollbar', projectId: 'project', status: 'active', createdAt: now, updatedAt: now,
    })
    await db.insert(schema.taskLinks).values({
      taskId: 'task', integrationId: 'rollbar-connection', provider: 'rollbar', identifier: '142', createdAt: now,
    })
    db.close()

    packageAt(resources, '1.0.0')
    reconcileBundledPlugins(root, resources)
    writeFileSync(pluginDbPath(root, 'rollbar'), 'plugin data')

    packageAt(resources, '2.0.0')
    expect(reconcileBundledPlugins(root, resources)).toMatchObject({ updated: ['rollbar'], failures: [] })

    expect(readFileSync(join(pluginDir(root, 'rollbar'), 'dist/node.js'), 'utf8')).toContain('2.0.0')
    expect(readFileSync(pluginDbPath(root, 'rollbar'), 'utf8')).toBe('plugin data')
    const reopened = openDb(join(root, 'core.sqlite'))
    expect(await reopened.select({ provider: schema.integrations.provider, authRef: schema.integrations.authRef }).from(schema.integrations))
      .toEqual([{ provider: 'rollbar', authRef: 'encrypted-secret' }])
    expect(await reopened.select({ origin: schema.tasks.origin }).from(schema.tasks)).toEqual([{ origin: 'rollbar' }])
    expect(await reopened.select({ provider: schema.taskLinks.provider, identifier: schema.taskLinks.identifier }).from(schema.taskLinks))
      .toEqual([{ provider: 'rollbar', identifier: '142' }])
    reopened.close()
  })

  it('keeps an uninstall sticky across restarts and bundled updates', () => {
    packageAt(resources, '1.0.0')
    reconcileBundledPlugins(root, resources)
    uninstallPlugin(root, 'rollbar')
    packageAt(resources, '2.0.0')

    expect(reconcileBundledPlugins(root, resources)).toMatchObject({ removed: ['rollbar'] })
    expect(existsSync(pluginDir(root, 'rollbar'))).toBe(false)
    expect(readBundledPluginState(root, 'rollbar')).toMatchObject({ status: 'removed' })
  })

  it('does not overwrite a version the owner installed themselves', async () => {
    packageAt(resources, '1.0.0')
    reconcileBundledPlugins(root, resources)
    const workshop = mkdtempSync(join(tmpdir(), 'acorn-bundled-override-'))
    const override = packageAt(workshop, '9.0.0', 'owner version')
    await installPlugin(root, { path: override })

    packageAt(resources, '2.0.0')
    expect(reconcileBundledPlugins(root, resources)).toMatchObject({ preserved: ['rollbar'] })
    expect(readFileSync(join(pluginDir(root, 'rollbar'), 'dist/node.js'), 'utf8')).toContain('owner version')
    expect(readBundledPluginState(root, 'rollbar')).toMatchObject({ status: 'user' })
    rmSync(workshop, { recursive: true, force: true })
  })

  it('preserves an unknown pre-existing package instead of claiming it', () => {
    packageAt(resources, '2.0.0', 'app version')
    const installedRoot = join(root, 'plugins')
    packageAt(installedRoot, '1.0.0', 'existing version')

    expect(reconcileBundledPlugins(root, resources)).toMatchObject({ preserved: ['rollbar'] })
    expect(readFileSync(join(pluginDir(root, 'rollbar'), 'dist/node.js'), 'utf8')).toContain('existing version')
  })

  it('replaces a developer’s own build:plugin output, and keeps doing so after the first time', () => {
    // Byte-for-byte the case above — an unrecorded directory in the data root — except for the marker
    // `build:plugin` leaves when it writes there. Without it the two are indistinguishable, so a dev
    // build was marked `user` and then survived every app rebuild: a feature that reads as missing.
    const devBuild = () => {
      const dir = packageAt(join(root, 'plugins'), '1.0.0', 'dev version')
      writeFileSync(join(dir, DEV_BUILD_MARKER), '2026-01-01T00:00:00.000Z\n')
    }
    packageAt(resources, '2.0.0', 'app version')
    devBuild()

    expect(reconcileBundledPlugins(root, resources)).toMatchObject({ updated: ['rollbar'], preserved: [] })
    expect(readFileSync(join(pluginDir(root, 'rollbar'), 'dist/node.js'), 'utf8')).toContain('app version')
    expect(readBundledPluginState(root, 'rollbar')).toMatchObject({ status: 'installed', version: '2.0.0' })
    // `place` replaced the directory, so the marker went with it — an ordinary bundled package again.
    expect(existsSync(join(pluginDir(root, 'rollbar'), DEV_BUILD_MARKER))).toBe(false)

    // The second dev build is the one a state-row-only fix would miss: there IS a row now, saying
    // 'installed' with a fingerprint the rebuild invalidated, which is the same trap one step later.
    devBuild()
    packageAt(resources, '3.0.0', 'newer app version')
    expect(reconcileBundledPlugins(root, resources)).toMatchObject({ updated: ['rollbar'], preserved: [] })
    expect(readFileSync(join(pluginDir(root, 'rollbar'), 'dist/node.js'), 'utf8')).toContain('newer app version')
  })

  it('leaves an owner-installed package alone even when it carries a dev marker', () => {
    // The marker is evidence about how a directory got there, not an override of ownership. A `user`
    // row is a decision someone made through the installer and still returns before any of this.
    packageAt(resources, '2.0.0', 'app version')
    const dir = packageAt(join(root, 'plugins'), '1.0.0', 'owner version')
    writeFileSync(join(dir, DEV_BUILD_MARKER), 'x\n')
    markPluginUserManaged(root, 'rollbar')

    expect(reconcileBundledPlugins(root, resources)).toMatchObject({ preserved: ['rollbar'], updated: [] })
    expect(readFileSync(join(pluginDir(root, 'rollbar'), 'dist/node.js'), 'utf8')).toContain('owner version')
  })
})
