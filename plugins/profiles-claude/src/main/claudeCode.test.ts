import { describe, expect, it } from 'vitest'
import { claudeCodeProfile } from './claudeCode'

// The argv this profile hands the process broker.
//
// The one thing worth pinning in a profile package, and it is not ceremony: these arrays ARE the command line
// acorn spawns, so a renamed or dropped flag is a silently broken agent — the CLI accepts the invocation and
// behaves differently, rather than failing in a way a boot check would notice. Nothing else here needs a test:
// the descriptor is otherwise data, and `streamJson` is core's shared adapter with its own suite.

describe('the claude-code profile', () => {
  it('declares the identity terminal and workflows resolve it by', () => {
    // `id` is persisted (a session row's profileId, a workflow step's `profile =`), so it is a compatibility
    // surface rather than a label.
    expect(claudeCodeProfile).toMatchObject({ id: 'claude-code', label: 'Claude Code', kind: 'agent', command: 'claude', transport: 'pty' })
  })

  // THE WHOLE ARRAY, not `toContain` per flag. `toContain` was the original shape and it could not see the two
  // failures that matter most here: `-p` and `--verbose` were in this argv and neither was asserted, so
  // dropping `-p` (the headless runner then waits forever on an interactive prompt) or `--verbose` (which
  // `-p --output-format stream-json` requires, so claude exits with a usage error) both passed. Nor could it
  // see an INSERTION — `--dangerously-skip-permissions --add-dir /` survived it untouched, which is the worst
  // case of the three because it silently widens what a headless agent may do.
  //
  // The equality is on the no-options invocation deliberately: it is the only form with a fixed answer, and the
  // option-threading cases below stay as membership checks because their job is presence/absence, not order.
  it('builds a headless turn that streams JSON and never prompts for permission', () => {
    const { file, args } = claudeCodeProfile.headlessArgv!('claude', { prompt: 'do the thing' })
    expect(file).toBe('claude')
    // `-p` is headless mode itself; `--verbose` is required BY `-p --output-format stream-json`; dontAsk is why
    // a headless agent does not block on the first tool approval with nobody there to answer it. The prompt is
    // last and positional — a flag inserted after it would be read as part of it.
    expect(args).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk', 'do the thing'])
  })

  it('resumes a headless turn by prepending --resume, leaving the rest of the invocation identical', () => {
    // The one branch the no-options equality above cannot cover, and it goes FIRST: after `-p` claude reads the
    // session ref as part of the prompt.
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
    // `aiArgv` is the structured-decision path (a workflow gate policy, an AI SQL draft). The EMPTY `--tools` is
    // the whole difference from a headless turn: a decision reads, it does not edit. Pinned as a whole array for
    // the same reason as above — the previous `args[indexOf('--tools') + 1] === ''` check would have accepted a
    // second, non-empty `--tools` appended later, and an inserted `--add-dir` alongside it.
    const { args } = claudeCodeProfile.aiArgv!('claude', { prompt: 'decide' })
    expect(args).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk', '--tools', '', 'decide'])
  })
})
