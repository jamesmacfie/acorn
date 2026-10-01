import { afterEach, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { tokenizeDocument, resetHighlightWorker } from '../../packages/client-core/src/infra/highlight/worker'
import { diffWordsDocument, resetWordDiffWorker } from '../../packages/client-core/src/infra/highlight/wordDiffWorker'
import { buildDiffRowsAsync } from '../../packages/client-core/src/kit/diff/diffModel'

const fake = vi.hoisted(() => ({ syntax: [] as any[], words: [] as any[], failFirst: false, attempts: 0, reply: true }))
class FixtureWorker {
  onmessage: any; onerror: any; terminated = false; words: boolean
  constructor(url: string) {
    this.words = String(url).includes('wordDiff')
    if (!this.words && fake.failFirst && fake.attempts++ === 0) throw new Error('synthetic constructor failure')
    ;(this.words ? fake.words : fake.syntax).push(this)
  }
  terminate() { this.terminated = true }
  postMessage(message: any) {
    if (fake.reply) queueMicrotask(() => this.onmessage({ data: { id: message.id, ok: true,
      ...(this.words ? { results: message.pairs.map((pair: any) => ({ del: [{ content: pair.oldText, kind: 'del' }], add: [{ content: pair.newText, kind: 'add' }] })) }
        : { lines: message.code.split('\n').map((content: string) => [{ content, light: '', dark: '' }]) }) } }))
  }
}
vi.mock('../../packages/client-core/src/infra/highlight/shiki', () => ({ getHighlighter: async () => ({ codeToTokensWithThemes: (text: string) => [[{
  content: text, variants: { light: { color: 'black' }, dark: { color: 'white' } },
}]] }) }))
const records: any[] = []
const save = () => writeFileSync(`${process.cwd()}/plans/performance/10-workers-${process.env.ACORN_PERF_TAG ?? 'sample'}.json`, JSON.stringify(records, null, 2) + '\n')
afterEach(() => {
  resetHighlightWorker(); resetWordDiffWorker(); vi.unstubAllGlobals(); vi.useRealTimers()
  // Cleanup also terminates fixture instances to keep failed assertions resource-safe.
  for (const w of [...fake.syntax, ...fake.words]) w.terminate()
  fake.syntax = []; fake.words = []; fake.failFirst = false; fake.attempts = 0; fake.reply = true
  save()
})
it('preserves ordinary single-file cold and sequential warm document builds', async () => {
  vi.stubGlobal('Worker', FixtureWorker)
  const file = { path: 'ordinary.ts', status: 'modified', additions: 1, deletions: 1, sha: 'ordinary', viewed: false,
    patch: '@@ -1,2 +1,2 @@\n-const old = 1\n+const next = 2\n context\n' }
  const first = await buildDiffRowsAsync(file, tokenizeDocument, diffWordsDocument)
  const cold = { syntax: fake.syntax.length, words: fake.words.length }
  for (let at = 0; at < 4; at++) expect(await buildDiffRowsAsync(file, tokenizeDocument, diffWordsDocument)).toEqual(first)
  records.push({ case: 'ordinary-cold-and-four-warm-builds', cold, afterWarm: { syntax: fake.syntax.length, words: fake.words.length }, rows: first.length })
  expect(cold).toEqual({ syntax: 1, words: 1 }); expect(fake.syntax.length + fake.words.length).toBe(2)
})
it('counts actual concurrent cold buildDiffRowsAsync worker owners', async () => {
  vi.stubGlobal('Worker', FixtureWorker)
  const files = Array.from({ length: 8 }, (_, n) => ({ path: `synthetic-${n}.ts`, status: 'modified', additions: 1, deletions: 1,
    sha: `${n}`, viewed: false, patch: '@@ -1,2 +1,2 @@\n-const a = 1\n+const b = 2\n context\n' }))
  const rows = await Promise.all(files.map((file) => buildDiffRowsAsync(file, tokenizeDocument, diffWordsDocument)))
  const syntax = fake.syntax.length, words = fake.words.length
  resetHighlightWorker(); resetWordDiffWorker()
  records.push({ case: 'concurrent-cold-production-builds', files: files.length, syntax, words,
    liveAfterReset: { syntax: fake.syntax.filter((w) => !w.terminated).length, words: fake.words.filter((w) => !w.terminated).length }, rows: rows.map((r) => r.length) })
  expect(syntax).toBe(1); expect(words).toBe(1)
})
it('old-generation errors cannot kill replacement workers', async () => {
  vi.stubGlobal('Worker', FixtureWorker); fake.reply = false
  const first = tokenizeDocument('synthetic.ts', 'old')
  await vi.waitFor(() => expect(fake.syntax).toHaveLength(1))
  const old = fake.syntax[0], oldError = old.onerror, oldMessage = old.onmessage
  resetHighlightWorker(); await first
  fake.reply = true
  await tokenizeDocument('synthetic.ts', 'replacement')
  oldError(); oldMessage({ data: { id: 1, ok: true, lines: [] } })
  records.push({ case: 'old-generation-error', constructed: fake.syntax.length, terminated: fake.syntax.map((w) => w.terminated) })
  expect(fake.syntax[0].terminated).toBe(true); expect(fake.syntax[1].terminated).toBe(false)
})
it('serializes a failed cold constructor without reviving the dead owner', async () => {
  vi.stubGlobal('Worker', FixtureWorker); fake.failFirst = true
  await Promise.all(Array.from({ length: 4 }, () => tokenizeDocument('synthetic.ts', 'const a = 1')))
  const count = fake.syntax.length
  await tokenizeDocument('synthetic.ts', 'const b = 2')
  records.push({ case: 'constructor-failure-race', constructorAttempts: fake.attempts, constructed: count,
    laterConstructed: fake.syntax.length, liveBeforeReset: fake.syntax.filter((w) => !w.terminated).length })
  expect(count).toBe(0); expect(fake.syntax.length).toBe(0)
})
it('timeout retires stuck workers and settles later calls without posting', async () => {
  vi.stubGlobal('Worker', FixtureWorker); vi.useFakeTimers(); fake.reply = false
  const firstSyntax = tokenizeDocument('synthetic.ts', 'const a = 1')
  const firstWords = diffWordsDocument([{ oldText: 'old', newText: 'new' }])
  await vi.waitFor(() => expect(fake.syntax.length + fake.words.length).toBe(2))
  await vi.advanceTimersByTimeAsync(10_001)
  await Promise.all([firstSyntax, firstWords])
  const secondSyntax = tokenizeDocument('synthetic.ts', 'const b = 2')
  const secondWords = diffWordsDocument([{ oldText: 'old2', newText: 'new2' }])
  await vi.advanceTimersByTimeAsync(10_001)
  await Promise.all([secondSyntax, secondWords])
  records.push({ case: 'timeout-reuse', syntax: fake.syntax.length, words: fake.words.length,
    terminated: [...fake.syntax, ...fake.words].map((w) => w.terminated) })
  expect(fake.syntax).toHaveLength(1); expect(fake.syntax[0].terminated).toBe(true)
})
it('reset settles pending promises and clears their deadline timers', async () => {
  vi.stubGlobal('Worker', FixtureWorker); vi.useFakeTimers(); fake.reply = false
  let syntaxSettled = false, wordsSettled = false
  const syntax = tokenizeDocument('synthetic.ts', 'const reset = 1').then(() => { syntaxSettled = true })
  const words = diffWordsDocument([{ oldText: 'reset-old', newText: 'reset-new' }]).then(() => { wordsSettled = true })
  await vi.waitFor(() => expect(fake.syntax.length + fake.words.length).toBe(2))
  resetHighlightWorker(); resetWordDiffWorker(); await Promise.all([syntax, words])
  const afterReset = { syntaxSettled, wordsSettled, timers: vi.getTimerCount() }
  await vi.advanceTimersByTimeAsync(10_001); await Promise.all([syntax, words])
  records.push({ case: 'reset-pending', afterReset, afterTimeout: { syntaxSettled, wordsSettled, timers: vi.getTimerCount() } })
  expect(afterReset).toEqual({ syntaxSettled: true, wordsSettled: true, timers: 0 })
})
