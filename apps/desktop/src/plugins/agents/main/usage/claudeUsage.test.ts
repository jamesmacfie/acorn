import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectClaudeUsage,
  parseClaudeCostOutput,
  parseClaudeReset,
  parseClaudeUsageOutput,
  trustClaudeProbeDirectory,
} from './claudeUsage'
import type { PtyCaptureOptions } from './processRunner'

const roots: string[] = []
const capturedAt = new Date(2026, 6, 24, 12).getTime()

const usageOutput = `
Opus 4.6 · Claude Max
Current session
████ 12% used
Resets in 2h 15m

Current week (all models)
████ 63% left
Resets Jul 28, 2026

Current week (Fable 5)
████ 27% used
Resets in 1d 3h

Extra usage
$5.41 / $20.00 spent · Resets Aug 1, 2026
`

afterEach(async () => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; probeDir: string; configFile: string; claudeDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'acorn-claude-probe-'))
  roots.push(root)
  const probeDir = join(root, 'probe')
  const claudeDir = join(root, '.claude')
  const configFile = join(root, '.claude.json')
  await mkdir(claudeDir, { recursive: true })
  await writeFile(
    configFile,
    JSON.stringify({ theme: 'dark', oauthAccount: { emailAddress: 'person@example.test', displayName: 'Example Org' } }),
    { mode: 0o600 },
  )
  return { root, probeDir, configFile, claudeDir }
}

describe('Claude usage parsing', () => {
  it('normalizes used/left percentages, model limits, resets, plan, and extra usage', () => {
    const provider = parseClaudeUsageOutput(usageOutput, capturedAt, { email: 'person@example.test', organization: 'Org' })
    expect(provider).toMatchObject({
      availability: 'available',
      health: 'healthy',
      plan: 'Claude Max',
      account: { email: 'person@example.test', organization: 'Org' },
    })
    expect(provider.quotas).toEqual([
      expect.objectContaining({ id: 'session', percentRemaining: 88, health: 'healthy', resetText: 'Resets in 2h 15m' }),
      expect.objectContaining({ id: 'weekly', percentRemaining: 63, health: 'healthy' }),
      expect.objectContaining({ id: 'model:fable', label: 'Fable', percentRemaining: 73, resetText: 'Resets in 1d 3h' }),
    ])
    expect(provider.quotas[0].resetsAt).toBe(capturedAt + (2 * 60 + 15) * 60_000)
    expect(provider.cost).toMatchObject({
      source: 'extra_usage',
      spentUsd: 5.41,
      budgetUsd: 20,
      remainingUsd: 14.59,
    })
  })

  it('parses CLI cost and API duration without fabricating quota', () => {
    const provider = parseClaudeCostOutput('Total cost: $0.55\nTotal duration (API): 2h 6m 19.7s', capturedAt)
    expect(provider.quotas).toEqual([])
    expect(provider.cost).toMatchObject({ source: 'cli_cost', spentUsd: 0.55, apiDurationSeconds: 7_579.7 })
  })

  it('classifies authentication, update, trust, and malformed output', () => {
    expect(() => parseClaudeUsageOutput('token_expired')).toThrowError(expect.objectContaining({ code: 'authentication_required' }))
    expect(() => parseClaudeUsageOutput('Please update Claude')).toThrowError(expect.objectContaining({ code: 'update_required' }))
    expect(() => parseClaudeUsageOutput('Do you trust the files in this folder?')).toThrowError(expect.objectContaining({ code: 'trust_failure' }))
    expect(() => parseClaudeUsageOutput('nothing useful')).toThrowError(expect.objectContaining({ code: 'parse_failure' }))
  })

  it('keeps reset text when an absolute format cannot be parsed', () => {
    expect(parseClaudeReset('Resets 4:59pm (Pacific/Auckland)', capturedAt)).toBeNull()
  })
})

describe('Claude collection and trust handling', () => {
  it('uses stored CLI credentials, reads public account metadata, and never forwards the setup token', async () => {
    const paths = await fixture()
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'must-not-leak'
    const seen: PtyCaptureOptions[] = []
    const provider = await collectClaudeUsage({
      ...paths,
      now: () => capturedAt,
      runPty: async (options) => {
        seen.push(options)
        return { output: usageOutput, exitCode: null }
      },
    })
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    expect(seen[0]?.env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN')
    expect(provider.account).toEqual({ email: 'person@example.test', organization: 'Example Org' })
  })

  it('atomically preserves unknown config keys while trusting only the dedicated probe directory', async () => {
    const paths = await fixture()
    expect(await trustClaudeProbeDirectory(paths.configFile, paths.probeDir)).toBe(true)
    const saved = JSON.parse(await readFile(paths.configFile, 'utf8')) as {
      theme: string
      projects: Record<string, { hasTrustDialogAccepted: boolean }>
    }
    expect(saved.theme).toBe('dark')
    expect(saved.projects).toEqual({ [paths.probeDir]: { hasTrustDialogAccepted: true } })
  })

  it('retries usage once after a trust prompt and falls back to /cost for API accounts', async () => {
    const paths = await fixture()
    const commands: string[] = []
    const outputs = [
      'Do you trust the files in this folder?',
      '/usage is only available for subscription plans',
      'Total cost: $1.25\nTotal duration (API): 3m 2s',
    ]
    const provider = await collectClaudeUsage({
      ...paths,
      now: () => capturedAt,
      runPty: async (options) => {
        commands.push(options.args[0])
        return { output: outputs.shift() ?? '', exitCode: null }
      },
    })
    expect(commands).toEqual(['/usage', '/usage', '/cost'])
    expect(provider.cost).toMatchObject({ source: 'cli_cost', spentUsd: 1.25, apiDurationSeconds: 182 })
  })

  it('refuses to overwrite unexpected project config shapes', async () => {
    const paths = await fixture()
    await writeFile(paths.configFile, JSON.stringify({ projects: [] }))
    expect(await trustClaudeProbeDirectory(paths.configFile, paths.probeDir)).toBe(false)
    expect(JSON.parse(await readFile(paths.configFile, 'utf8'))).toEqual({ projects: [] })
  })
})
