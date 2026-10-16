import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { BOOKS } from './books.mjs'
import { componentFacts, componentPages } from './componentFacts.mjs'
import { buildBook, readWritten } from './reference.mjs'

// The coverage rules for the Components section (docs/site/references.md § The component pages):
// every kit node has a page, a written purpose, and a picture that draws it on both hosts.

const SITE = fileURLToPath(new URL('../', import.meta.url))
const SPECIMENS = join(SITE, 'src/generated/specimens')
const book = BOOKS.find(({ name }) => name === 'components')
const written = readWritten(join(SITE, book.written))
const { KIT_NODES } = await import('@acorn/protocol/tree/nodes.ts')
const { ROLE_MAP } = await import(new URL('../../../packages/client-core/src/kit/tokens/roles.ts', import.meta.url).href)
const facts = componentFacts()
const pages = componentPages()

// The nodes no tree can draw, because a prop each needs is a function, which can't cross. Each page
// says so and shows what a tree uses instead. A node leaves this list once a tree can draw it.
const NOT_DRAWN_FROM_A_TREE = {
  Rows: 'its children are a render function',
  Menu: 'its trigger and items are functions',
  Popover: 'its trigger is a function',
  Sections: "each section's `render` is a function",
  SplitHandle: 'its drag state is host-made',
  DiffPane: 'its `source` is an object of functions',
}

const specimensOn = (text) => [...text.matchAll(/<Specimen id="([^"]+)"/g)].map(([, id]) => id)
const recorded = (id) => readFileSync(join(SPECIMENS, `${id}.tree.json`), 'utf8')

test('every kit node has a page', () => {
  assert.equal(pages.size, KIT_NODES.length)
  assert.doesNotThrow(() => buildBook(book, { facts, written }))
})

test('a kit node with no group, or a page with no written half, fails the build', () => {
  assert.throws(() => componentPages([...KIT_NODES, 'Widget']), /Widget is a kit node with no group/)
  const missing = new Map(written)
  missing.delete(pages.get('Button'))
  assert.throws(() => buildBook(book, { facts, written: missing }), /inputs\/button has facts from the code and no written half/)
})

test('every node page says what the node is for', () => {
  const problems = [...pages].flatMap(([node, page]) => {
    const text = written.get(page)
    const description = text.match(/^description: (.+)$/m)?.[1]
    const opening = text.split(/^---$/m)[2]?.trim().split('\n\n')[0]
    return [
      ...(description && description.length > 10 ? [] : [`${node} has no description, the one-line purpose.`]),
      ...(opening && !opening.startsWith('<') ? [] : [`${node} opens with no paragraph saying what it's for.`]),
    ]
  })
  assert.deepEqual(problems, [])
})

test('every node page shows a picture on both hosts that draws the node', () => {
  const problems = [...pages].flatMap(([node, page]) => {
    const ids = specimensOn(written.get(page))
    if (!ids.length) return [`${node}'s page shows no picture.`]
    const missing = ids.flatMap((id) =>
      ['.tree.json', '.html', '.cells.json'].filter((ending) => !existsSync(join(SPECIMENS, `${id}${ending}`))).map((ending) => `${id}${ending}`),
    )
    if (missing.length) return [`${node}'s page shows a picture with no ${missing.join(', ')}.`]
    const drawn = ids.some((id) => recorded(id).includes(`"type": "${node}"`))
    if (NOT_DRAWN_FROM_A_TREE[node])
      return drawn ? [`${node} is drawn by its picture now. Take it out of NOT_DRAWN_FROM_A_TREE.`] : []
    return drawn ? [] : [`None of ${ids.join(', ')} draws a ${node}.`]
  })
  assert.deepEqual(problems, [])
})

test('the roles page lists every value of every role, with its desktop token', () => {
  const missing = Object.entries(ROLE_MAP).flatMap(([role, { dom }]) =>
    Object.entries(dom)
      .filter(([value, token]) => !facts['roles-and-tokens'].includes(`"${value}","\`${token}\`"`))
      .map(([value]) => `${role}.${value}`),
  )
  assert.deepEqual(missing, [])
})
