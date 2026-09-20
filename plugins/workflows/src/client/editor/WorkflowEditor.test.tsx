import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import type { AuthoringTurnRequest, AuthoringTurnResult } from '@acorn/protocol/authoring.ts'
import type { AuthoringConversationProps } from '@acorn/plugin-api/ui/data-sources'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { generateReason } from './GenerateModal'

// Generate, in the tier that can answer what a press does (docs/workflows.md § Authoring): whether
// the button is drawn at all, whether a whole definition lands as one undo entry, and what a refusal
// reads as. The prompt and the grounding are pure and tested on the node side.

const original: WorkflowDef = { name: 'Ship it', steps: [{ name: 'plan', prompt: 'Plan the change' }] }
const generated: WorkflowDef = {
  name: 'Investigate',
  steps: [
    { name: 'angle-one', prompt: 'One angle' },
    { name: 'angle-two', after: [], prompt: 'Another angle' },
    { name: 'synthesise', after: ['angle-one', 'angle-two'], prompt: 'Read both' },
  ],
}

const backend = (id: string): ModelBackend =>
  ({ id, kind: 'connection', label: 'Mine', models: [{ id: 'opus', label: 'Opus' }], defaultModelId: '' })

const authorTurn = vi.fn<(input: AuthoringTurnRequest) => Promise<AuthoringTurnResult>>()
const modelBackends = vi.fn<() => Promise<ModelBackend[]>>()
const toasts: string[] = []

vi.mock('../workflowsClient', () => ({
  workflowApi: {
    files: async (request: { action: string }) => request.action === 'list' ? { operations: [] } : { draft: { id: 'file', revision: 1, def: original } },
    def: async (route: string) => ({
      id: 'abc', workspaceId: 'w1', projectId: null, name: original.name,
      revision: route.startsWith('repo:') ? 0 : 1, createdAt: 1, updatedAt: 1, def: original,
    }),
    catalog: async () => ({ kinds: [], policies: [], profiles: [] }),
    providers: async () => [],
    validateDef: async () => ({ problems: [] }),
    fieldOptions: async () => ({ options: [] }),
    modelBackends: () => modelBackends(),
    generateDef: async () => { throw new Error('legacy generation should not be called') },
  },
}))
vi.mock('@acorn/plugin-api/ui/data-sources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@acorn/plugin-api/ui/data-sources')>()
  return {
    ...actual,
    AuthoringConversation: (props: AuthoringConversationProps) => actual.AuthoringConversation({
      ...props,
      sendTurn: request => authorTurn(request),
    }),
  }
})
vi.mock('@solidjs/router', () => ({ useNavigate: () => () => undefined, useSearchParams: () => [{}, () => undefined] }))
// One `createQuery` for both readers: the editor's workspaces and the Generate dialog's prefs. The
// dialog asks the prefs record for one key, and an array answers nothing, which is the same as no
// remembered pick — so the dialog opens on the first backend, which is what these cases assert.
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: Object.assign([{ id: 'w1', projects: [{ id: 'p-1' }] }], { backends: [{ id: 'c1', kind: 'connection', label: 'Mine', models: [{ id: 'opus', label: 'Opus' }], defaultModelId: 'opus' }] }) }),
  useQueryClient: () => ({ setQueryData: () => undefined, invalidateQueries: async () => undefined }),
}))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  activeTaskId: () => 'task-1',
  toast: (message: string) => void toasts.push(message),
}))

const { default: WorkflowEditor } = await import('./WorkflowEditor')

let host: HTMLDivElement
let dispose: (() => void) | undefined

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const mount = async (item: string): Promise<void> => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <WorkflowEditor projectId="p-1" item={item} />, host)
  await settle()
}

const buttons = (scope: ParentNode = host): HTMLButtonElement[] => [...scope.querySelectorAll('button')]
const button = (text: string, scope: ParentNode = host): HTMLButtonElement | undefined =>
  buttons(scope).find((el) => el.textContent?.trim() === text)
