import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import type { AuthoringTurnRequest, AuthoringTurnResult } from '@acorn/protocol/authoring.ts'
import type { AuthoringConversationProps } from '@acorn/plugin-api/ui/data-sources'
import type { WorkflowDef } from '../../shared/workflowContracts'

// Generate, in the tier that can answer what a press does (docs/workflows/authoring.md § Authoring): whether
// the button is drawn at all and whether a whole definition lands as one undo entry. The prompt and
// the grounding are pure and tested on the node side.

const original: WorkflowDef = { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Ship it', steps: [{ name: 'plan', prompt: 'Plan the change' }] }
const generated: WorkflowDef = { baseline: 'acorn-1' as const, formatVersion: 1 as const,
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
let currentDef = original
let currentKinds: import('../../shared/workflowContracts').WorkflowCatalog['kinds'] = []
let pluginChanged: (() => void) | undefined

vi.mock('../workflowsClient', () => ({
  createWorkflowApi: () => ({
    files: async (request: { action: string }) => request.action === 'list' ? { operations: [] } : { draft: { id: 'file', revision: 1, def: currentDef } },
    def: async (route: string) => ({
      id: 'abc', workspaceId: 'w1', projectId: null, name: original.name,
      revision: route.startsWith('repo:') ? 0 : 1, createdAt: 1, updatedAt: 1, def: currentDef,
    }),
    catalog: async () => ({ kinds: currentKinds, policies: [], profiles: [] }),
    providers: async () => [],
    validateDef: async () => ({ problems: [] }),
    fieldOptions: async () => ({ options: [] }),
    modelBackends: () => modelBackends(),
    generateDef: async () => { throw new Error('legacy generation should not be called') },
  }),
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
  wsOnPluginsChanged: (listener: () => void) => {
    pluginChanged = listener
    return () => { pluginChanged = undefined }
  },
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

// The whole document, not the mount point: the AI authoring dialog portals to the body.
const buttons = (scope: ParentNode = document.body): HTMLButtonElement[] => [...scope.querySelectorAll('button')]
// By visible text, or by accessible name for an icon-only button such as Undo.
const button = (text: string, scope: ParentNode = document.body): HTMLButtonElement | undefined =>
  buttons(scope).find((el) => el.textContent?.trim() === text || (!el.textContent?.trim() && el.getAttribute('aria-label') === text))
const press = async (text: string, scope: ParentNode = document.body): Promise<void> => {
  const found = button(text, scope)
  if (!found) throw new Error(`no ${text} button: ${buttons(scope).map((el) => el.textContent).join(', ')}`)
  found.click()
  await settle()
}
const type = (value: string): void => {
  const field = document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="What should AI change?"]')
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
  currentDef = original
  currentKinds = []
  pluginChanged = undefined
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
    expect(button('Publish…')).toBeDefined()
    expect(button('AI authoring')).toBeDefined()
  })

  it('sits beside Undo and opens the bounded conversation', async () => {
    await mount('db:abc')
    const labels = buttons().map((el) => el.textContent?.trim() || el.getAttribute('aria-label'))
    expect(labels.indexOf('AI authoring')).toBe(labels.indexOf('Undo') - 1)
    await press('AI authoring')
    expect(document.body.textContent).toContain('Use preview records to help AI')
  })
})

it('refreshes a missing step when its plugin returns without changing the saved definition', async () => {
  currentDef = { baseline: 'acorn-1', formatVersion: 1, name: 'Send', steps: [
    { id: 'send', name: 'Send', kind: 'mail:send', with: { recipient: 'team' } },
  ] }
  await mount('db:abc')
  expect(document.body.textContent).toContain("The mail plugin isn't on this computer.")
  expect(document.body.textContent).toContain("Can't run this workflow")
  currentKinds = [{ id: 'mail:send', pluginId: 'mail', describe: {
    label: 'Send mail', description: 'Send mail to the team.', icon: 'send', fields: [],
    output: { description: 'The delivery receipt.' },
  } }]
  pluginChanged?.()
  await settle()
  // The outline row names the kind once its plugin is back.
  expect(document.body.textContent).toContain('Send mail')
  expect(document.body.textContent).not.toContain("The mail plugin isn't on this computer.")
  expect(document.body.textContent).not.toContain("Can't run this workflow")
  expect(document.body.textContent).toContain('Not published')
  expect(currentDef.steps[0]?.with).toEqual({ recipient: 'team' })
})

describe('reviewing an AI proposal', () => {
  it('leaves the draft unchanged until review, then applies one undoable edit', async () => {
    await mount('db:abc')
    expect(button('Undo')?.disabled).toBe(true)

    await propose()
    expect(document.body.textContent).toContain('Review AI proposal')
    expect(document.body.textContent).toContain('plan')
    await press('Apply reviewed edit')
    expect(document.body.textContent).toContain('synthesise')
    expect(document.body.textContent).not.toContain('Plan the change')
    expect(toasts).toEqual(["AI's changes applied. Undo puts your version back."])

    await press('Undo')
    expect(document.body.textContent).toContain('plan')
    expect(document.body.textContent).not.toContain('synthesise')
    // Exactly one entry: the second press has nothing left to undo.
    expect(button('Undo')?.disabled).toBe(true)
  })

  // A new workflow's proposal is all additions, which carry no `before`. Drawing one used to throw
  // inside the render, so the dialog froze on its first status line and showed nothing.
  // A change names the step it touches, found in the proposal when the change adds it.
  it('draws a proposal that adds and removes paths', async () => {
    const candidate = { ...generated, steps: [{ ...generated.steps[0]!, id: 'step-7', name: 'Angle one' }] }
    authorTurn.mockResolvedValue({
      state: 'proposal', base: original, baseRevision: 1, candidate, summary: 'Replace the plan.',
      diff: [{ path: '/steps/step-7', change: 'add', after: candidate.steps[0] }, { path: '/steps/plan', change: 'remove', before: original.steps[0] }],
      problems: [], context: [], usage: { requests: 1, inputTokens: 10, outputTokens: 5 }, providerId: 'anthropic', modelId: 'opus',
    })
    await mount('db:abc')
    await propose()
    expect(document.body.textContent).toContain('Added Angle one: nothing →')
    expect(document.body.textContent).toContain('Removed plan:')
    expect(document.body.textContent).toContain('→ nothing')
    expect(button('Apply reviewed edit')).toBeDefined()
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
    expect(document.body.textContent).toContain('plan')
    expect(document.body.textContent).not.toContain('synthesise')
    expect(document.body.textContent).toContain('Draft unchanged')
  })

  it('cancels an in-flight request and keeps the draft', async () => {
    authorTurn.mockImplementation(() => new Promise(() => undefined))
    await mount('db:abc')
    await press('AI authoring')
    type('Change it.')
    await press('Send')
    await press('Cancel')
    expect(document.body.textContent).toContain('plan')
    expect(document.body.textContent).toContain('Cancelled')
  })

  it('keeps a pending clarification recoverable in device storage', async () => {
    authorTurn.mockResolvedValue({ state: 'clarification', question: 'Which state?', choices: [{ id: 'a', label: 'Active' }, { id: 'b', label: 'Backlog' }], context: [{ role: 'assistant', content: 'question' }], usage: { requests: 1, inputTokens: 2, outputTokens: 1 }, providerId: 'p', modelId: 'm' })
    await mount('db:abc')
    await propose()
    expect(document.body.textContent).toContain('Which state?')
    const saved = Array.from({ length: localStorage.length }, (_value, index) => localStorage.getItem(localStorage.key(index)!)).join('\n')
    expect(saved).toContain('Which state?')
  })
})
