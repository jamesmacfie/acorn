import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pick, region } from './exampleCode.ts'

const source = [
  'const a = 1',
  '// #region draw',
  'function draw() {',
  '  // #region inner',
  '  return a',
  '  // #endregion',
  '}',
  '// #endregion',
].join('\n')

test('a region is its lines, without the markers inside it', () => {
  assert.equal(region(source, 'draw'), 'function draw() {\n  return a\n}')
  assert.equal(region(source, 'inner'), 'return a')
})

test('a whole file leaves every marker out', () => {
  assert.equal(region(source), 'const a = 1\nfunction draw() {\n  return a\n}')
})

test('a missing region fails the build rather than showing nothing', () => {
  assert.throws(() => region(source, 'paint'), /No region named "paint"/)
})

test('a pick keeps the paths asked for, and one entry by id', () => {
  const manifest = JSON.stringify({
    id: 'acme',
    client: './client.js',
    contributions: { frames: [{ id: 'pane' }, { id: 'settings' }], commands: [{ id: 'open' }] },
  })
  assert.deepEqual(JSON.parse(pick(manifest, ['client', 'contributions.frames#settings'])), {
    client: './client.js',
    contributions: { frames: [{ id: 'settings' }] },
  })
  assert.throws(() => pick(manifest, ['contributions.sources']), /no contributions.sources/)
  assert.throws(() => pick(manifest, ['contributions.frames#board']), /no entry with id "board"/)
})
