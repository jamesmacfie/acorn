import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import Markdown from '../../packages/client-core/src/kit/components/content/Markdown'
import { getHighlighter, highlightToHtml, resetHighlightHtmlCache } from '../../packages/client-core/src/infra/highlight/shiki'

it('measures actual Markdown fence highlighting and obsolete queued blocks', async () => {
  const hl = await getHighlighter('typescript')
  const actual = hl.codeToHtml.bind(hl)
  const calls: { characters: number; htmlCharacters: number; elapsedMs: number; cpuMs: number }[] = []
  const spy = vi.spyOn(hl, 'codeToHtml').mockImplementation((code: string, options: any) => {
    const started = performance.now(), cpu = process.cpuUsage()
    const html = actual(code, options)
    const used = process.cpuUsage(cpu)
    calls.push({ characters: code.length, htmlCharacters: html.length, elapsedMs: performance.now() - started, cpuMs: (used.user + used.system) / 1000 })
    return html
  })
  const host = document.createElement('div'); document.body.append(host)
  const [text, setText] = createSignal('```ts\nconst warm = 1\n```')
  const dispose = render(() => <Markdown text={text()} />, host)
  await vi.waitFor(() => expect(host.querySelector('pre.shiki')).not.toBeNull(), { timeout: 10_000 })
  const results: any[] = []
  const codeFor = (chars: number) => 'const syntheticValue = { field: "sample", count: 42 };\n'.repeat(Math.ceil(chars / 54)).slice(0, chars)
  for (const size of [20_000, 80_000]) {
    resetHighlightHtmlCache(); const startCalls = calls.length
    const code = codeFor(size), started = performance.now(), cpu = process.cpuUsage()
    for (let frame = 0; frame < 4; frame++) {
      setText('```ts\n' + code + `\n// frame ${frame}\n` + '```')
      await vi.waitFor(() => expect(calls.length).toBe(startCalls + frame + 1), { timeout: 20_000, interval: 1 })
    }
    const used = process.cpuUsage(cpu), samples = calls.slice(startCalls)
    results.push({ case: 'settled-growing-fence', codeCharacters: size, frames: 4, samples,
      totalCharacters: samples.reduce((sum, s) => sum + s.characters, 0), totalHighlightMs: samples.reduce((sum, s) => sum + s.elapsedMs, 0),
      wallMs: performance.now() - started, cpuMs: (used.user + used.system) / 1000,
      elements: host.querySelectorAll('*').length, spans: host.querySelectorAll('pre span').length })
  }
  resetHighlightHtmlCache(); let from = calls.length
  const duplicate = codeFor(10_000)
  await Promise.all(Array.from({ length: 8 }, () => highlightToHtml(duplicate, 'typescript')))
  results.push({ case: 'same-small-cold-cache-inflight', callers: 8, calls: calls.length - from, characters: calls.slice(from).reduce((sum, s) => sum + s.characters, 0) })
  from = calls.length
  for (let frame = 0; frame < 8; frame++) setText('```ts\n' + codeFor(20_000) + `\n// burst ${frame}\n` + '```')
  await vi.waitFor(() => expect(calls.length).toBe(from + (process.env.ACORN_PERF_TAG?.includes('after') ? 1 : 8)), { timeout: 20_000 })
  results.push({ case: 'same-tick-replaced-fences', updates: 8, stillLive: 1, highlightCalls: calls.length - from,
    characters: calls.slice(from).reduce((sum, s) => sum + s.characters, 0), highlightMs: calls.slice(from).reduce((sum, s) => sum + s.elapsedMs, 0) })
  from = calls.length
  setText('```ts\n' + codeFor(20_000) + '\n// disposed\n```'); dispose()
  await vi.waitFor(() => expect(calls.length).toBe(from + (process.env.ACORN_PERF_TAG?.includes('after') ? 0 : 1)), { timeout: 10_000 })
  results.push({ case: 'dispose-before-import-resumes', highlightCalls: calls.length - from, characters: calls[from]?.characters ?? 0 })
  writeFileSync(`${process.cwd()}/plans/performance/10-markdown-${process.env.ACORN_PERF_TAG ?? 'sample'}.json`, JSON.stringify(results, null, 2) + '\n')
  spy.mockRestore(); host.remove()
}, 60_000)
