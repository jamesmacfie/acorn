import { it, expect } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, appendFile, stat, rename, truncate, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { analyzeClaudeDailyUsage, parseClaudeUsageJsonl } from '../../plugins/agents/src/server/usage/claudeDailyUsage'
import { emptyAgentPricingPreferences } from '../../plugins/agents/src/shared/pricing'

const at = new Date(2026, 9, 1, 15).getTime()
const line = (id: string, input = 10, time = at) => JSON.stringify({
  type: 'assistant', timestamp: new Date(time).toISOString(), requestId: id,
  message: { id, model: 'claude-sonnet-4-6', usage: { input_tokens: input, output_tokens: 20 } },
})
const save = (name: string, value: unknown) => writeFile(
  new URL(`./09-${name}-${process.env.ACORN_PERF_TAG ?? 'sample'}.json`, import.meta.url),
  JSON.stringify(value, null, 2) + '\n',
)
const measured = async (fn: () => Promise<unknown>) => {
  const cpu = process.cpuUsage(), wall = performance.now(), rss = process.memoryUsage().rss
  const value = await fn()
  return { wallMs: performance.now() - wall, cpuMs: Object.values(process.cpuUsage(cpu)).reduce((a, b) => a + b, 0) / 1000,
    rssDeltaBytes: process.memoryUsage().rss - rss, value }
}

it('measures unchanged synthetic histories and preserves mutation semantics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acorn-perf09-daily-'))
  try {
    const project = join(root, 'projects', 'synthetic')
    await mkdir(project, { recursive: true })
    const reports = []
    for (const files of [1, 40, 200]) {
      for (let f = files === 1 ? 0 : files === 40 ? 1 : 40; f < files; f++) {
        await writeFile(join(project, `${String(f).padStart(4, '0')}.jsonl`),
          Array.from({ length: 1000 }, (_, r) => line(`${f}:${r}`)).join('\n') + '\n')
      }
      const totalBytes = (await Promise.all(Array.from({ length: files }, (_, f) => stat(join(project, `${String(f).padStart(4, '0')}.jsonl`))))).reduce((sum, item) => sum + item.size, 0)
      const runs = []
      for (let n = 0; n < 3; n++) {
        const read = await measured(() => analyzeClaudeDailyUsage(root, at))
        const value = read.value as Awaited<ReturnType<typeof analyzeClaudeDailyUsage>>
        expect(value.today.inputTokens).toBe(files * 1000 * 10)
        runs.push({ ...read, value: undefined, tokens: value.today.totalNonCacheTokens, skipped: value.skippedFileCount })
      }
      reports.push({ files, records: files * 1000, totalBytes, runs })
    }
    const historyMutations = []
    const historyFile = join(project, '0000.jsonl')
    await appendFile(historyFile, line('0:0', 99) + '\n')
    const appended = await measured(() => analyzeClaudeDailyUsage(root, at))
    expect((appended.value as any).today.inputTokens).toBe(2_000_089)
    historyMutations.push({ mutation: 'one file appended duplicate update', ...appended, value: undefined })
    await writeFile(join(project, 'replacement.tmp'), line('replacement', 14) + '\n')
    await rename(join(project, 'replacement.tmp'), historyFile)
    const replaced = await measured(() => analyzeClaudeDailyUsage(root, at))
    expect((replaced.value as any).today.inputTokens).toBe(1_990_014)
    historyMutations.push({ mutation: 'one file replaced', ...replaced, value: undefined })
    // Tiny fixtures make the exact mutation semantics easy to review.
    const mutations = join(root, 'mutations'), mp = join(mutations, 'projects', 'x')
    await mkdir(mp, { recursive: true })
    const file = join(mp, 'a.jsonl'), other = join(mp, 'b.jsonl')
    await writeFile(file, line('same', 10) + '\n')
    const read = async (now = at, pricing = emptyAgentPricingPreferences()) => analyzeClaudeDailyUsage(mutations, now, pricing)
    const checks: Record<string, unknown> = { initial: await read() }
    await appendFile(file, line('same', 12) + '\n' + line('append', 7) + '\n{"type":"assistant"')
    checks.appendPartial = await read()
    expect((checks.appendPartial as any).today.inputTokens).toBe(19)
    await writeFile(other, line('same', 99) + '\n')
    checks.crossFileDedup = await read()
    expect((checks.crossFileDedup as any).today.inputTokens).toBe(106)
    await truncate(file, 0)
    checks.truncate = await read()
    expect((checks.truncate as any).today.inputTokens).toBe(99)
    await writeFile(join(mp, 'replacement.tmp'), line('replacement', 8) + '\n')
    await rename(join(mp, 'replacement.tmp'), other)
    checks.replace = await read()
    expect((checks.replace as any).today.inputTokens).toBe(8)
    checks.rollover = await read(new Date(2026, 9, 2, 1).getTime())
    expect((checks.rollover as any).today.inputTokens).toBe(0)
    expect((checks.rollover as any).yesterday.inputTokens).toBe(8)
    const pricing = emptyAgentPricingPreferences()
    pricing.claude.customModels.push({ model: 'claude-sonnet-4-6', price: { input: 7, output: 0, cacheWrite: 0, cacheRead: 0 } })
    checks.pricing = await read(at, pricing)
    expect((checks.pricing as any).today.estimatedCostUsd).toBe(8 * 7 / 1_000_000)
    const old = new Date(2026, 8, 20)
    await utimes(other, old, old)
    checks.oldMtime = await read()
    expect((checks.oldMtime as any).today.inputTokens).toBe(0)
    await save('daily', { at, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, reports, historyMutations, checks })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('measures an accepted compact file exceeding the spread argument bound', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acorn-perf09-spread-'))
  try {
    const project = join(root, 'projects', 'synthetic')
    await mkdir(project, { recursive: true })
    const compact = JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { model: 'x', usage: {} } }) + '\n'
    const records = 200_000, content = compact.repeat(records)
    expect(Buffer.byteLength(content)).toBeLessThan(32 * 1024 * 1024)
    await writeFile(join(project, 'accepted.jsonl'), content)
    expect(parseClaudeUsageJsonl(content)).toHaveLength(records)
    const read = await measured(() => analyzeClaudeDailyUsage(root, at))
    const value = read.value as Awaited<ReturnType<typeof analyzeClaudeDailyUsage>>
    // Baseline characterization: one valid file is silently counted as skipped after spread throws.
    expect(value.skippedFileCount).toBe(1)
    expect(value.today.sessionCount).toBe(0)
    await save('daily-spread', { records, bytes: Buffer.byteLength(content), ...read })
  } finally { await rm(root, { recursive: true, force: true }) }
})
