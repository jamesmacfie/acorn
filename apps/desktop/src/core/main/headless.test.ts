import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildHeadlessArgv, parseStreamJson, runHeadless } from './headless'

const FAKE_AGENT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures/fake-agent.sh')

describe('argv templates (docs/next 14 — flags verified against installed CLIs)', () => {
  it('claude-code: -p stream-json with permission pre-approval, model, inline schema, resume', () => {
    const argv = buildHeadlessArgv('claude-code', 'claude', {
      prompt: 'Review the change.',
      model: 'opus',
      schema: { type: 'object' },
      resumeSessionId: 'sess-1',
    })
    expect(argv).toEqual({
      file: 'claude',
      args: [
        '--resume',
        'sess-1',
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'dontAsk',
        '--model',
        'opus',
        '--json-schema',
        '{"type":"object"}',
        'Review the change.',
      ],
    })
  })
  it('codex: exec --json with the schema materialised to a FILE', () => {
    const argv = buildHeadlessArgv('codex', 'codex', { prompt: 'Go.', model: 'o3', schema: { type: 'object' } })
    expect(argv?.file).toBe('codex')
    expect(argv?.args.slice(0, 4)).toEqual(['exec', '--json', '-m', 'o3'])
    const schemaIdx = argv!.args.indexOf('--output-schema')
    expect(schemaIdx).toBeGreaterThan(0)
    expect(readFileSync(argv!.args[schemaIdx + 1], 'utf8')).toBe('{"type":"object"}')
    expect(argv?.args.at(-1)).toBe('Go.')
  })
  it('profiles without a headless mode return null', () => {
    expect(buildHeadlessArgv('shell', '/bin/zsh', { prompt: 'x' })).toBeNull()
    expect(buildHeadlessArgv('aider', 'aider', { prompt: 'x' })).toBeNull()
  })
})

describe('parseStreamJson (pure)', () => {
  it('extracts the final result event and keeps all events', () => {
    const out = parseStreamJson(
      ['{"type":"system","session_id":"s1"}', 'not json noise', '{"type":"result","result":"done","structured_output":{"a":1},"session_id":"s1","total_cost_usd":0.5}'].join('\n'),
    )
    expect(out.result).toBe('done')
    expect(out.structuredOutput).toEqual({ a: 1 })
    expect(out.sessionId).toBe('s1')
    expect(out.costUsd).toBe(0.5)
    expect(out.events).toHaveLength(2)
  })
})

describe('runHeadless against the committed fake agent (no real CLIs)', () => {
  let cwd: string
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'acorn-headless-'))
  })
  afterEach(() => rmSync(cwd, { recursive: true, force: true }))

  const env = (mode: string, structured?: string) => ({
    PATH: process.env.PATH ?? '',
    FAKE_AGENT_MODE: mode,
    ...(structured ? { FAKE_AGENT_STRUCTURED: structured } : {}),
  })

  // The fake agent rides the SAME argv-template path a real profile would.
  const argv = () => buildHeadlessArgv('claude-code', FAKE_AGENT, { prompt: 'Review.', schema: { type: 'object' } })!

  it('success: captures result + validated structured output + session id + cost', async () => {
    const res = await runHeadless(argv(), { cwd, env: env('ok', '{"verdict":"fail","blocking":true}') })
    expect(res.status).toBe('ok')
    expect(res.exitCode).toBe(0)
    expect(res.capture.result).toBe('Done: reviewed the change.')
    expect(res.capture.structuredOutput).toEqual({ verdict: 'fail', blocking: true })
    expect(res.capture.sessionId).toBe('fake-sess-1')
    expect(res.capture.costUsd).toBe(0.0123)
    expect(res.capture.events.length).toBeGreaterThanOrEqual(3)
  })

  it('non-zero exit → error with the stderr tail', async () => {
    const res = await runHeadless(argv(), { cwd, env: env('fail') })
    expect(res.status).toBe('error')
    expect(res.exitCode).toBe(2)
    expect(res.stderrTail).toContain('simulated failure')
  })

  it('timeout kills the child', async () => {
    const res = await runHeadless(argv(), { cwd, env: env('hang'), timeoutMs: 500 })
    expect(res.status).toBe('timeout')
  }, 10_000)

  it('abort kills the process group and reports cancellation', async () => {
    const controller = new AbortController()
    const pending = runHeadless(argv(), { cwd, env: env('hang'), signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    expect((await pending).status).toBe('cancelled')
  }, 10_000)

  it('malformed output → typed error, never a guess', async () => {
    const res = await runHeadless(argv(), { cwd, env: env('malformed') })
    expect(res.status).toBe('malformed')
    expect(res.exitCode).toBe(0)
    expect(res.capture.result).toBeNull()
  })

  it('missing binary → clean error result', async () => {
    const res = await runHeadless({ file: '/nonexistent/agent', args: [] }, { cwd, env: env('ok') })
    expect(res.status).toBe('error')
    expect(res.stderrTail).toContain('ENOENT')
  })
})