const press = async (text: string, scope: ParentNode = host): Promise<void> => {
  const found = button(text, scope)
  if (!found) throw new Error(`no ${text} button: ${buttons(scope).map((el) => el.textContent).join(', ')}`)
  found.click()
  await settle()
}
const type = (value: string): void => {
  const field = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Instruction or answer"]')
  if (!field) throw new Error('the conversation has no instruction field')
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
const propose = async (): Promise<void> => {
  await press('AI authoring')
  type('Two agents look at one issue at once and a third reads both.')
  await settle()
  await press('Send')
}

beforeEach(() => {
  localStorage.clear()
  modelBackends.mockResolvedValue([backend('c1')])
  authorTurn.mockResolvedValue({
    state: 'proposal', base: original, baseRevision: 1, candidate: generated,
    summary: 'Add two independent reviews and a synthesis.', diff: [{ path: '/name', change: 'change', before: 'Ship it', after: 'Investigate' }], problems: [],
    context: [], usage: { requests: 2, inputTokens: 10, outputTokens: 5 }, providerId: 'anthropic', modelId: 'opus',
  })
})

afterEach(() => {
  dispose?.()
  host.remove()
  toasts.length = 0
  vi.clearAllMocks()
})

describe('the AI authoring entry', () => {
  it('is absent when there is nothing to generate with', async () => {
    modelBackends.mockResolvedValue([])
    await mount('db:abc')
    expect(button('AI authoring')).toBeUndefined()
    expect(button('Undo')).toBeDefined()
  })

  it('supports visual authoring of a file draft', async () => {
    await mount('repo:ship-it')
    expect(host.textContent).toContain('Review publication')
    expect(button('AI authoring')).toBeDefined()
  })

  it('sits beside Undo and opens the bounded conversation', async () => {
    await mount('db:abc')
    const labels = buttons().map((el) => el.textContent?.trim())
    expect(labels.indexOf('AI authoring')).toBe(labels.indexOf('Undo') - 1)
    await press('AI authoring')
    expect(host.textContent).toContain('Use preview records to help AI')
  })
})

describe('reviewing an AI proposal', () => {
  it('leaves the draft unchanged until review, then applies one undoable edit', async () => {
    await mount('db:abc')
    expect(button('Undo')?.disabled).toBe(true)

    await propose()
    expect(host.textContent).toContain('Review AI proposal')
    expect(host.textContent).toContain('plan')
    await press('Apply reviewed edit')
    expect(host.textContent).toContain('synthesise')
    expect(host.textContent).not.toContain('Plan the change')
    expect(toasts).toEqual(['AI proposal applied. Undo restores the previous draft.'])

    await press('Undo')
    expect(host.textContent).toContain('plan')
    expect(host.textContent).not.toContain('synthesise')
    // Exactly one entry: the second press has nothing left to undo.
    expect(button('Undo')?.disabled).toBe(true)
  })

  it('sends the draft revision, selected scope, backend, and sample opt-out', async () => {
    await mount('db:abc')
    await propose()
    expect(authorTurn).toHaveBeenCalledWith(expect.objectContaining({
      target: 'workflow', targetId: 'abc', baseRevision: 1, base: original,
      backendId: 'c1',
      modelId: 'opus',
      scope: { workspaceId: 'w1', projectId: 'p-1' },
      samplesEnabled: false,
      instruction: 'Two agents look at one issue at once and a third reads both.',
    }))
  })

  it('rejects without changing the draft', async () => {
    await mount('db:abc')
    await propose()
    await press('Reject')
    expect(host.textContent).toContain('plan')
    expect(host.textContent).not.toContain('synthesise')
    expect(host.textContent).toContain('Draft unchanged')
  })

  it('cancels an in-flight request and keeps the draft', async () => {
    authorTurn.mockImplementation(() => new Promise(() => undefined))
    await mount('db:abc')
    await press('AI authoring')
    type('Change it.')
    await press('Send')
    await press('Cancel')
    expect(host.textContent).toContain('plan')
    expect(host.textContent).toContain('Cancelled')
  })

  it('keeps a pending clarification recoverable in device storage', async () => {
    authorTurn.mockResolvedValue({ state: 'clarification', question: 'Which state?', choices: [{ id: 'a', label: 'Active' }, { id: 'b', label: 'Backlog' }], context: [{ role: 'assistant', content: 'question' }], usage: { requests: 1, inputTokens: 2, outputTokens: 1 }, providerId: 'p', modelId: 'm' })
    await mount('db:abc')
    await propose()
    expect(host.textContent).toContain('Which state?')
    const saved = Array.from({ length: localStorage.length }, (_value, index) => localStorage.getItem(localStorage.key(index)!)).join('\n')
    expect(saved).toContain('Which state?')
  })
})

// A table rather than five renders: the mapping is a pure function and each row is one sentence.
describe('what a refusal reads as', () => {
  const reason = (code: string, message = 'raw') => generateReason(Object.assign(new Error(message), { code }))

  it('keeps the node prose for a reply nothing could be read out of', () => {
    expect(reason('model_answer_unusable', 'No JSON object in the reply.')).toBe('No JSON object in the reply.')
  })

  it('sends a rejected key back to Settings', () => {
    expect(reason('provider_needs_auth')).toContain('Reconnect it in Settings')
  })

  it('offers another connection when that one is gone', () => {
    expect(reason('provider_not_connected')).toContain('no longer connected')
  })

  it('says to try again when the provider is silent', () => {
    expect(reason('provider_unavailable')).toContain('did not answer')
  })

  // An installed CLI that is signed out fails the same way an unreachable provider does, and no
  // amount of retrying fixes it: the next step is to run it once in a terminal.
  it('sends a silent CLI to a terminal instead of telling it to try again', () => {
    const unavailable = Object.assign(new Error('raw'), { code: 'provider_unavailable' })
    expect(generateReason(unavailable, { kind: 'harness', label: 'Claude Code' }))
      .toBe('Claude Code did not answer. Run it once in a terminal to check it is signed in.')
    expect(generateReason(unavailable, { kind: 'connection', label: 'Anthropic' }))
      .toBe('The provider did not answer. Try again shortly.')
  })

  it('falls back to the message, then to a sentence of its own', () => {
    expect(reason('something_else', 'Boom.')).toBe('Boom.')
    expect(generateReason(null)).toBe('Writing the workflow failed.')
  })
})
