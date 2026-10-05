import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrefKeys } from '@acorn/plugin-api/client'
import { defaultAgentSessionDefaults } from '../../shared/sessionDefaults'
import { startupContextInjection } from './startupContext'

// Settings → Agents → Harnesses and defaults. What is pinned: every harness shows whether this machine
// can run it, the terminal's startup-context switch lives here now and writes core's preference, the
// transcript row says it belongs to this device, and a default that seeds new sessions says how to
// change an open one.

const mocks = vi.hoisted(() => ({
  prefs: {} as Record<string, string>,
  saveStartup: vi.fn(async (_client: unknown, _on: boolean) => true),
}))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { queryKey: readonly string[] }) => ({
    get data() {
      const key = options().queryKey
      if (key.includes('session-defaults')) return defaultAgentSessionDefaults()
      if (key.includes('model-backends')) return { backends: [{ id: 'harness:claude', kind: 'harness', label: 'Claude Code', models: [{ id: 'opus', label: 'Opus' }], defaultModelId: 'opus' }], missing: [] }
      return mocks.prefs
    },
  }),
  useQueryClient: () => ({}),
}))
vi.mock('./startupContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./startupContext')>()),
  saveStartupContextInjection: (client: unknown, on: boolean) => mocks.saveStartup(client, on),
}))
vi.mock('../sessions/managedClient', () => ({
  managedAgentApi: {
    providers: async () => [
      { id: 'claude', profileId: 'claude-code', label: 'Claude Code', installed: true, executableVersion: '2.1.0', authenticated: true, diagnostics: [] },
      { id: 'codex', profileId: 'codex', label: 'Codex', installed: false, authenticated: null, diagnostics: [] },
    ],
    sessions: async () => ({ sessions: [] }),
  },
}))

const { default: AgentSessionDefaultsSettings } = await import('./AgentSessionDefaultsSettings')

let host: HTMLElement
let dispose: (() => void) | undefined
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const row = (label: string) =>
  [...host.querySelectorAll('.ui-setting-row')].find((each) => each.querySelector('.ui-setting-label')?.textContent?.startsWith(label))

beforeEach(() => {
  mocks.prefs = {}
  mocks.saveStartup.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <AgentSessionDefaultsSettings />, host)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

describe('the harnesses and defaults page', () => {
  it('says which harnesses this machine can run', async () => {
    await settle()
    expect(row('Claude Code')?.textContent).toContain('Version 2.1.0.')
    expect(row('Codex')?.textContent).toContain('Not installed')
  })

  it('draws the startup-context switch on for an untouched preference and writes a change to it', async () => {
    await settle()
    const toggle = row('Send task context at startup')!.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(toggle.checked).toBe(true)
    expect(row('Send task context at startup')?.textContent).toContain('On for new sessions only')
    toggle.click()
    await settle()
    expect(mocks.saveStartup).toHaveBeenCalledWith(expect.anything(), false)
  })

  it('marks generation and tool call defaults as this device’s', () => {
    expect(row('Generate with')?.querySelector('.ui-setting-scope')?.textContent).toBe('This device')
    expect(row('Generate with')?.textContent).toContain('Opus')
    expect(row('Tool call display')?.querySelector('.ui-setting-scope')?.textContent).toBe('This device')
    expect(row('Carry my last session')?.querySelector('.ui-setting-scope')).toBeFalsy()
  })
})

describe('the startup-context preference', () => {
  it('is on unless the reader has said not to, which is what an opt-out means', () => {
    expect(startupContextInjection(undefined)).toBe(true)
    expect(startupContextInjection({ [PrefKeys.startupContextInjection]: 'true' })).toBe(true)
    // Only an explicit `false` turns it off. Anything else is a value nobody chose.
    expect(startupContextInjection({ [PrefKeys.startupContextInjection]: 'false' })).toBe(false)
    expect(startupContextInjection({ [PrefKeys.startupContextInjection]: 'nonsense' })).toBe(true)
  })
})
