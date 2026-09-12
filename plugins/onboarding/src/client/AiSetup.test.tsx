import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, describe, expect, it } from 'vitest'
import { Wizard } from '@acorn/plugin-api/ui/host'
import { integrationsKey, modelBackendsKey } from '@acorn/protocol/api.ts'
import type { IntegrationsResponse } from '@acorn/protocol/api.ts'
import type { ModelBackendsResponse } from '@acorn/protocol/modelProviders.ts'
import AiSetup from './AiSetup'
import { canAdvanceOn, STEPS } from './OnboardingWizard'

// The AI step in the wizard's own chrome, which is the tier that can answer the two things the step
// promises: that it reports what the node found without probing anything itself, and that a first run
// with nothing installed and no key can still leave.
//
// The route is a primed cache rather than a stubbed transport. From the step's side those are the same
// thing — it reads `modelBackendsOptions` and draws the answer — and priming lets one fixture say "one
// CLI here, one not" without a fetch to intercept.
//
// The host `Wizard` is here rather than the whole `OnboardingWizard` because Next is the layout's
// button, not the plugin's. What the plugin owns is `canAdvanceOn`, and that is the value passed in,
// so the assertion is on the real rule and the real control.

const backends: ModelBackendsResponse = {
  backends: [
    { id: 'harness:claude-code', kind: 'harness', label: 'Claude Code', models: [], defaultModelId: '' },
  ],
  missing: [{ id: 'harness:codex', label: 'Codex' }],
}

// No providers and no connections: the machine has an agent CLI and nothing else, which is the case
// this whole programme exists for.
const noProviders: IntegrationsResponse = { providers: [], integrations: [] }

let host: HTMLDivElement
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

const mount = (route: ModelBackendsResponse, integrations: IntegrationsResponse): void => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(modelBackendsKey, route)
  client.setQueryData(integrationsKey, integrations)
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => (
    <QueryClientProvider client={client}>
      <Wizard
        stateKey="onboarding"
        label="Set up acorn"
        steps={STEPS}
        current="ai"
        canAdvance={canAdvanceOn('ai', 0)}
        regions={{ step: () => <AiSetup /> }}
      />
    </QueryClientProvider>
  ), host)
}

const text = (): string => host.textContent ?? ''
const button = (label: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll('button')].find((el) => el.textContent?.trim() === label)
/** A card is a button whose text is its whole body, so it is found by what it contains. */
const card = (contains: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>('button.ui-card')].find((el) => el.textContent?.includes(contains))

describe('the AI step', () => {
  it('reports an installed CLI and one that is not on this machine', () => {
    mount(backends, noProviders)
    expect(text()).toContain('Claude Code')
    expect(text()).toContain('Installed. Generate SQL, commit messages, and workflows with it.')
    expect(text()).toContain('Codex')
    expect(text()).toContain('Not found on this machine.')
    // Quiet, not an error. A missing CLI is a fact about the machine, and an alert here would read as
    // something the reader has to fix before going on.
    expect(host.querySelector('.ui-alert')).toBeNull()
  })

  it('lets a first run past it with neither a CLI nor a key', () => {
    mount({ backends: [], missing: [] }, noProviders)
    const next = button('Next')
    expect(next).toBeTruthy()
    expect(next!.disabled).toBe(false)
    // The one line that has to be there when there is nothing else to say.
    expect(text()).toContain('Settings, under Integrations')
  })

  it('offers a key form built from the provider descriptor', () => {
    mount({ backends: [], missing: [] }, {
      providers: [{
        id: 'openai',
        label: 'OpenAI',
        kind: 'model-provider',
        glyph: 'brand:model-providers/openai',
        connection: {
          authKind: 'api-key',
          fields: [{ id: 'apiKey', label: 'API key', type: 'password', required: true }],
          connectable: true,
          disconnectable: true,
          maxConnections: 1,
        },
        capabilities: {},
      }],
      integrations: [],
    })
    expect(text()).toContain('OpenAI')
    card('OpenAI')!.click()
    expect(text()).toContain('Connect OpenAI')
    expect(host.querySelector('input[type="password"]')).toBeTruthy()
    // Nothing typed, so there is nothing to submit yet.
    expect(button('Connect')?.disabled).toBe(true)
  })
})
