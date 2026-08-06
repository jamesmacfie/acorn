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

  it('builds a headless turn that streams JSON and never prompts for permission', () => {
    const { file, args } = claudeCodeProfile.headlessArgv!('claude', { prompt: 'do the thing' })
    expect(file).toBe('claude')
    // Both are load-bearing: without stream-json the runner cannot parse turns at all, and without
    // dontAsk a headless agent blocks forever on the first tool approval with nobody to answer it.
    expect(args).toContain('--output-format')
    expect(args).toContain('stream-json')
    expect(args.join(' ')).toContain('--permission-mode dontAsk')
    // The prompt goes last, positionally — a flag inserted after it would be read as part of it.
    expect(args.at(-1)).toBe('do the thing')
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
    // `aiArgv` is the structured-decision path (a workflow gate policy, an AI SQL draft). It passes an EMPTY
    // `--tools`, which is the whole difference from a headless turn: a decision reads, it does not edit.
    const { args } = claudeCodeProfile.aiArgv!('claude', { prompt: 'decide' })
    expect(args[args.indexOf('--tools') + 1]).toBe('')
  })
})
