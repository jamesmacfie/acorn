import { describe, expect, it } from 'vitest'
import { stageHoldsShell, startupMessage, startupStage, type StartupInputs } from './startupStage'

// A launch that has finished: every input at rest. Each case changes the part it is about.
const done: StartupInputs = {
  node: { kind: 'ready' },
  nodeStarting: false,
  nodeOffline: false,
  plugins: { kind: 'ready' },
  cacheRestoring: false,
  restored: true,
  readsMissing: false,
  readError: undefined,
}
const at = (over: Partial<StartupInputs>) => startupStage({ ...done, ...over })
const say = (over: Partial<StartupInputs>) => startupMessage(at(over))

describe('the startup stage', () => {
  it('names the first part still holding progress, so the message changes as each settles', () => {
    const launch: Partial<StartupInputs> = { node: { kind: 'starting' }, plugins: { kind: 'pending' }, cacheRestoring: true, restored: false, readsMissing: true }
    expect(say(launch)).toBe('Connecting to your computer…')
    expect(say({ ...launch, node: { kind: 'ready' }, nodeStarting: true })).toBe("Starting Acorn's services…")
    expect(say({ ...launch, node: { kind: 'ready' } })).toBe('Preparing your workspace…')
    expect(say({ ...launch, node: { kind: 'ready' }, plugins: { kind: 'ready' } })).toBe('Restoring your workspace…')
    expect(say({ ...launch, node: { kind: 'ready' }, plugins: { kind: 'ready' }, cacheRestoring: false })).toBe('Restoring your workspace…')
    expect(at({}).kind).toBe('ready')
  })

  it('has words for a ready Node whose roster is still registering, which used to draw nothing', () => {
    const stage = at({ plugins: { kind: 'pending' }, restored: false })
    expect(stage.kind).toBe('preparing')
    expect(stageHoldsShell(stage)).toBe(true)
  })

  it('shows a roster failure while the Node is still starting, because waiting will not fix it', () => {
    const error = new Error('Duplicate client plugin: changes')
    expect(at({ nodeStarting: true, plugins: { kind: 'failed', error } })).toEqual({ kind: 'failed', step: 'registration', error })
  })

  it('keeps a Node failure apart from a roster failure', () => {
    expect(at({ node: { kind: 'failed', reason: 'broker closed' }, plugins: { kind: 'failed', error: 'x' } }))
      .toMatchObject({ kind: 'failed', step: 'node', error: 'broker closed' })
  })

  it('says an offline remote Node with nothing cached is offline, not starting, and holds only the content', () => {
    const stage = at({ nodeOffline: true, restored: false, readsMissing: true })
    expect(startupMessage(stage)).toBe('Your computer is offline')
    expect(stageHoldsShell(stage)).toBe(false)
  })

  it('turns a failed initial read with nothing cached into a failure, rather than waiting forever', () => {
    const error = new Error('500')
    expect(at({ restored: false, readsMissing: true })).toEqual({ kind: 'restoring' })
    const stage = at({ restored: false, readsMissing: true, readError: error })
    expect(stage).toEqual({ kind: 'failed', step: 'reads', error })
    expect(stageHoldsShell(stage)).toBe(false)
  })

  it('leaves a restored window alone when the Node later goes offline', () => {
    expect(at({ nodeOffline: true, readsMissing: true }).kind).toBe('ready')
  })
})
