import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/solid-query'
import { prefsKey } from '@acorn/protocol/api.ts'
import { PrefKeys } from '@acorn/plugin-api/client'
import {
  createAgentToolFoldSetting,
  defaultAgentToolFoldPrefs,
  foldPrefsAfterToggle,
  foldStartsOpen,
  readAgentToolFoldPrefs,
} from './toolFoldPrefs'

const stored = (value: unknown) => ({ [PrefKeys.agentToolFold]: JSON.stringify(value) })

describe('readAgentToolFoldPrefs', () => {
  it('starts collapsed when nothing is stored', () => {
    expect(readAgentToolFoldPrefs(undefined)).toEqual({ mode: 'collapsed', last: 'collapsed' })
    expect(readAgentToolFoldPrefs({})).toEqual(defaultAgentToolFoldPrefs)
  })

  it('fills the missing half of a partial row', () => {
    expect(readAgentToolFoldPrefs(stored({ mode: 'sticky' }))).toEqual({ mode: 'sticky', last: 'collapsed' })
  })

  it('falls back rather than throwing on an unreadable row', () => {
    expect(readAgentToolFoldPrefs({ [PrefKeys.agentToolFold]: '{' })).toEqual(defaultAgentToolFoldPrefs)
    expect(readAgentToolFoldPrefs(stored({ mode: 'sideways' }))).toEqual(defaultAgentToolFoldPrefs)
    expect(readAgentToolFoldPrefs(stored([]))).toEqual(defaultAgentToolFoldPrefs)
  })
})

describe('foldStartsOpen', () => {
  it('reads the mode, and the remembered toggle only under sticky', () => {
    expect(foldStartsOpen({ mode: 'expanded', last: 'collapsed' })).toBe(true)
    expect(foldStartsOpen({ mode: 'collapsed', last: 'expanded' })).toBe(false)
    expect(foldStartsOpen({ mode: 'sticky', last: 'expanded' })).toBe(true)
    expect(foldStartsOpen({ mode: 'sticky', last: 'collapsed' })).toBe(false)
  })
})

describe('foldPrefsAfterToggle', () => {
  it('learns from a toggle under sticky', () => {
    expect(foldPrefsAfterToggle({ mode: 'sticky', last: 'collapsed' }, true))
      .toEqual({ mode: 'sticky', last: 'expanded' })
  })

  it('writes nothing under a fixed mode, so a card cannot rewrite the setting', () => {
    expect(foldPrefsAfterToggle({ mode: 'collapsed', last: 'collapsed' }, true)).toBeNull()
    expect(foldPrefsAfterToggle({ mode: 'expanded', last: 'expanded' }, false)).toBeNull()
  })

  it('writes nothing when the toggle matches what is already remembered', () => {
    expect(foldPrefsAfterToggle({ mode: 'sticky', last: 'expanded' }, true)).toBeNull()
  })
})

describe('createAgentToolFoldSetting', () => {
  const setting = (mode: string) => {
    const queryClient = new QueryClient()
    const prefs = () => ({ [PrefKeys.agentToolFold]: JSON.stringify({ mode }) })
    return { queryClient, fold: createAgentToolFoldSetting(prefs, queryClient) }
  }

  it('reads the stored mode through the accessor it was given', () => {
    expect(setting('expanded').fold.startsOpen()).toBe(true)
    expect(setting('collapsed').fold.startsOpen()).toBe(false)
  })

  // A device pref, so this write never leaves the machine: savePref puts it in localStorage and the
  // query cache and stops there.
  it('stores a toggle under sticky', async () => {
    const { queryClient, fold } = setting('sticky')
    fold.onToggle(true)
    await Promise.resolve()
    expect(queryClient.getQueryData<Record<string, string>>(prefsKey)?.[PrefKeys.agentToolFold])
      .toBe(JSON.stringify({ mode: 'sticky', last: 'expanded' }))
  })

  it('stores nothing under a fixed mode', async () => {
    const { queryClient, fold } = setting('collapsed')
    fold.onToggle(true)
    await Promise.resolve()
    expect(queryClient.getQueryData(prefsKey)).toBeUndefined()
  })
})
