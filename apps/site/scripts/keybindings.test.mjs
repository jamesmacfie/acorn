import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultShortcuts, shortcutProblems, shortcutRows, sourceRegistrations } from './keybindings.mjs'

test('the Keyboard shortcuts reference can say what every default shortcut does, and where', async () => {
  const registrations = sourceRegistrations()
  const rows = await defaultShortcuts()
  // Guards against a scan that silently finds nothing: core, a client, a plugin pane, and a package.
  for (const chord of ['meta+k', 'meta+,', 'meta+shift+g', 'meta+shift+j']) assert.ok(rows.some((row) => row.chord === chord), chord)
  assert.deepEqual(shortcutProblems(rows, registrations), [])
})

test('a registration the script cannot read fails', () => {
  const registrations = [{ file: 'plugins/x/src/client/index.ts', chord: 'meta+y', category: 'X', when: 'global' }]
  assert.deepEqual(shortcutProblems(shortcutRows(registrations, {}), registrations, {}), [
    'plugins/x/src/client/index.ts registers meta+y without a description, category, or scope this script can read',
  ])
})

test('an override that matches nothing fails', () => {
  assert.deepEqual(shortcutProblems([], [], { 'plugins/x/src/client/index.ts meta+y': { description: 'Gone' } }), [
    'The override for plugins/x/src/client/index.ts meta+y matches no registration',
  ])
})

test('a numbered run reads as its first and last chord', () => {
  const [row] = shortcutRows([{ file: 'a.ts', chord: 'meta+${index + 1}', description: 'Open', category: 'Tasks', when: 'global' }], {})
  assert.equal(row.chord, 'meta+1')
  assert.equal(row.to, 'meta+9')
})
