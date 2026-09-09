import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentProfileRegistry, type AgentProfileContribution } from '../agentProfiles'
import type { AppDatabase } from '../db'
import { ProviderRequestScheduler } from '../integrations/budgetRuntime'
import type { SecretService } from '../core/secrets'
import { createModelService } from '../core/models'
import { generateTextForHarness, harnessBackends } from './harnessRuntime'

// The connection branch is stubbed so the dispatch can be tested without a database, a provider
// registry or an encrypted secret — those are runtime.test.ts's subject. Everything the harness
// runtime itself imports from this module (the shared bounds) is kept.
vi.mock('./runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./runtime')>()
  return {
    ...actual,
    generateTextForConnection: vi.fn((args: { connectionId: string }) =>
      Promise.resolve({ text: 'from the key', providerId: 'anthropic', backendId: args.connectionId, modelId: 'm' }),
    ),
  }
})

// The committed stand-in for an agent CLI. A real CLI is never spawned in a test; this one reports
// back what it was handed, which is the only way to see the containment from outside.
const FAKE_AGENT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../apps/node/test/__fixtures__/fake-agent.sh')

type Report = { cwd: string; entries: number; args: string[]; env: Record<string, string> }

const readReport = (path: string): Report => {
  const report: Report = { cwd: '', entries: -1, args: [], env: {} }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const [key, ...rest] = line.split(' ')
    const value = rest.join(' ')
    if (key === 'cwd') report.cwd = value
    if (key === 'entries') report.entries = Number(value)
    if (key === 'arg') report.args.push(value)
    if (key === 'env') report.env[value.slice(0, value.indexOf('='))] = value.slice(value.indexOf('=') + 1)
  }
  return report
}

const input = { system: 'Answer with SQL only.', prompt: 'every order placed today', maxOutputTokens: 500 }

describe('generateTextForHarness', () => {
  let reportDir: string
  let reportPath: string
  let dispose: () => void

  const profile = (overrides: Partial<AgentProfileContribution> = {}): AgentProfileContribution => ({
    id: 'fixture-harness',
    label: 'Fixture Harness',
    kind: 'agent',
    command: FAKE_AGENT,
    backendPreference: 'node-pty',
    transport: 'pty',
    aiArgv: (command, opts) => ({
      file: command,
      // `--report` first: the fixture consumes it and runs on as normal. It has to arrive in argv
      // because the child environment is built from an allowlist, so nothing a test exports reaches it.
      args: [
        '--report',
        reportPath,
        ...(opts.system ? ['--system', opts.system] : []),
        ...(opts.model ? ['--model', opts.model] : []),
        opts.prompt,
      ],
    }),
    models: [{ id: 'sonnet', label: 'Sonnet' }],
    defaultModelId: 'sonnet',
    glyph: 'brand:agents/claude',
    ...overrides,
  })

  const register = (contribution: AgentProfileContribution): AgentProfileContribution => {
    dispose = agentProfileRegistry.register(contribution)
    return contribution
  }

  beforeEach(() => {
    // Outside the directory the generate runs in, so the report file cannot be what makes that
    // directory non-empty.
    reportDir = mkdtempSync(join(tmpdir(), 'harness-runtime-test-'))
    reportPath = join(reportDir, 'report.txt')
    dispose = () => undefined
  })

  afterEach(() => {
    dispose()
    rmSync(reportDir, { recursive: true, force: true })
  })

  it('spends the CLI in an empty room, with no credential and no acorn token in reach', async () => {
    register(profile())

    const result = await generateTextForHarness(
      { profileId: 'fixture-harness', input: { ...input, modelId: 'sonnet' } },
      new ProviderRequestScheduler(),
    )

    expect(result).toEqual({
      text: 'Done: reviewed the change.',
      providerId: 'fixture-harness',
      backendId: 'harness:fixture-harness',
      // What the CLI reported on its own stream, not what was asked for.
      modelId: 'fake',
    })

    const report = readReport(reportPath)
    // The whole array. The system prompt and the model are threaded through as the profile asked for
    // them, and the prompt stays last: a flag appended after it would be read as part of it.
    expect(report.args).toEqual(['--system', 'Answer with SQL only.', '--model', 'sonnet', 'every order placed today'])

    // An empty directory under the system temp root, not a worktree. Claude Code reads `CLAUDE.md` from
    // cwd and Codex reads `AGENTS.md`, so anything in here would join the prompt uninvited.
    expect(report.entries).toBe(0)
    expect(report.cwd.includes('acorn-generate-')).toBe(true)

    // The containment, named one variable at a time. `ACORN_API_TOKEN` is what would let a child call
    // back into the node; the two provider globs are what would hand a CLI a key acorn holds, when the
    // whole point is that it authenticates with its own stored login.
    expect(report.env.ACORN_API_TOKEN).toBeUndefined()
    expect(report.env.ACORN_API_URL).toBeUndefined()
    expect(report.env.ACORN_TOOL_CEILING).toBeUndefined()
    expect(Object.keys(report.env).filter((key) => key.startsWith('ANTHROPIC_') || key.startsWith('OPENAI_'))).toEqual([])
    // Anti-vacuity: an environment this empty would pass the three checks above by accident.
    expect(report.env.PATH).toBeTruthy()
  })

  it('takes the scratch directory away again, whatever the outcome', async () => {
    register(profile())
    const first = await generateTextForHarness({ profileId: 'fixture-harness', input }, new ProviderRequestScheduler())
    expect(first.text).toBeTruthy()
    expect(() => readFileSync(join(readReport(reportPath).cwd, 'anything'), 'utf8')).toThrow(/ENOENT/)
  })

  it('answers not-connected for a profile that is not installed, or has no one-shot mode', async () => {
    register(profile({ command: '/nonexistent/acorn-not-a-cli' }))
    await expect(generateTextForHarness({ profileId: 'fixture-harness', input }, new ProviderRequestScheduler()))
      .rejects.toMatchObject({ code: 'provider_not_connected', status: 404 })
    // The same answer for an id nobody registered: a client holding a stale id is not an internal
    // failure, it is the case a deleted connection already has a status for.
    await expect(generateTextForHarness({ profileId: 'ghost', input }, new ProviderRequestScheduler()))
      .rejects.toMatchObject({ code: 'provider_not_connected', status: 404 })
  })

  it('flattens a CLI that fails to unavailable, and keeps its stderr out of the error', async () => {
    // `false` is on PATH, exits non-zero and says nothing: the shape of a CLI that refuses.
    register(profile({ command: 'false', aiArgv: (command) => ({ file: command, args: [] }) }))
    await expect(generateTextForHarness({ profileId: 'fixture-harness', input }, new ProviderRequestScheduler()))
      .rejects.toMatchObject({ code: 'provider_unavailable', status: 502 })
  })

  it('refuses the same bounds a connection generate refuses, before spawning anything', async () => {
    register(profile())
    await expect(generateTextForHarness({ profileId: 'fixture-harness', input: { ...input, prompt: '  ' } }, new ProviderRequestScheduler()))
      .rejects.toMatchObject({ code: 'provider_bad_config', status: 400 })
    await expect(generateTextForHarness({ profileId: 'fixture-harness', input, timeoutMs: 120_000 }, new ProviderRequestScheduler()))
      .rejects.toMatchObject({ code: 'provider_bad_config', status: 400 })
  })
})

