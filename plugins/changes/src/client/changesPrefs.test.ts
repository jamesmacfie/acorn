import { describe, expect, it } from 'vitest'
import { PrefKeys } from '@acorn/plugin-api/client'
import { changeViewSlice, readChangeView, readGeneratePick } from './changesPrefs'
import { DEFAULT_CHANGE_VIEW } from './model'

const stored = (value: unknown) => ({ [PrefKeys.changesView]: JSON.stringify(value) })

describe('the view preference', () => {
  it('falls back to the flat list when it is absent or is not JSON', () => {
    expect(readChangeView(undefined)).toEqual(DEFAULT_CHANGE_VIEW)
    expect(readChangeView({})).toEqual(DEFAULT_CHANGE_VIEW)
    expect(readChangeView({ [PrefKeys.changesView]: '{' })).toEqual(DEFAULT_CHANGE_VIEW)
    expect(readChangeView({ [PrefKeys.changesView]: '[]' })).toEqual(DEFAULT_CHANGE_VIEW)
  })

  it('reads back a stored choice and defaults the rest', () => {
    expect(readChangeView(stored({ mode: 'tree' }))).toEqual({ ...DEFAULT_CHANGE_VIEW, mode: 'tree' })
    expect(readChangeView(stored({ mode: 'tree', sort: 'name', groupBy: 'staged' })))
      .toEqual({ mode: 'tree', sort: 'name', groupBy: 'staged' })
  })

  // Field by field, which is the point of the `catch` per field: a build that renamed one choice, or
  // an older one that never had it, costs the reader that choice and not the other two.
  it('keeps the choices that parse when one of them does not', () => {
    expect(readChangeView(stored({ mode: 'outline', groupBy: 'staged' })))
      .toEqual({ ...DEFAULT_CHANGE_VIEW, groupBy: 'staged' })
    expect(readChangeView(stored({ mode: 'tree', unknownChoice: true })))
      .toEqual({ ...DEFAULT_CHANGE_VIEW, mode: 'tree' })
  })

  it('persists only an object, and an empty one otherwise', () => {
    expect(changeViewSlice.codec.parse(JSON.stringify({ mode: 'tree' }))).toEqual({ mode: 'tree' })
    expect(changeViewSlice.codec.parse('[]')).toEqual({})
    expect(changeViewSlice.codec.parse('{')).toEqual({})
    expect(changeViewSlice.empty('')).toEqual({})
  })
})

// Which connection the commit-message button spends. Its own key, not a fourth field on the view: the
// view is about how the list is drawn and this is about whose tokens go.
describe('the remembered model pick', () => {
  const heldPick = (value: unknown) => ({ [PrefKeys.changesGenerateConnection]: JSON.stringify(value) })

  it('answers nothing when it is absent, is not JSON, or is missing the connection', () => {
    expect(readGeneratePick(undefined)).toBe(null)
    expect(readGeneratePick({})).toBe(null)
    expect(readGeneratePick({ [PrefKeys.changesGenerateConnection]: '{' })).toBe(null)
    expect(readGeneratePick(heldPick({ modelId: 'fast' }))).toBe(null)
    expect(readGeneratePick(heldPick({ connectionId: '', modelId: 'fast' }))).toBe(null)
  })

  it('reads back a stored pick, including a provider that declares no model', () => {
    expect(readGeneratePick(heldPick({ connectionId: 'c2', modelId: 'slow' }))).toEqual({ connectionId: 'c2', modelId: 'slow' })
    expect(readGeneratePick(heldPick({ connectionId: 'c2', modelId: '' }))).toEqual({ connectionId: 'c2', modelId: '' })
  })
})
