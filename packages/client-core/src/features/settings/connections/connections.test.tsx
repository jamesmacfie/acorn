import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Integration } from '@acorn/protocol/api.ts'
import type { PublicIntegrationProvider } from '@acorn/protocol/integrations.ts'

// Services and AI models: a refused connection is listed first and its page leads with the fix, a
// provider at its limit still shows in the gallery as connected, and Generate with says it is this
// device's.
const provider = (id: string, label: string, extra: Partial<PublicIntegrationProvider['connection']> = {}, kind: PublicIntegrationProvider['kind'] = 'issue-tracker'): PublicIntegrationProvider => ({
  id, label, kind, glyph: label[0]!, capabilities: {},
  connection: { authKind: 'api-key', fields: [{ id: 'token', label: 'Personal API key', type: 'password', required: true }], connectable: true, disconnectable: true, ...extra },
})
const connection = (id: string, providerId: string, label: string, status: Integration['status'] = 'connected'): Integration => ({
  id, providerId, label, status, authKind: 'api-key', account: null, scopes: [], capabilities: {}, createdAt: 1, updatedAt: 1,
})
const PROVIDERS = [
  provider('github', 'GitHub', { kind: 'device-flow', fields: [], maxConnections: 1 }),
  provider('linear', 'Linear'),
  provider('anthropic', 'Anthropic', { maxConnections: 1 }, 'model-provider'),
]
const INTEGRATIONS = [
  connection('c-github', 'github', 'GitHub · someone'),
  connection('c-linear', 'linear', 'Linear · Acme', 'needs-auth'),
  connection('c-anthropic', 'anthropic', 'Anthropic'),
]
const BACKENDS = { backends: [{ id: 'harness:claude', kind: 'harness', label: 'Claude Code', models: [], defaultModelId: '' }], missing: [] }

vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { key: string }) => ({
    get data() {
      const key = options().key
      if (key === 'integrations') return { providers: PROVIDERS, integrations: INTEGRATIONS }
      if (key === 'backends') return BACKENDS
      return undefined
    },
    isPending: false,
    isError: false,
  }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}))
vi.mock('../../../infra/queries', () => ({
  integrationsKey: ['integrations'],
  integrationsOptions: () => ({ key: 'integrations' }),
  integrationMappingsKey: () => ['mappings'],
  integrationMappingsOptions: () => ({ key: 'mappings' }),
  integrationProjectsOptions: () => ({ key: 'projects' }),
  workspacesOptions: () => ({ key: 'workspaces' }),
  modelBackendsOptions: () => ({ key: 'backends' }),
  prefsOptions: () => ({ key: 'prefs' }),
}))

import ServicesSettings from './ServicesSettings'
import AiModelsSettings from '../models/AiModelsSettings'
import type { SettingsPageContext } from '../../../host/registries/shell/settings'

const context: SettingsPageContext = { scope: { nodeId: 'node-a' }, navigate: () => {}, onWorkspaceDeleted: () => {} }
let host: HTMLElement
let dispose: (() => void) | undefined
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

const labels = (section: string) => [...host.querySelectorAll(`[data-settings-section="${section}"] .ui-setting-label`)].map((label) => label.textContent)
const press = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === text)!.click()

describe('Services', () => {
  it('lists a refused connection first with a badge, and its page leads with the fix', () => {
    dispose = render(() => <ServicesSettings context={context} />, host)
    // The model key is AI models', not this page's.
    expect(labels('connections')).toEqual(['Linear · Acme', 'GitHub · someone'])
    const first = host.querySelector('[data-settings-section="connections"] .ui-setting-row')!
    expect(first.querySelector('.ui-badge')?.textContent).toBe('Needs you')
    expect(first.querySelector('.ui-badge')?.getAttribute('data-tone')).toBe('danger')

    host.querySelector<HTMLButtonElement>('[aria-label="Manage Linear · Acme"]')!.click()
    const alert = host.querySelector('.ui-alert')!
    expect(alert.textContent).toContain('Linear rejected the key')
    // The fix sits above everything else the page draws.
    expect(alert.compareDocumentPosition(host.querySelector('[data-settings-section="connection"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    press('Replace key')
    expect(host.querySelector('[data-settings-section="credential"]')?.textContent).toContain('Personal API key')
    expect(host.querySelector('[data-settings-section="danger"]')?.textContent).toContain('Disconnect…')
  })

  it('shows a provider at its limit as connected in the gallery, and opens its connection', () => {
    dispose = render(() => <ServicesSettings context={context} />, host)
    press('Add connection')
    const cards = [...host.querySelectorAll('.ui-card')]
    expect(cards.map((card) => card.querySelector('.connection-card-title')?.textContent)).toEqual(['GitHub', 'Linear', 'Anthropic'])
    const github = cards[0]!
    expect(github.textContent).toContain('Connected, one allowed')
    expect(github.getAttribute('data-stripe')).toBe('ok')
    expect(cards[1]!.textContent).not.toContain('Connected')
    expect(cards[2]!.textContent).toContain('Listed on AI models')
    ;(github as HTMLButtonElement).click()
    expect(host.querySelector('[data-settings-section="connection"]')?.textContent).toContain('GitHub')

    press('‹ Services')
    press('Add connection')
    ;([...host.querySelectorAll<HTMLButtonElement>('.ui-card')][1]!).click()
    expect(host.querySelector('[data-settings-section="steps"]')?.textContent).toContain('Personal API key')
  })
})

describe('AI models', () => {
  it('marks Generate with as this device\'s and lists the node\'s keys and CLIs', () => {
    dispose = render(() => <AiModelsSettings context={context} />, host)
    const generate = [...host.querySelectorAll('.ui-setting-row')].find((row) => row.querySelector('.ui-setting-label')?.textContent?.startsWith('Generate with'))!
    expect(generate.querySelector('.ui-setting-scope')?.textContent).toBe('This device')
    expect(labels('keys')).toEqual(['Anthropic'])
    expect(labels('clis')).toEqual(['Claude Code'])
  })
})