describe('harnessBackends', () => {
  it('lists an installed one-shot profile and sets the missing ones aside', async () => {
    const installed = agentProfileRegistry.register({
      id: 'fixture-installed', label: 'Installed', kind: 'agent', command: FAKE_AGENT,
      backendPreference: 'node-pty', transport: 'pty', glyph: 'brand:agents/claude',
      models: [{ id: 'sonnet', label: 'Sonnet' }], defaultModelId: 'sonnet',
      aiArgv: (command, opts) => ({ file: command, args: [opts.prompt] }),
    })
    const gone = agentProfileRegistry.register({
      id: 'fixture-gone', label: 'Gone', kind: 'agent', command: '/nonexistent/acorn-not-a-cli',
      backendPreference: 'node-pty', transport: 'pty',
      aiArgv: (command, opts) => ({ file: command, args: [opts.prompt] }),
    })
    // No `aiArgv`, so not a backend at all: the field is the opt-in.
    const terminalOnly = agentProfileRegistry.register({
      id: 'fixture-terminal-only', label: 'Terminal only', kind: 'agent', command: FAKE_AGENT,
      backendPreference: 'node-pty', transport: 'pty',
    })

    try {
      const { backends, missing } = await harnessBackends()
      expect(backends).toContainEqual({
        id: 'harness:fixture-installed',
        kind: 'harness',
        label: 'Installed',
        glyph: 'brand:agents/claude',
        models: [{ id: 'sonnet', label: 'Sonnet' }],
        defaultModelId: 'sonnet',
      })
      expect(missing.map((backend) => backend.id)).toContain('harness:fixture-gone')
      expect([...backends, ...missing].map((backend) => backend.id)).not.toContain('harness:fixture-terminal-only')
    } finally {
      installed()
      gone()
      terminalOnly()
    }
  })
})

describe('the dispatch on a backend id', () => {
  it('resolves a bare uuid and its connection: form to the same connection', async () => {
    // The compatibility rule the id scheme rests on. A saved `database:generate` step and the changes
    // plugin's device pref both hold a bare uuid from before core minted these ids, and neither is
    // rewritten, so both forms have to land on the same row forever.
    const service = createModelService(null as unknown as AppDatabase, null as unknown as SecretService)
    const uuid = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

    const bare = await service.generateText({ userId: 'alice', backendId: uuid, input })
    const prefixed = await service.generateText({ userId: 'alice', backendId: `connection:${uuid}`, input })

    expect(bare.backendId).toBe(uuid)
    expect(prefixed).toEqual(bare)
  })

  it('sends a harness id to the CLI runtime instead', async () => {
    const service = createModelService(null as unknown as AppDatabase, null as unknown as SecretService)
    // Nothing is registered under this id, so reaching the harness runtime is what the 404 proves; the
    // connection branch is stubbed and would have answered.
    await expect(service.generateText({ userId: 'alice', backendId: 'harness:ghost', input }))
      .rejects.toMatchObject({ code: 'provider_not_connected' })
  })
})
