import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createComponent, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { renumber } from '@acorn/plugin-examples/renumber.ts'
import { createRemoteRoot } from '@acorn/client-core/host/frames/remoteRoot.ts'
import { LAYOUTS } from '@acorn/client-core/host/layouts'
import { TreeHost } from '@acorn/client-core/host/tree/TreeHost.tsx'
import { Text } from '@acorn/client-core/kit/components/content'
import type { PaneLayoutName } from '@acorn/protocol/paneLayouts.ts'
import { solidTree } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimens/specimen'
import examplePictures from '../specimens/examples.json'
import layoutPictures from '../specimens/layouts.json'

// The specimen generator's first two steps (docs/site/specimens.md): run each specimen's tree in this
// process and record the batches it sends, then draw those batches with the desktop's TreeHost under
// jsdom. Each step writes a committed file and fails when the committed file differs.
// `UPDATE_SPECIMENS=1` rewrites them. The terminal step is apps/tui/src/kit/specimens.test.tsx, which
// reads the `.tree.json` files this one writes. An example plugin's picture, listed in
// apps/site/specimens/examples.json, is recorded by examples/plugins/test/pictures.test.ts instead,
// and this draws its HTML from the committed tree. A layout's picture, listed in
// apps/site/specimens/layouts.json, is no tree: each host draws its own layout component, with every
// region holding its name, and the `.tree.json` records the layout in place of batches.

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
  // A modal draws through a portal, into the document's body rather than in its place, so the drawing
  // is the host's markup followed by any portal's.
  const drawn = () => [host, ...[...document.body.children].filter((element) => element !== host)]
  const html = () =>
    drawn()
      .map((element) => element.innerHTML)
      .join('')
  // Each root waits for its lazy nodes, such as a timeline or a code block, and draws nothing until
  // they load. So the drawing is done once it's something, and stays the same for one more turn.
  let last = ''
  for (let turn = 0; turn < 200; turn += 1) {
    await new Promise((done) => setTimeout(done, 25))
    if (html() !== '' && html() === last) break
    last = html()
  }
  for (const element of drawn()) reflectFormState(element)
  last = html()
  dispose()
  host.remove()
  expect(problems).toEqual([])
  return last
}

type LayoutPicture = (typeof layoutPictures)[number]
// The pane a layout picture is drawn for, which a layout writes into its regions' names.
const LAYOUT_LABEL = 'Deploys'

/** Draws one of the host's layouts with each region holding its own name, and returns the HTML. */
async function drawLayout({ id, layout, regions, ...props }: LayoutPicture): Promise<string> {
  const host = document.createElement('div')
  document.body.append(host)
  const named = Object.fromEntries(
    regions.map((name) => [name, () => createComponent(Text, { emphasis: 'muted', children: `${name} region` })]),
  )
  const dispose = render(
    () => LAYOUTS[layout as PaneLayoutName]({ ...props, stateKey: id, label: LAYOUT_LABEL, regions: named }),
    host,
  )
  await new Promise((done) => setTimeout(done, 0))
  const html = host.innerHTML
  dispose()
  host.remove()
  return html
}

/** A control's value is a property, which `innerHTML` leaves out, so copy it into the markup. */
function reflectFormState(root: Element): void {
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
 * event handler attributes go, and an inline style keeps only what `KEPT_STYLE` allows. An image from
 * another origin, such as a GitHub avatar, loses its `src`, because a site page loads nothing from
 * another origin, so it draws as its empty frame.
 */
function sanitize(specimen: string, html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  const content = template.content
  for (const script of content.querySelectorAll('script')) script.remove()
  for (const image of content.querySelectorAll('img[src^="http"]')) image.removeAttribute('src')

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
  const ids = [specimens, examplePictures, layoutPictures].flat().map(({ id }) => id)
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

it.each(examplePictures)('$id draws the committed HTML of its example tree', async ({ id }) => {
  const { batches } = JSON.parse(readFileSync(join(OUT, `${id}.tree.json`), 'utf8')) as { batches: TreeMutation[][] }
  check(`${id}.html`, `${sanitize(id, await drawDesktop(batches))}\n`)
})

it.each(layoutPictures)('$id draws the committed layout', async (picture) => {
  const { id, layout, title, caption, terminal, width, regions, ...props } = picture
  const meta: SpecimenMeta = { title, caption, terminal, width }
  check(
    `${id}.tree.json`,
    `${JSON.stringify({ meta, layout: { name: layout, label: LAYOUT_LABEL, regions, ...props } }, null, 2)}\n`,
  )
  check(`${id}.html`, `${sanitize(id, await drawLayout(picture))}\n`)
})

it('commits no output for a specimen that no longer exists', () => {
  const ids = [specimens, examplePictures, layoutPictures].flat().map(({ id }) => id)
  const expected = new Set(ids.flatMap((id) => [`${id}.tree.json`, `${id}.html`, `${id}.cells.json`]))
  const stale = readdirSync(OUT).filter((name) => !expected.has(name))
  if (update) for (const name of stale) rmSync(join(OUT, name))
  else expect(stale).toEqual([])
})
