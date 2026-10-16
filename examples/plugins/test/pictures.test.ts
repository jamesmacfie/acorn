// The guides' pictures (docs/site/plugin-guides.md): each example tree the site lists in
// apps/site/specimens/examples.json, mounted against its own Node half, with the batches it sent
// committed as apps/site/src/generated/specimens/<id>.tree.json. The site's specimen generator draws the
// desktop's HTML from that file, and the terminal client's draws the cells, as for any specimen.
//
// It reads and writes the site's files by path, as the terminal client's generator does, so no package
// imports an app. It fails when a committed file differs; `UPDATE_SPECIMENS=1` rewrites them.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { clientBundle, readExample, startNode, startWorker } from './harness.ts'
import { renumber } from './renumber.ts'

const SITE = join(import.meta.dirname, '../../../apps/site')
const OUT = join(SITE, 'src/generated/specimens')
const update = process.env.UPDATE_SPECIMENS === '1'

type Picture = {
  id: string
  example: string
  entry: string
  props?: object
  context?: object
  /** Route calls that set the example's data up first, such as adding a file to review. */
  before?: { path: string; method?: string; body?: unknown }[]
  meta: { title: string; caption: string; terminal: { columns: number; rows: number }; width: number }
}

const pictures = JSON.parse(readFileSync(join(SITE, 'specimens/examples.json'), 'utf8')) as Picture[]

it.each(pictures)('$id records the example tree it shows', async (picture) => {
  const example = readExample(picture.example)
  const node = example.manifest.node ? await startNode(example) : undefined
  const worker = await startWorker(await clientBundle(example))
  try {
    for (const call of picture.before ?? []) {
      expect((await node!.call(call.path, call).then((response) => response.status)) < 400, call.path).toBe(true)
    }
    const mounted = await worker.mount(picture.entry, { props: picture.props, context: picture.context, node })
    expect(mounted.failed).toBe(null)
    const generated = `${JSON.stringify({ meta: picture.meta, batches: renumber(mounted.batches) }, null, 2)}\n`
    const path = join(OUT, `${picture.id}.tree.json`)
    if (update) writeFileSync(path, generated)
    expect(
      readFileSync(path, 'utf8'),
      `${picture.id}.tree.json is stale. Run UPDATE_SPECIMENS=1 pnpm --filter @acorn/site specimens`,
    ).toBe(generated)
  } finally {
    worker.close()
    await node?.cleanup()
  }
})
