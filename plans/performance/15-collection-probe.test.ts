import { expect, it } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCollectionIntents, createTypeAhead } from '../../packages/client-core/src/kit/keys/collectionIntents'
import { _resetCollectionState } from '../../packages/client-core/src/kit/keys/collectionState'

it('counts real collection work while moving near the end of a long list', () => {
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'
  if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Unsafe output tag')
  const path = join(dirname(fileURLToPath(import.meta.url)), `15-collection-${tag}.json`)
  if (tag.startsWith('before') && existsSync(path)) throw new Error('Before evidence exists')
  const cases: unknown[] = []
  for (const count of [100, 1000, 5000]) {
    _resetCollectionState()
    let disabledReads = 0
    const items = Array.from({ length: count }, (_, at) => ({ key: `row-${at}`, label: `row-${at}`, get disabled() { disabledReads++; return false } }))
    const collection = createCollectionIntents({ id: () => `collection-${count}`, items: () => items,
      land: () => {}, onItem: () => true })
    collection.goTo(`row-${count - 2}`)
    const measured = (run: () => void) => {
      disabledReads = 0
      const cpu = process.cpuUsage(), started = performance.now()
      run()
      const used = process.cpuUsage(cpu)
      return { disabledReads, cpuMs: (used.user + used.system) / 1000, wallMs: performance.now() - started }
    }
    const next = measured(() => { collection.handle('next') })
    expect(collection.active()).toBe(`row-${count - 1}`)
    const page = measured(() => { collection.handle('pagePrev') })
    const typeAhead = createTypeAhead(collection)
    const type = measured(() => { typeAhead('r') })
    const plainItems = Array.from({ length: count }, (_, at) => ({ key: `row-${at}`, label: `row-${at}`, disabled: false }))
    const plainCollection = createCollectionIntents({ id: () => `plain-collection-${count}`, items: () => plainItems,
      land: () => {}, onItem: () => true })
    plainCollection.goTo(`row-${count - 2}`)
    const plainMeasured = (run: () => void) => {
      const cpu = process.cpuUsage(), started = performance.now(); run()
      const used = process.cpuUsage(cpu)
      return { cpuMs: (used.user + used.system) / 1000, wallMs: performance.now() - started }
    }
    const plainNext = plainMeasured(() => { plainCollection.handle('next') })
    const plainPage = plainMeasured(() => { plainCollection.handle('pagePrev') })
    const plainTypeAhead = createTypeAhead(plainCollection)
    const plainType = plainMeasured(() => { plainTypeAhead('r') })
    cases.push({ count, next, page, type, plainItems: { next: plainNext, page: plainPage, type: plainType } })
  }
  _resetCollectionState()
  writeFileSync(path, JSON.stringify({ fixture: 'Actual shared collectionIntents; synthetic stable list, disabled getter counts full enabled scans; near-tail next/page/type-ahead', cases }, null, 2) + '\n')
})
