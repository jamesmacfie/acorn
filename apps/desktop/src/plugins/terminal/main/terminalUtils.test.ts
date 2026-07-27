import { describe, expect, it } from 'vitest'
import {
  clampDim,
  computeIdle,
  launchCommandLine,
  matchBlockedPrompt,
  parseTmuxSessions,
  resolveBackend,
  RING_CAP,
  tmuxAttachArgs,
  tmuxName,
  tmuxNewSessionArgs,
  trimRing,
} from './terminalUtils'

describe('clampDim', () => {
  it('keeps sane integers and rejects junk to the fallback', () => {
    expect(clampDim(120, 80)).toBe(120)
    expect(clampDim(0, 80)).toBe(80)
    expect(clampDim(99999, 24)).toBe(24)
    expect(clampDim(40.5, 24)).toBe(24)
    expect(clampDim('80', 24)).toBe(24)
    expect(clampDim(undefined, 24)).toBe(24)
  })
})

describe('trimRing', () => {
  it('caps the buffer at RING_CAP, keeping the most recent bytes', () => {
    const big = 'a'.repeat(RING_CAP) + 'TAIL'
    const out = trimRing(big)
    expect(out.length).toBe(RING_CAP)
    expect(out.endsWith('TAIL')).toBe(true)
    expect(trimRing('short')).toBe('short')
  })
})

describe('resolveBackend', () => {
  it('uses tmux only when preferred and available, else degrades to node-pty', () => {
    expect(resolveBackend('tmux', true)).toBe('tmux')
    expect(resolveBackend('tmux', false)).toBe('node-pty')
    expect(resolveBackend('node-pty', true)).toBe('node-pty')
  })
})

describe('parseTmuxSessions', () => {
  it('keeps only acorn-prefixed session names', () => {
    const out = 'acorn-abc\nmy-other-session\nacorn-def\n\n'
    expect(parseTmuxSessions(out)).toEqual(new Set(['acorn-abc', 'acorn-def']))
  })
})

describe('tmux arg builders', () => {
  it('build create-or-noop + attach argv', () => {
    expect(tmuxName('abc')).toBe('acorn-abc')
    expect(tmuxNewSessionArgs('acorn-abc', '/repo', 'claude')).toEqual(['new-session', '-A', '-d', '-s', 'acorn-abc', '-c', '/repo', 'claude'])
    // env is set explicitly via -e so a pre-existing tmux server can't drop ACORN_* (no-tools bug)
    expect(tmuxNewSessionArgs('acorn-abc', '/repo', 'claude', { ACORN_TASK_ID: 't1', ACORN_API_TOKEN: 'tok' })).toEqual([
      'new-session', '-A', '-d', '-e', 'ACORN_TASK_ID=t1', '-e', 'ACORN_API_TOKEN=tok', '-s', 'acorn-abc', '-c', '/repo', 'claude',
    ])
    expect(tmuxAttachArgs('acorn-abc')).toEqual(['attach', '-t', 'acorn-abc'])
  })
})

describe('launchCommandLine (docs/notes-and-memory.md)', () => {
  it('quotes launchArgs for the shell-line spawn paths, and is a no-op without them', () => {
    expect(launchCommandLine('claude')).toBe('claude')
    expect(launchCommandLine('claude', [])).toBe('claude')
    // The prompt text has spaces and apostrophes — unquoted, tmux would run `claude --append-…` with
    // "This" as the prompt and the rest as stray argv.
    expect(launchCommandLine('claude', ['--append-system-prompt', "call task_context; don't ask"])).toBe(
      `claude '--append-system-prompt' 'call task_context; don'\\''t ask'`,
    )
  })
})

describe('computeIdle', () => {
  const now = 1_000_000
  it('flags only running agents past the silence threshold', () => {
    expect(computeIdle('agent', 'running', now - 20_000, now, 10_000)).toBe(true)
    expect(computeIdle('agent', 'running', now - 5_000, now, 10_000)).toBe(false)
  })
  it('never flags shells or exited sessions', () => {
    expect(computeIdle('shell', 'running', now - 20_000, now, 10_000)).toBe(false)
    expect(computeIdle('agent', 'exited', now - 20_000, now, 10_000)).toBe(false)
  })
})

describe('matchBlockedPrompt (docs/terminal-and-agents.md)', () => {
  it.each([
    ['Do you want to proceed? (y/n)', true],
    ['Overwrite existing file? [Y/n]', true],
    ['Press enter to continue', true],
    ['Which file should I edit?', true], // trailing ? on the last line
    ['done.\nAll tests passed.', false],
    ['building…\ncompiling module 4 of 7', false],
  ])('%j → %s', (tail, expected) => {
    expect(matchBlockedPrompt(tail)).toBe(expected)
  })

  it('ignores a mid-stream question that is not the last line', () => {
    expect(matchBlockedPrompt('What changed?\nApplying edits now\nDone.')).toBe(false)
  })

  it('is not fooled by spinner frames or ANSI colour', () => {
    expect(matchBlockedPrompt('⠋ working…\n⠙ still working…')).toBe(false)
    expect(matchBlockedPrompt('\x1b[32m✓ built\x1b[0m\n\x1b[90mwaiting for changes\x1b[0m')).toBe(false)
    expect(matchBlockedPrompt('\x1b[1mProceed?\x1b[0m (y/n)\x1b[?25l')).toBe(true)
  })

  it('handles carriage-return-only spinners (last visual line wins)', () => {
    expect(matchBlockedPrompt('step 1\rstep 2\rstep 3 running')).toBe(false)
    expect(matchBlockedPrompt('')).toBe(false)
  })
})

