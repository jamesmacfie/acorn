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
  // The owner resets only its last pointer. The harness tears down every simulated orphan itself.
  for (const w of [...fake.syntax, ...fake.words]) w.terminate()
  fake.syntax = []; fake.words = []; fake.failFirst = false; fake.attempts = 0; fake.reply = true
  save()
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
  expect(syntax).toBe(8); expect(words).toBe(8)
})
it('an orphan error kills the current sibling worker', async () => {
  vi.stubGlobal('Worker', FixtureWorker); fake.reply = false
  const reads = Array.from({ length: 4 }, () => tokenizeDocument('synthetic.ts', 'const a = 1'))
  await vi.waitFor(() => expect(fake.syntax).toHaveLength(4))
  fake.syntax[0].onerror()
  await Promise.all(reads)
  records.push({ case: 'orphan-error', constructed: fake.syntax.length, terminated: fake.syntax.map((w) => w.terminated) })
  expect(fake.syntax[3].terminated).toBe(true); expect(fake.syntax[0].terminated).toBe(false)
})
it('does not recheck dead state after the import resumes', async () => {
  vi.stubGlobal('Worker', FixtureWorker); fake.failFirst = true
  await Promise.all(Array.from({ length: 4 }, () => tokenizeDocument('synthetic.ts', 'const a = 1')))
  const count = fake.syntax.length
  await tokenizeDocument('synthetic.ts', 'const b = 2')
  records.push({ case: 'constructor-failure-race', constructorAttempts: fake.attempts, constructed: count,
    laterConstructed: fake.syntax.length, liveBeforeReset: fake.syntax.filter((w) => !w.terminated).length })
  expect(count).toBe(3); expect(fake.syntax.length).toBe(3)
})
it('timeout leaves the stuck workers eligible for more requests', async () => {
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
  expect(fake.syntax).toHaveLength(1); expect(fake.syntax[0].terminated).toBe(false)
})
it('reset leaves pending promises and their timeout timers unresolved', async () => {
  vi.stubGlobal('Worker', FixtureWorker); vi.useFakeTimers(); fake.reply = false
  let syntaxSettled = false, wordsSettled = false
  const syntax = tokenizeDocument('synthetic.ts', 'const reset = 1').then(() => { syntaxSettled = true })
  const words = diffWordsDocument([{ oldText: 'reset-old', newText: 'reset-new' }]).then(() => { wordsSettled = true })
  await vi.waitFor(() => expect(fake.syntax.length + fake.words.length).toBe(2))
  resetHighlightWorker(); resetWordDiffWorker(); await Promise.resolve()
  const afterReset = { syntaxSettled, wordsSettled, timers: vi.getTimerCount() }
  await vi.advanceTimersByTimeAsync(10_001); await Promise.all([syntax, words])
  records.push({ case: 'reset-pending', afterReset, afterTimeout: { syntaxSettled, wordsSettled, timers: vi.getTimerCount() } })
  expect(afterReset).toEqual({ syntaxSettled: false, wordsSettled: false, timers: 2 })
})
