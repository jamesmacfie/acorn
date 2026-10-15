import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { pages, readMeta, ROOT, snapshotCommit, touching } from './stale.mjs'

// The staleness report trusts both fields, so a typo in either would hide a page from it.
test('every page cites files that exist, checked at a commit in the history of HEAD', () => {
  const inHistory = (commit) =>
    spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: ROOT }).status === 0
  const all = pages()
  const unknown = new Set(
    [...new Set(all.map((page) => page.checked))].filter((commit) => !commit || !inHistory(commit)),
  )
  const problems = all.flatMap((page) => [
    ...(page.sources.length === 0 ? [`${page.file}: cites no sources`] : []),
    ...page.sources
      .filter((source) => !existsSync(join(ROOT, source)))
      .map((source) => `${page.file}: cites ${source}, which doesn't exist`),
    ...(unknown.has(page.checked)
      ? [`${page.file}: checked ${page.checked} isn't a commit in the history of HEAD`]
      : []),
  ])
  assert.deepEqual(problems, [])
})

test('reads sources and checked from frontmatter and from a meta export', () => {
  const markdown =
    '---\ntitle: X\nsources:\n  - guides/a.md\n  - "guides/b.md"\nchecked: 3f9a2c1\n---\n\n- not a source\n'
  assert.deepEqual(readMeta(markdown), { sources: ['guides/a.md', 'guides/b.md'], checked: '3f9a2c1' })
  const astro =
    "---\nexport const meta = {\n  sources: [\n    'guides/a.md',\n    'guides/b.md',\n  ],\n  checked: '3f9a2c1',\n} satisfies PageMeta\n---\n"
  assert.deepEqual(readMeta(astro), { sources: ['guides/a.md', 'guides/b.md'], checked: '3f9a2c1' })
})

test('reads the commit a snapshot was captured at', () => {
  assert.equal(snapshotCommit('<!-- commit 3f9a2c1, captured 2026-10-20 -->\n<div></div>'), '3f9a2c1')
  assert.equal(snapshotCommit('{\n  "commit": "3f9a2c1",\n  "rows": []\n}'), '3f9a2c1')
})

test('a page cites a changed file named in its sources or inside a folder it names', () => {
  const page = { file: 'p.md', sources: ['docs/database.md', 'packages/kit', 'apps/tui/src/chrome/'] }
  const changed = [
    'docs/database.md',
    'docs/database/pane.md',
    'packages/kit/a.ts',
    'packages/kitchen.ts',
    'apps/tui/src/chrome/b.ts',
  ]
  assert.deepEqual(
    touching(changed, [page]).map((found) => found.cited),
    [['docs/database.md', 'packages/kit/a.ts', 'apps/tui/src/chrome/b.ts']],
  )
})
