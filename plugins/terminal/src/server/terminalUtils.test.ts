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
  OutputRing,
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

// The chunk-list ring (phase 6 of the performance programme). What it replaced was one string rebuilt
// as `ring = trimRing(ring + data)` on every chunk, so that expression is the reference implementation
// the ASCII cases below are measured against, spelled out here because it no longer exists in src.
const oldRing = (chunks: readonly string[]): string => {
  let ring = ''
  for (const chunk of chunks) {
    ring += chunk
    if (ring.length > RING_CAP) ring = ring.slice(ring.length - RING_CAP)
  }
  return ring
}

const fill = (chunks: readonly string[]): OutputRing => {
  const ring = new OutputRing()
  for (const chunk of chunks) ring.push(chunk)
  return ring
}

describe('OutputRing', () => {
  it('caps at RING_CAP, keeping the most recent bytes', () => {
    const chunks = ['a'.repeat(RING_CAP), 'TAIL']
    const ring = fill(chunks)

    expect(ring.bytes).toBe(RING_CAP)
    expect(ring.tail()).toBe(oldRing(chunks))
    expect(ring.tail().endsWith('TAIL')).toBe(true)
    expect(new OutputRing().tail()).toBe('')
    expect(fill(['short']).tail()).toBe('short')
  })

  it('reads the same tail the string implementation did, at and across every chunk boundary', () => {
    // Deliberately ragged, including an empty chunk: the tails asked for below land exactly on a
    // boundary, inside a chunk, and past everything kept.
    const chunks = ['alpha', 'bravo-', 'charlie', 'd', '', 'echo\r\nfoxtrot']
    const ring = fill(chunks)
    const whole = oldRing(chunks)

    expect(ring.tail()).toBe(whole)
    for (let want = 0; want <= whole.length + 8; want += 1) {
      expect(ring.tail(want)).toBe(want <= 0 ? '' : whole.slice(Math.max(0, whole.length - want)))
    }
  })

  it('keeps exactly its budget when the head has to be cut inside a chunk', () => {
    const chunks = ['x'.repeat(RING_CAP - 10), 'y'.repeat(40)]
    const ring = fill(chunks)

    expect(ring.bytes).toBe(RING_CAP)
    expect(ring.tail()).toBe(oldRing(chunks))
    expect(ring.tail(40)).toBe('y'.repeat(40))
  })

  it('decodes a multi-byte character whose bytes straddle a chunk boundary', () => {
    // The naive rewrite of this class decodes each chunk and joins the strings, which turns a
    // character cut by the walk into two replacement characters. `tail` concatenates the buffers and
    // decodes once, so it does not.
    //
    // A 🌰 is four bytes. Asking for a tail that starts one byte into it makes the walk cut the chunk
    // holding it, and asking for one that starts before it makes the walk span two chunks.
    const ring = fill(['before 🌰', ' after'])

    expect(ring.tail()).toBe('before 🌰 after')
    expect(ring.tail(10)).toBe('🌰 after') // 4 bytes of nut plus 6 of ' after'
    expect(ring.bytes).toBe(Buffer.byteLength('before 🌰 after', 'utf8'))
  })

  it('counts the tail in bytes, which is what changed for its two readers', () => {
    // `slice(-n)` counted UTF-16 code units; this counts bytes, so a tail full of non-ASCII is a
    // slightly shorter window. Both readers are heuristics over recent output — the blocked-prompt
    // scan over the last 4,000 and the transcript tail over the last 10,000 (./terminal.ts) — so a
    // shorter window is a smaller sample of the same thing, and worth knowing rather than fixing.
    const ring = fill(['x'.repeat(100), '中'.repeat(100)])

    expect(ring.bytes).toBe(100 + 300)
    expect(ring.tail(300)).toBe('中'.repeat(100))
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
    expect(tmuxAttachArgs('acorn-abc')).toEqual(['-u', '-T', 'RGB', 'attach', '-t', 'acorn-abc'])
  })
})

describe('launchCommandLine (docs/notes-and-memory.md)', () => {
  it('quotes launchArgs for the shell-line spawn paths, and is a no-op without them', () => {
    expect(launchCommandLine('claude')).toBe('claude')
    expect(launchCommandLine('claude', [])).toBe('claude')
    // The prompt text has spaces and apostrophes; unquoted, tmux would run `claude --append-...`
    // with "This" as the prompt and the rest as stray argv.
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
