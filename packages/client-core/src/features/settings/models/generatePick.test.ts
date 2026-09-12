import { describe, expect, it } from 'vitest'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import { PrefKeys } from '../../../infra/persistence/prefKeys'
import { effectiveModelPick, readGeneratePick } from './generatePick'

// The shared "Generate with" default: which pick wins, and what a value this build cannot read counts
// as. These invariants came from the commit wand, which was the only surface that remembered a pick
// before every Generate control shared one.

const at = (id: string, models: string[], defaultModelId?: string, kind: ModelBackend['kind'] = 'connection'): ModelBackend => ({
  id,
  kind,
  label: id,
  models: models.map((m) => ({ id: m, label: m })),
  defaultModelId: defaultModelId ?? '',
})

describe('effectiveModelPick', () => {
  it('answers nothing when there is nothing to spend, which is what hides a Generate control', () => {
    expect(effectiveModelPick([], null)).toBe(null)
    expect(effectiveModelPick([], { backendId: 'gone', modelId: 'x' })).toBe(null)
  })

  it('opens on the first backend and its own default when nothing was remembered', () => {
    expect(effectiveModelPick([at('c1', ['fast', 'slow'], 'slow'), at('c2', ['other'])], null))
      .toEqual({ backendId: 'c1', modelId: 'slow' })
  })

  it('keeps a remembered pick that still resolves', () => {
    const backends = [at('c1', ['fast']), at('c2', ['slow'])]
    expect(effectiveModelPick(backends, { backendId: 'c2', modelId: 'slow' }))
      .toEqual({ backendId: 'c2', modelId: 'slow' })
  })

  // A disconnected provider or an uninstalled CLI in a device preference is a stale note, not a
  // decision to honour.
  it('falls back to the first backend when the remembered one has gone', () => {
    expect(effectiveModelPick([at('c1', ['fast'])], { backendId: 'deleted', modelId: 'x' }))
      .toEqual({ backendId: 'c1', modelId: 'fast' })
  })

  // A provider that dropped a model between releases would otherwise be asked for one it no longer
  // serves.
  it('replaces a remembered model the backend no longer lists', () => {
    expect(effectiveModelPick([at('c1', ['fast'], 'fast')], { backendId: 'c1', modelId: 'retired' }))
      .toEqual({ backendId: 'c1', modelId: 'fast' })
  })

  // Empty is a real answer: the node omits the model and the backend picks. Which is also every
  // harness, since a CLI keeps its own model list.
  it('answers an empty model for a backend that declares none', () => {
    expect(effectiveModelPick([at('c1', [])], null)).toEqual({ backendId: 'c1', modelId: '' })
  })

  // The machine this whole programme is for: `claude` on PATH and no key connected. There is no
  // connection to fall back to, so the first backend is a harness and the wand appears anyway.
  it('resolves over a list that is nothing but installed CLIs', () => {
    const harnesses = [at('harness:claude-code', ['sonnet', 'opus'], 'sonnet', 'harness'), at('harness:codex', [], '', 'harness')]
    expect(effectiveModelPick(harnesses, null)).toEqual({ backendId: 'harness:claude-code', modelId: 'sonnet' })
    expect(effectiveModelPick(harnesses, { backendId: 'harness:codex', modelId: '' }))
      .toEqual({ backendId: 'harness:codex', modelId: '' })
    // A remembered key, on a machine that now has none: the CLI is what is left to spend.
    expect(effectiveModelPick(harnesses, { backendId: 'connection:abc', modelId: 'gpt-5' }))
      .toEqual({ backendId: 'harness:claude-code', modelId: 'sonnet' })
  })
})

describe('the remembered pick', () => {
  const held = (value: unknown) => ({ [PrefKeys.generatePick]: JSON.stringify(value) })

  it('answers nothing when it is absent, is not JSON, or is not an object', () => {
    expect(readGeneratePick(undefined)).toBe(null)
    expect(readGeneratePick({})).toBe(null)
    expect(readGeneratePick({ [PrefKeys.generatePick]: '{' })).toBe(null)
    expect(readGeneratePick({ [PrefKeys.generatePick]: '[]' })).toBe(null)
    expect(readGeneratePick({ [PrefKeys.generatePick]: 'null' })).toBe(null)
    expect(readGeneratePick({ [PrefKeys.generatePick]: '"c2"' })).toBe(null)
  })

  it('answers nothing when a field is missing, empty, or the wrong type', () => {
    expect(readGeneratePick(held({ modelId: 'fast' }))).toBe(null)
    expect(readGeneratePick(held({ backendId: '', modelId: 'fast' }))).toBe(null)
    expect(readGeneratePick(held({ backendId: 'c2' }))).toBe(null)
    expect(readGeneratePick(held({ backendId: 'c2', modelId: 7 }))).toBe(null)
    expect(readGeneratePick(held({ backendId: 7, modelId: 'fast' }))).toBe(null)
  })

  it('reads back a stored pick, including a backend that declares no model', () => {
    expect(readGeneratePick(held({ backendId: 'c2', modelId: 'slow' }))).toEqual({ backendId: 'c2', modelId: 'slow' })
    expect(readGeneratePick(held({ backendId: 'harness:codex', modelId: '' })))
      .toEqual({ backendId: 'harness:codex', modelId: '' })
  })

  // Extra keys are dropped rather than refusing the value: a build that remembers a fourth thing
  // beside the pick must not cost this one the pick it can read.
  it('ignores a field it does not know', () => {
    expect(readGeneratePick(held({ backendId: 'c2', modelId: 'slow', pickedAt: 12 })))
      .toEqual({ backendId: 'c2', modelId: 'slow' })
  })
})
