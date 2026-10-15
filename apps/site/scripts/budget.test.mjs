import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkBudgets } from './budget.mjs'

function site(files) {
  const dist = mkdtempSync(join(tmpdir(), 'site-budget-'))
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dist, path, '..'), { recursive: true })
    writeFileSync(join(dist, path), body)
  }
  return dist
}

const page = (head = '') => `<!doctype html><html><head>${head}</head><body><a href="https://github.com/x">x</a></body></html>`
// Random text barely compresses, so 50 KB of it stays far over a 10 KB budget.
const bigScript = `console.log("${randomBytes(37_500).toString('base64')}")`

test('a small site that loads only its own files passes', () => {
  const dist = site({
    'index.html': page('<link rel="stylesheet" href="/_astro/a.css"><script type="module" src="/_astro/a.js"></script>'),
    'docs/x/index.html': page('<link rel="canonical" href="https://acorn.sh/docs/x/">'),
    '_astro/a.css': 'body{}',
    '_astro/a.js': 'import"./b.js"',
    '_astro/b.js': 'export const b=1',
  })
  assert.deepEqual(checkBudgets(dist), [])
})

test('a 50 KB script on the landing page fails', () => {
  const dist = site({ 'index.html': page('<script src="/_astro/big.js"></script>'), '_astro/big.js': bigScript })
  assert.match(checkBudgets(dist).join('\n'), /index\.html: .* of JavaScript, budget 10\.0 KB/)
})

test('a script a module imports counts toward the page', () => {
  const dist = site({
    'download/index.html': page('<script type="module" src="/_astro/a.js"></script>'),
    '_astro/a.js': 'import{x}from"./big.js";x()',
    '_astro/big.js': bigScript,
  })
  assert.match(checkBudgets(dist).join('\n'), /download\/index\.html: .* of JavaScript/)
})

test('a script or stylesheet from another origin fails', () => {
  const dist = site({
    'index.html': page('<script src="https://cdn.example.com/x.js"></script>'),
    'docs/index.html': page('<link rel="stylesheet" href="//fonts.example.com/f.css">'),
  })
  assert.deepEqual(checkBudgets(dist), [
    'docs/index.html: loads //fonts.example.com/f.css from another origin',
    'index.html: loads https://cdn.example.com/x.js from another origin',
  ])
})

test('lab pages are not checked', () => {
  const dist = site({ 'lab/index.html': page('<script src="https://cdn.example.com/x.js"></script>') })
  assert.deepEqual(checkBudgets(dist), [])
})
