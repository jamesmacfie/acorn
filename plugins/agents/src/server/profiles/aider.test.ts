import { describe, expect, it } from 'vitest'
import { aiderProfile } from './aider'

// Aider is the PTY-only profile, and the absence of an argv builder is the thing to pin.
//
// It has no `headlessArgv`, `resumeArgv`, `streamJson` or `mcpRegistration`, so it can be launched in a
// terminal and nothing else: a workflow step naming it, or a managed session trying to resume it, has
// to degrade rather than spawn something wrong. Adding one by accident, say by copying from the codex
// profile, would silently widen where this profile is offered.

describe('the aider profile', () => {
  it('declares the identity terminal resolves it by', () => {
    expect(aiderProfile).toMatchObject({ id: 'aider', label: 'Aider', kind: 'agent', command: 'aider', transport: 'pty' })
  })

  it('offers no headless, resume, stream or MCP surface', () => {
    expect(aiderProfile.headlessArgv).toBeUndefined()
    expect(aiderProfile.resumeArgv).toBeUndefined()
    expect(aiderProfile.aiArgv).toBeUndefined()
    expect(aiderProfile.streamJson).toBeUndefined()
    expect(aiderProfile.mcpRegistration).toBeUndefined()
  })

  it('prefers tmux, so a session survives an app restart', () => {
    // Every agent profile does. Stated because a PTY-only profile is where losing it would be least
    // obvious: there's no headless runner to notice the session is gone.
    expect(aiderProfile.backendPreference).toBe('tmux')
  })
})
