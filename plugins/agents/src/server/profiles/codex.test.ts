import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codexProfile } from './codex'

// The argv this profile hands the process broker. See the claude-code suite for why that is the one
// thing worth pinning in a profile package.

describe('the codex profile', () => {
  it('declares the identity terminal and workflows resolve it by', () => {
    // `id` is persisted; see docs/managed-agents.md § Harnesses.
    expect(codexProfile).toMatchObject({ id: 'codex', label: 'Codex', kind: 'agent', command: 'codex', transport: 'pty' })
  })

  // Asserts the whole array. A prefix slice plus a last-element check leaves the middle of the argv
  // unasserted, so a sandbox opt-out or an extra `--config` slipped between `--json` and the prompt
  // would pass.
  it('builds a headless turn as `exec --json`, with the prompt last', () => {
    const { file, args } = codexProfile.headlessArgv!('codex', { prompt: 'do the thing' })
    expect(file).toBe('codex')
    expect(args).toEqual(['exec', '--json', 'do the thing'])
  })

  it('materializes a schema to a FILE, because codex takes a path where claude takes JSON', () => {
    // `--output-schema` wants a path, so the profile writes a temp file. Passing the JSON inline
    // produces an invocation codex rejects, or treats as a filename.
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

  it('disables tools for a one-shot turn by giving codex a read-only sandbox and a directory it will start in', () => {
    // `-s read-only` is as close as codex gets to claude's `--tools ''`, and `--skip-git-repo-check`
    // is not optional: the one-shot runs in an empty temporary directory, and codex refuses to start
    // in one that is neither a git repo nor trusted. Whole-array equality, for the same reason the
    // headless case has it: a sandbox opt-out slipped into the middle would otherwise pass.
    const { file, args } = codexProfile.aiArgv!('codex', { prompt: 'decide' })
    expect(file).toBe('codex')
    expect(args).toEqual(['exec', '--json', '--ephemeral', '-s', 'read-only', '--skip-git-repo-check', 'decide'])
  })

  it('prepends the system half to the prompt with a blank line, because codex exec has no flag for it', () => {
    const { args } = codexProfile.aiArgv!('codex', { prompt: 'What colour is the sky?', system: 'Answer with a single word only.' })
    // One argument, not two: a `--system-prompt` that does not exist would be read as the prompt.
    expect(args.at(-1)).toBe('Answer with a single word only.\n\nWhat colour is the sky?')
    expect(args).toHaveLength(7)
  })

  it('passes -m only when a caller names a model, because codex owns its own default', () => {
    // No catalog on this profile: the list lives in `~/.codex/config.toml`. So the common case is no
    // `-m` at all, and the CLI's configured default answers.
    expect(codexProfile.aiArgv!('codex', { prompt: 'p', model: 'gpt-5' }).args).toContain('-m')
    expect(codexProfile.aiArgv!('codex', { prompt: 'p' }).args).not.toContain('-m')
    expect(codexProfile.models).toBeUndefined()
    expect(codexProfile.glyph).toBe('brand:agents/codex')
  })

  it('materializes a one-shot schema to a file as well, not inline', () => {
    const { args } = codexProfile.aiArgv!('codex', { prompt: 'p', schema: { type: 'object' } })
    expect(JSON.parse(readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'))).toEqual({ type: 'object' })
  })
})

// The stream codex actually emits, recorded from `codex exec --json` on 2026-09-09. It is here rather
// than beside the adapter in core because this profile is what chooses the adapter, and a renamed event
// would break codex alone.
//
// Note what is missing: there is no `result` event. Core's shared `lineDelimitedJsonAdapter` looks for
// one, so reading this stream through it returns a capture of nothing but nulls, `runHeadless` calls
// the run `malformed`, and every codex turn fails. That was true of codex headless runs before any
// one-shot mode existed. `streamJson` is per profile rather than per mode, so the adapter below fixes
// both at once.
const CODEX_STREAM = [
  '{"type":"thread.started","thread_id":"01a0847a-0000-0000-0000-000000000000"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Blue"}}',
  '{"type":"turn.completed","usage":{"input_tokens":20142,"cached_input_tokens":12160,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}',
].join('\n')

describe('the codex stream adapter', () => {
  it('reads the answer, the thread id and the token counts out of a real recorded turn', () => {
    const capture = codexProfile.streamJson!.parse(CODEX_STREAM)
    expect(capture.result).toBe('Blue')
    // `thread_id`, which is what `codex resume <ref>` takes.
    expect(capture.sessionId).toBe('01a0847a-0000-0000-0000-000000000000')
    expect(capture.usage).toEqual({ inputTokens: 20142, outputTokens: 5, cachedInputTokens: 12160 })
    // The stream carries no price, and we would rather report nothing than a number from a price
    // table nobody maintains.
    expect(capture.costUsd).toBeNull()
    expect(capture.events).toHaveLength(4)
  })

  it('takes the LAST agent message, so a turn that speaks twice is read at the end', () => {
    const capture = codexProfile.streamJson!.parse([
      '{"type":"item.completed","item":{"type":"agent_message","text":"Let me check."}}',
      '{"type":"item.completed","item":{"type":"reasoning","text":"ignored"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Blue"}}',
    ].join('\n'))
    expect(capture.result).toBe('Blue')
  })

  it('reads structured output out of the message text, and leaves prose alone', () => {
    // `--output-schema` puts the JSON in the message text: codex has no separate structured field. A
    // workflow `decide` step reads `structuredOutput` for its verdict, so without this it fails on
    // every codex run. Only an object or an array is accepted, which is why "Blue" stays null.
    expect(codexProfile.streamJson!.parse('{"type":"item.completed","item":{"type":"agent_message","text":"{\\"verdict\\":\\"pass\\"}"}}').structuredOutput)
      .toEqual({ verdict: 'pass' })
    expect(codexProfile.streamJson!.parse(CODEX_STREAM).structuredOutput).toBeNull()
  })

  it('keeps parseLine returning the raw event, which is what the Agents feed renders', () => {
    expect(codexProfile.streamJson!.parseLine('{"type":"turn.started"}')).toEqual({ type: 'turn.started' })
    expect(codexProfile.streamJson!.parseLine('not json')).toBeNull()
  })
})
