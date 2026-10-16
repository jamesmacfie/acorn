import assert from 'node:assert/strict'
import { test } from 'node:test'
import { envProblems, listedOnPage, pageNames, runtimeNames } from './envVars.mjs'

test('the Environment variables page lists every ACORN_ name the runtimes use, or it is named as internal', () => {
  const used = runtimeNames()
  // Guards against a scan that silently finds nothing, in the Node, the terminal client, and custody.
  for (const name of ['ACORN_ADVERTISE_HOST', 'ACORN_TUI_NOTIFY', 'ACORN_TUI_CONFIG_DIR']) assert.ok(used.includes(name), name)
  assert.deepEqual(envProblems(used, listedOnPage()), [])
})

test('a variable the runtimes read and the page leaves out fails', () => {
  const fixture = "const port = process.env.ACORN_PORT\nconst mode = process.env.ACORN_NEW_SWITCH === '1'"
  const page = '| `ACORN_PORT` | The port the Node listens on. |'
  assert.deepEqual(envProblems(pageNames(fixture), pageNames(page), {}), [
    "ACORN_NEW_SWITCH is in the runtimes' source, and the page neither lists it nor names it as internal",
  ])
})

test('an internal name needs no row, may not have one, and a prefix covers its family', () => {
  const internal = { 'ACORN_FIXTURE_*': 'Test fixture switches.' }
  assert.deepEqual(envProblems(['ACORN_FIXTURE_DELAY_MS'], [], internal), [])
  assert.equal(envProblems(['ACORN_FIXTURE_DELAY_MS'], ['ACORN_FIXTURE_DELAY_MS'], internal).length, 1)
})

test('a listed variable nothing mentions fails', () => {
  assert.deepEqual(envProblems([], ['ACORN_GONE'], {}), ['The page lists ACORN_GONE, which nothing in the runtimes mentions'])
})
