import { homedir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { scrub, setTelemetryDataRoot } from './scrub'

afterEach(() => setTelemetryDataRoot(null))

describe('scrub', () => {
  it('redacts the credential shapes the agents driver already redacts', () => {
    expect(scrub('Authorization: Bearer abcdefghijklmnop')).toBe('Authorization: <redacted>')
    expect(scrub(`token ghp_${'a'.repeat(30)} rejected`)).toBe('token <redacted> rejected')
    expect(scrub(`key sk-${'b'.repeat(20)}`)).toBe('key <redacted>')
    expect(scrub('api_key = hunter2hunter2')).toBe('api_key = <redacted>')
  })

  it('collapses the home directory and the data root', () => {
    const home = homedir()
    expect(scrub(`opened ${home}/Source/acorn/README.md`)).toBe('opened ~/Source/acorn/README.md')
    setTelemetryDataRoot(`${home}/.acorn`)
    // Longest prefix first, so a data root inside the home directory reads as `<data>` and not as
    // `~/.acorn`. Every machine acorn runs on has it there.
    expect(scrub(`${home}/.acorn/worktrees/acorn-42/src/index.ts`)).toBe('<data>/worktrees/acorn-42/src/index.ts')
  })

  it('leaves a route pattern and a channel name alone', () => {
    // The reason there is no generic path shortener: these are the strings most records carry.
    expect(scrub('/v2/core/tasks/:id')).toBe('/v2/core/tasks/:id')
    expect(scrub('no route serves /v2/p/rollbar/issues')).toBe('no route serves /v2/p/rollbar/issues')
  })

  it('strips control characters so a record cannot rewrite a terminal', () => {
    expect(scrub('before\u001b[2Jafter\u0007')).toBe('before[2Jafter')
    // Tab and newline survive: a stack or a multi-line message is still readable.
    expect(scrub('one\ntwo\tthree')).toBe('one\ntwo\tthree')
  })

  it('caps a long message at 2,000 characters', () => {
    expect(scrub('x'.repeat(3_000))).toHaveLength(2_000)
  })

  it('answers with the fallback rather than throwing', () => {
    const hostile = { toString: () => { throw new Error('no') } }
    expect(scrub(hostile, 'unknown')).toBe('unknown')
    expect(scrub(undefined, 'unknown')).toBe('unknown')
    expect(scrub('   ', 'unknown')).toBe('unknown')
    expect(scrub(new Error('plain'))).toBe('plain')
  })
})
