import { describe, expect, it } from 'vitest'
import { claudeCodeProfile } from './claudeCode'

// The argv this profile hands the process broker.
//
// Worth pinning because these arrays are the actual command line acorn spawns: a renamed or dropped flag
// produces a silently different invocation, not a boot-check failure. The rest of the descriptor is data,
// and `streamJson` is core's shared adapter with its own test suite, so neither needs a test here.

describe('the claude-code profile', () => {
  it('declares the identity terminal and workflows resolve it by', () => {
    // `id` is persisted; see docs/managed-agents.md § Providers.
    expect(claudeCodeProfile).toMatchObject({ id: 'claude-code', label: 'Claude Code', kind: 'agent', command: 'claude', transport: 'pty' })
  })

  // Asserts the whole array, not `toContain` per flag. A per-flag check missed dropping `-p` (the headless
  // runner then waits forever on a prompt) or `--verbose` (required by `-p --output-format stream-json`, so
  // claude exits with a usage error), and it missed an inserted `--dangerously-skip-permissions --add-dir /`
  // surviving untouched, which silently widens what a headless agent may do.
  //
  // Only the no-options invocation gets full equality, since it is the one case with a fixed answer; the
  // option-threading cases below stay as membership checks because they test presence or absence, not
  // order.
  it('builds a headless turn that streams JSON and never prompts for permission', () => {
    const { file, args } = claudeCodeProfile.headlessArgv!('claude', { prompt: 'do the thing' })
    expect(file).toBe('claude')
    // `-p` is headless mode itself; `--verbose` is required BY `-p --output-format stream-json`; dontAsk is why
    // a headless agent does not block on the first tool approval with nobody there to answer it. The prompt is
    // last and positional; a flag inserted after it would be read as part of it.
    expect(args).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk', 'do the thing'])
  })

  it('resumes a headless turn by prepending --resume, leaving the rest of the invocation identical', () => {
    // The one branch the no-options equality above cannot cover, and it comes first: after `-p`
    // claude reads the session ref as part of the prompt.
    const { args } = claudeCodeProfile.headlessArgv!('claude', { prompt: 'again', resumeSessionId: 'sess-1' })
    expect(args).toEqual(['--resume', 'sess-1', '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk', 'again'])
  })

  it('threads an optional model and schema through, and omits them when absent', () => {
    const withBoth = claudeCodeProfile.headlessArgv!('claude', { prompt: 'p', model: 'opus', schema: { type: 'object' } })
    expect(withBoth.args).toContain('--model')
    expect(withBoth.args).toContain('opus')
    expect(withBoth.args).toContain('--json-schema')
    expect(withBoth.args).toContain(JSON.stringify({ type: 'object' }))
    const withNeither = claudeCodeProfile.headlessArgv!('claude', { prompt: 'p' })
    expect(withNeither.args).not.toContain('--model')
    expect(withNeither.args).not.toContain('--json-schema')
  })

  it('resumes by session reference, which is what the terminal handoff spawns', () => {
    // plugins/agents' handoff runs this in a real PTY (contract/sessionsClient.ts § create), so the shape has
    // a second consumer beyond the headless runner.
    expect(claudeCodeProfile.resumeArgv!('claude', 'sess-1')).toEqual({ file: 'claude', args: ['--resume', 'sess-1'] })
  })

  it('disables tools for a one-shot decision, so an AI call cannot act', () => {
    // `aiArgv` is the structured-decision path (a workflow gate policy, an AI SQL draft). An empty
    // `--tools` is the whole difference from a headless turn: a decision reads, it does not edit. Pinned as
    // a whole array for the same reason as above: a check for `args[indexOf('--tools') + 1] === ''` would
    // still pass if a second, non-empty `--tools` or an inserted `--add-dir` were appended later.
    const { args } = claudeCodeProfile.aiArgv!('claude', { prompt: 'decide' })
    expect(args).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk', '--tools', '', 'decide'])
  })
})
