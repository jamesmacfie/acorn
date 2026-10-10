import { describe, expect, it } from 'vitest'
import type { AgentConfigOption } from '../../contract/wire.ts'
import { unguardedCommandsWarning } from './unguardedCommands'

const option = (category: AgentConfigOption['category'], currentValue: string | null): AgentConfigOption =>
  ({ id: category, label: category, category, currentValue, values: [] })

describe('unguardedCommandsWarning', () => {
  it('warns when Claude Code skips permission checks', () => {
    expect(unguardedCommandsWarning([option('mode', 'bypassPermissions')])?.detail).toContain('Claude Code')
  })

  it('warns when Codex runs with full access, in either spelling', () => {
    expect(unguardedCommandsWarning([option('permission', ':danger-full-access')])?.detail).toContain('Codex')
    expect(unguardedCommandsWarning([option('permission', 'danger-full-access')])?.detail).toContain('Codex')
  })

  it('stays quiet while a sandbox or an approval step guards commands', () => {
    for (const [category, value] of [
      ['mode', 'default'], ['mode', 'auto'], ['mode', 'acceptEdits'], ['mode', 'plan'],
      ['permission', ':workspace'], ['permission', ':read-only'],
    ] as const) expect(unguardedCommandsWarning([option(category, value)])).toBeUndefined()
  })

  it('ignores model and other options that happen to share a value', () => {
    expect(unguardedCommandsWarning([option('model', 'bypassPermissions'), option('other', ':danger-full-access')])).toBeUndefined()
  })

  it('stays quiet when the harness reports nothing', () => {
    expect(unguardedCommandsWarning([])).toBeUndefined()
    expect(unguardedCommandsWarning([option('mode', null)])).toBeUndefined()
  })
})
