import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createComponent, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { TreeMutation, TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/client-core/host/frames/remoteRoot.ts'
import { TreeHost } from '@acorn/client-core/host/tree/TreeHost.tsx'
import { solidTree } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimens/specimen'

// The specimen generator's first two steps (docs/site/specimens.md): run each specimen's tree in this
// process and record the batches it sends, then draw those batches with the desktop's TreeHost under
// jsdom. Each step writes a committed file and fails when the committed file differs.
// `UPDATE_SPECIMENS=1` rewrites them. The terminal step is apps/tui/src/kit/specimens.test.tsx, which
// reads the `.tree.json` files this one writes.

const OUT = join(import.meta.dirname, '../src/generated/specimens')
const update = process.env.UPDATE_SPECIMENS === '1'

type SpecimenModule = { meta: SpecimenMeta; default: () => JSX.Element }
const sources = import.meta.glob<SpecimenModule>('../specimens/*/*.tsx', { eager: true })
const specimens = Object.entries(sources).map(([path, module]) => ({ id: basename(path, '.tsx'), module }))

// Anything that formats a timestamp gets the same answer on every machine. The time zone and locale
// are pinned in vitest.config.ts, before the workers start.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-15T09:30:00Z'))
})
afterAll(() => vi.useRealTimers())

/** Writes the file under `UPDATE_SPECIMENS=1`, then holds the committed bytes to what was generated. */
function check(name: string, generated: string): void {
  const path = join(OUT, name)
  if (update) writeFileSync(path, generated)
  expect(
    readFileSync(path, 'utf8'),
    `${name} is stale. Run UPDATE_SPECIMENS=1 pnpm --filter @acorn/site specimens`,
  ).toBe(generated)
}

/** Runs the tree the way a plugin's worker would, and keeps every batch it sends. */
async function record(component: SpecimenModule['default']): Promise<TreeMutation[][]> {
  const batches: TreeMutation[][] = []
  const root = createRemoteRoot((ops) => batches.push(ops))
  const refuse = () => Promise.reject(new Error('A specimen asks its host for nothing.'))
  solidTree(component)({} as never, {
    entry: 'specimen',
    root,
    props: () => ({}),
    onProps: () => {},
    onUnmount: () => {},
    host: { invoke: refuse, openOverlay: refuse },
  })
  await new Promise((done) => setTimeout(done, 0))
  root.dispose()
  return renumber(batches)
}

/** Node ids come from one counter per process, so they depend on which specimens ran first. Number
 *  them again in the order they appear. */
function renumber(batches: TreeMutation[][]): TreeMutation[][] {
  const ids = new Map<string, string>()
  const id = (old: string) => ids.get(old) ?? (ids.set(old, `n${ids.size + 1}`), ids.get(old)!)
  const node = (tree: TreeNode): TreeNode => ({ ...tree, id: id(tree.id), children: tree.children.map(node) })
  return batches.map((ops) =>
    ops.map((op) => {
      if (op.op === 'insert') return { ...op, parent: op.parent && id(op.parent), node: node(op.node) }
      if (op.op === 'move') return { ...op, id: id(op.id), parent: op.parent && id(op.parent) }
      return { ...op, id: id(op.id) }
    }),
  )
}

/** Delivers the batches to the desktop's TreeHost, through the transport a worker would use, and
 *  returns the HTML once it stops changing. */
async function drawDesktop(batches: TreeMutation[][]): Promise<string> {
  const host = document.createElement('div')
  document.body.append(host)
  const problems: string[] = []
  let deliver: (ops: readonly TreeMutation[]) => void = () => {}
  const dispose = render(
    () =>
      createComponent(TreeHost, {
        pluginId: 'specimen',
        onFailed: (reason) => problems.push(`failed: ${reason}`),
        onRefused: (reason) => problems.push(`refused: ${reason}`),
        transport: {
          onBatch: (listener) => ((deliver = listener), () => {}),
          onFailed: () => () => {},
          send: () => {},
        },
      }),
    host,
  )
  for (const ops of batches) deliver(ops)
  // Each root waits for its lazy nodes, such as a timeline or a code block, and draws nothing until
  // they load. So the drawing is done once it's something, and stays the same for one more turn.
  let html = ''
  for (let turn = 0; turn < 200; turn += 1) {
    await new Promise((done) => setTimeout(done, 25))
    if (host.innerHTML !== '' && host.innerHTML === html) break
    html = host.innerHTML
  }
  reflectFormState(host)
  html = host.innerHTML
  dispose()
  host.remove()
  expect(problems).toEqual([])
  return html
}

