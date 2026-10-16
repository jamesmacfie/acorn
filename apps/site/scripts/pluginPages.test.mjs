import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PLUGINS } from '../src/data/plugins.ts'
import { manifestKeys, rosterProblems, shippedPlugins } from './pluginPages.mjs'

test('every plugin acorn ships has an entry, a docs page, and a reason for each permission it asks for', async () => {
  const shipped = shippedPlugins()
  // Guards against a reader that silently finds nothing in either roster.
  for (const id of ['agents', 'browser', 'onboarding']) assert.ok(shipped.compiled.includes(id), id)
  assert.ok(shipped.bundled.includes('database'))
  const keys = Object.fromEntries(await Promise.all(shipped.bundled.map(async (id) => [id, await manifestKeys(id)])))
  assert.ok(keys.database.includes('node.core:data:query'))
  assert.deepEqual(rosterProblems(shipped, PLUGINS, keys), [])
})

const plugin = (ships, reasons) => ({ ships, docs: `/docs/${ships}/`, ...(reasons ? { reasons } : {}) })

test('a shipped plugin with no entry, or no docs page, fails, and so does an entry nothing ships', () => {
  const plugins = { git: plugin('compiled'), retired: plugin('compiled') }
  const pageExists = (url) => url !== '/docs/compiled/'
  assert.deepEqual(rosterProblems({ compiled: ['git', 'new'], bundled: [] }, plugins, {}, pageExists), [
    'git links to /docs/compiled/, which has no page',
    'new ships, and src/data/plugins.ts has no entry for it',
    "src/data/plugins.ts lists retired, which acorn doesn't ship",
  ])
})

test('a permission with no reason fails, and so does a reason for a permission nobody asks for', () => {
  const plugins = { http: plugin('package', { 'node.exec': 'Runs commands.', 'node.secrets': 'Encrypts.' }) }
  const keys = { http: ['node.exec', 'node.net:*'] }
  assert.deepEqual(rosterProblems({ compiled: [], bundled: ['http'] }, plugins, keys, () => true), [
    'http asks for node.net:*, and its page gives no reason',
    "http's page gives a reason for node.secrets, which it doesn't ask for",
  ])
})

test('a package listed as compiled fails', () => {
  assert.deepEqual(rosterProblems({ compiled: [], bundled: ['http'] }, { http: plugin('compiled') }, {}, () => true), [
    'http ships as package, and src/data/plugins.ts says compiled',
  ])
})
