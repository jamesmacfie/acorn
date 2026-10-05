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
  hidden: [] as string[],
  saveStartup: vi.fn(async (_client: unknown, _on: boolean) => true),
  writeDefaults: vi.fn(async (_client: unknown, current: unknown, patch: object) => ({ ...(current as object), ...patch })),
}))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { queryKey: readonly string[] }) => ({
    get data() {
      return options().queryKey.includes('session-defaults')
        ? { ...defaultAgentSessionDefaults(), hiddenProviders: mocks.hidden }
        : mocks.prefs
    },
  }),
  useQueryClient: () => ({}),
}))
vi.mock('./startupContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./startupContext')>()),
  saveStartupContextInjection: (client: unknown, on: boolean) => mocks.saveStartup(client, on),
}))
vi.mock('./sessionDefaultsClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sessionDefaultsClient')>()),
  writeAgentSessionDefaults: (client: unknown, current: unknown, patch: object) => mocks.writeDefaults(client, current, patch),
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

const mount = () => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <AgentSessionDefaultsSettings />, host)
}
beforeEach(() => {
  mocks.prefs = {}
  mocks.hidden = []
  mocks.saveStartup.mockClear()
  mocks.writeDefaults.mockClear()
  mount()
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

  it('marks the tool call display as this device’s', () => {
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

  it('switches a harness out of New, and keeps the last one on offer switched on', async () => {
    await settle()
    const codex = () => host.querySelector<HTMLInputElement>('input[aria-label="Show Codex in New"]')!
    const claude = () => host.querySelector<HTMLInputElement>('input[aria-label="Show Claude Code in New"]')!
    expect(codex().checked).toBe(true)
    expect(claude().disabled).toBe(false)
    codex().click()
    await settle()
    expect(mocks.writeDefaults).toHaveBeenCalledWith(expect.anything(), expect.anything(), { hiddenProviders: ['codex'] })

    dispose?.()
    host.remove()
    mocks.hidden = ['codex']
    mount()
    await settle()
    expect(codex().checked).toBe(false)
    expect(claude().disabled).toBe(true)
  })
})