/** A control's value is a property, which `innerHTML` leaves out, so copy it into the markup. */
function reflectFormState(root: HTMLElement): void {
  for (const input of root.querySelectorAll('input')) {
    if (input.type === 'checkbox' || input.type === 'radio') input.toggleAttribute('checked', input.checked)
    else input.setAttribute('value', input.value)
  }
  for (const textarea of root.querySelectorAll('textarea')) textarea.textContent = textarea.value
  for (const option of root.querySelectorAll('option')) option.toggleAttribute('selected', option.selected)
}

// Attributes that point at another element's id.
const ID_REFERENCES = [
  'for',
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-details',
  'aria-errormessage',
  'aria-labelledby',
  'aria-owns',
  'headers',
  'list',
]

// What an inline style may keep: a custom property, which carries a measurement or a role
// (docs/ui-design/tokens.md § Runtime-set custom properties), or the geometry a component computes for
// itself, such as where a graph places its cards. Never a colour, a font, or a spacing decision.
const KEPT_STYLE = /^(--[\w-]+|transform|width|height|min-width|top|left|position|grid-template-columns|visibility)\s*:/

/**
 * Makes the drawn HTML safe to commit and the same on every machine. Element ids become
 * `<specimen>-<n>`, which also keeps them unique on a page that shows several specimens. Scripts and
 * event handler attributes go, and an inline style keeps only what `KEPT_STYLE` allows.
 */
function sanitize(specimen: string, html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  const content = template.content
  for (const script of content.querySelectorAll('script')) script.remove()

  const ids = new Map<string, string>()
  for (const element of content.querySelectorAll('[id]')) {
    ids.set(element.id, `${specimen}-${ids.size + 1}`)
    element.id = ids.get(element.id)!
  }
  for (const element of content.querySelectorAll('*')) {
    // A copy, because removing an attribute changes the live list.
    for (const { name, value } of Array.from(element.attributes)) {
      if (name.startsWith('on')) element.removeAttribute(name)
      else if (ID_REFERENCES.includes(name)) {
        element.setAttribute(
          name,
          value
            .split(/\s+/)
            .map((ref) => ids.get(ref) ?? ref)
            .join(' '),
        )
      }
    }
    const style = element.getAttribute('style')
    if (style === null) continue
    const kept = style
      .split(';')
      .map((declaration) => declaration.trim())
      .filter((declaration) => KEPT_STYLE.test(declaration))
    if (kept.length > 0) element.setAttribute('style', `${kept.join('; ')};`)
    else element.removeAttribute('style')
  }
  return template.innerHTML
}

it('finds the specimens', () => {
  expect(specimens.length).toBeGreaterThan(0)
  const ids = specimens.map((specimen) => specimen.id)
  expect(new Set(ids).size, 'Two specimens share an id. Ids are file names, and must be unique across groups.').toBe(
    ids.length,
  )
})

it.each(specimens)('$id draws the committed tree and HTML', async ({ id, module }) => {
  mkdirSync(OUT, { recursive: true })
  const batches = await record(module.default)
  check(`${id}.tree.json`, `${JSON.stringify({ meta: module.meta, batches }, null, 2)}\n`)
  check(`${id}.html`, `${sanitize(id, await drawDesktop(batches))}\n`)
})

it('commits no output for a specimen that no longer exists', () => {
  const expected = new Set(specimens.flatMap(({ id }) => [`${id}.tree.json`, `${id}.html`, `${id}.cells.json`]))
  const stale = readdirSync(OUT).filter((name) => !expected.has(name))
  if (update) for (const name of stale) rmSync(join(OUT, name))
  else expect(stale).toEqual([])
})
