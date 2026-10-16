import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coverageProblems, coveringPages, EXCLUDED, shippedSettingsPages } from './settingsPages.mjs'

test('every shipped Settings page is covered by a settings docs page, and every covered ID ships', async () => {
  const registered = await shippedSettingsPages()
  // Guards against a reader that silently finds nothing, from each of the three places pages come from.
  for (const id of ['appearance', 'extension-points', 'agent-defaults', 'sentry-telemetry']) {
    assert.ok(registered.includes(id), id)
  }
  assert.equal(new Set(registered).size, registered.length, 'no page is read twice')
  assert.deepEqual(coverageProblems(registered, coveringPages()), [])
})

test('a registered page no docs page covers fails, and so does a covered ID nothing registers', () => {
  const covering = [{ file: 'settings/general.md', covers: ['appearance', 'retired-page'] }]
  assert.deepEqual(coverageProblems(['appearance', 'new-page'], covering, {}), [
    'Settings page new-page is registered, and no settings docs page lists it in covers',
    "settings/general.md covers retired-page, which isn't a shipped Settings page",
  ])
})

test('an excluded page needs no coverage, and may not be covered', () => {
  const id = Object.keys(EXCLUDED)[0]
  assert.deepEqual(coverageProblems([id], []), [])
  assert.equal(coverageProblems([id], [{ file: 'x.md', covers: [id] }]).length, 1)
})
