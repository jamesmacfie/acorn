import { render } from 'solid-js/web'
import { afterEach, expect, it } from 'vitest'
import DiffFence, { diffFenceFiles, UNNAMED_FENCE_FILE } from './DiffFence'

const hosts: Array<() => void> = []
afterEach(() => {
  for (const dispose of hosts.splice(0)) dispose()
})

function draw(text: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <DiffFence blockId="fence-1" language="diff" text={text} revision={1} />, host)
  hosts.push(() => {
    dispose()
    host.remove()
  })
  return host
}

it('reads a snippet with no file header as one unnamed file, untouched', () => {
  const text = ' keep\n-old\n+new'
  expect(diffFenceFiles(text)).toEqual([{ path: UNNAMED_FENCE_FILE, patch: text }])
})

it('takes one file’s path from its ---/+++ pair and keeps its hunks', () => {
  expect(diffFenceFiles('--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n')).toEqual([
    { path: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b' },
  ])
})

it('splits a git diff into its files, header lines and any preamble dropped', () => {
  const text = [
    'Here is the change:',
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
  ].join('\n')
  expect(diffFenceFiles(text)).toEqual([
    { path: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b' },
    { path: 'gone.ts', patch: '@@ -1 +0,0 @@\n-bye' },
  ])
})

it('draws a bare snippet as removed and added rows under the fallback heading', () => {
  const host = draw(
    [
      ' export function total(items) {',
      '-  let sum = 0',
      '-  for (const item of items) {',
      '-    if (item.price) {',
      '-      sum += item.price',
      '-    }',
      '-  }',
      '-  return sum',
      '+  return items',
      '+    .filter((item) => item.price)',
      '+    .reduce((sum, item) => sum + item.price, 0)',
      ' }',
    ].join('\n'),
  )
  expect(host.querySelectorAll('.diff-del')).toHaveLength(7)
  expect(host.querySelectorAll('.diff-add')).toHaveLength(3)
  expect(host.querySelector('.diff-file-head')?.textContent).toContain(UNNAMED_FENCE_FILE)
  expect([...host.querySelectorAll('.diff-gutter')].every((gutter) => gutter.textContent === '')).toBe(true)
})

it('draws one card per file, each under its path', () => {
  const host = draw(
    '--- a/one.ts\n+++ b/one.ts\n@@ -1 +1 @@\n-a\n+b\n--- a/two.ts\n+++ b/two.ts\n@@ -3,2 +3,2 @@\n x\n-c\n+d',
  )
  const heads = [...host.querySelectorAll('.diff-file-head')].map((head) => head.textContent)
  expect(heads).toHaveLength(2)
  expect(heads[0]).toContain('one.ts')
  expect(heads[1]).toContain('two.ts')
  expect(host.querySelectorAll('.diff-hunk')).toHaveLength(2)
})

it('draws hunks with no file header under the fallback heading', () => {
  const host = draw('@@ -10,2 +10,2 @@\n x\n-c\n+d')
  expect(host.querySelector('.diff-file-head')?.textContent).toContain(UNNAMED_FENCE_FILE)
  expect(host.querySelector('.diff-hunk')?.textContent).toContain('@@ -10,2 +10,2 @@')
  expect(host.querySelector('.diff-del')?.textContent).toContain('c')
  expect(host.querySelector('.diff-add')?.textContent).toContain('d')
})
