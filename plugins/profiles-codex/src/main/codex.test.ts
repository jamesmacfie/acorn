import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codexProfile } from './codex'

// The argv this profile hands the process broker — see the claude-code suite for why that is the one thing
// worth pinning in a profile package.

describe('the codex profile', () => {
  it('declares the identity terminal and workflows resolve it by', () => {
    // `id` is persisted (a session row's profileId, a workflow step's `profile =`), so it is a compatibility
    // surface rather than a label.
    expect(codexProfile).toMatchObject({ id: 'codex', label: 'Codex', kind: 'agent', command: 'codex', transport: 'pty' })
  })

  // THE WHOLE ARRAY, not a prefix slice plus a last-element check. Those two together left the MIDDLE of the
  // argv unasserted, so anything inserted between `--json` and the prompt — a sandbox opt-out, an extra
  // `--config` — passed. Same change as the claude suite, same reason: these arrays are the command line.
  it('builds a headless turn as `exec --json`, with the prompt last', () => {
    const { file, args } = codexProfile.headlessArgv!('codex', { prompt: 'do the thing' })
    expect(file).toBe('codex')
    expect(args).toEqual(['exec', '--json', 'do the thing'])
  })

  it('materializes a schema to a FILE, because codex takes a path where claude takes JSON', () => {
    // The divergence worth a test: `--output-schema` wants a path, so the profile writes a temp file. A change
    // that passed the JSON inline would produce an invocation codex rejects — or worse, treats as a filename.
    const { args } = codexProfile.headlessArgv!('codex', { prompt: 'p', schema: { type: 'object' } })
    const path = args[args.indexOf('--output-schema') + 1]
    expect(path).toMatch(/schema\.json$/)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ type: 'object' })
  })

  it('threads an optional model through as -m, and omits it when absent', () => {
    // `-m`, not `--model`: the flag differs from claude's and a shared helper would get one of them wrong.
    expect(codexProfile.headlessArgv!('codex', { prompt: 'p', model: 'gpt-5' }).args).toContain('-m')
    expect(codexProfile.headlessArgv!('codex', { prompt: 'p' }).args).not.toContain('-m')
  })

  it('resumes by session reference as a SUBCOMMAND, not a flag', () => {
    // `resume <ref>` where claude uses `--resume <ref>`. plugins/agents' terminal handoff spawns this verbatim.
    expect(codexProfile.resumeArgv!('codex', 'sess-1')).toEqual({ file: 'codex', args: ['resume', 'sess-1'] })
  })
})
