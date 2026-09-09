import { describe, expect, it } from 'vitest'
import { AcornBridgeError } from '@acorn/plugin-api/ui/sdk'
import { errorMessage } from './GenerateSqlModal'

// What a failed generate reads as. A table rather than a render: the mapping is a pure function and
// each row is one sentence. A `.test.tsx` because the module it comes from draws kit nodes, and only
// the jsdom tier can load that entrypoint: a node-env test cannot import a Solid component.

const failed = (code: string, message = 'raw') =>
  new AcornBridgeError({ code, message, retryable: false, requestId: 'r1' })

describe('what a failed generate reads as', () => {
  it('sends a rejected key back to Settings', () => {
    expect(errorMessage(failed('provider_needs_auth'))).toContain('reconnect it in Settings')
  })

  it('says to wait when the provider is rate-limiting', () => {
    expect(errorMessage(failed('provider_rate_limited'))).toContain('rate-limiting')
  })

  // An installed CLI that is signed out fails as `provider_unavailable`, the same code an unreachable
  // provider gets. Retrying does not fix it: the next step is to run the CLI once in a terminal.
  it('sends a silent CLI to a terminal, and leaves a silent provider alone', () => {
    expect(errorMessage(failed('provider_unavailable'), { kind: 'harness', label: 'Claude Code' }))
      .toBe('Claude Code did not answer. Run it once in a terminal to check it is signed in.')
    expect(errorMessage(failed('provider_unavailable', 'The provider did not answer.'), { kind: 'connection', label: 'Anthropic' }))
      .toBe('The provider did not answer.')
  })

  it('falls back to the node prose, and then to whatever was thrown', () => {
    expect(errorMessage(failed('db_schema_unavailable', 'The schema script exited 1.'))).toBe('The schema script exited 1.')
    expect(errorMessage(new Error('Boom.'))).toBe('Boom.')
    expect(errorMessage('not an error at all')).toBe('not an error at all')
  })
})
