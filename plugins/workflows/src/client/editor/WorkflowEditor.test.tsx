import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import type { WorkflowGenerateRequest, WorkflowGenerateResult } from '../../shared/api'
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

const generateDef = vi.fn<(input: WorkflowGenerateRequest) => Promise<WorkflowGenerateResult>>()
const modelBackends = vi.fn<() => Promise<ModelBackend[]>>()
const toasts: string[] = []

vi.mock('../workflowsClient', () => ({
  workflowApi: {
    def: async (route: string) => ({
      id: 'abc', workspaceId: 'w1', projectId: null, name: original.name,
      revision: route.startsWith('repo:') ? 0 : 1, createdAt: 1, updatedAt: 1, def: original,
    }),
    catalog: async () => ({ kinds: [], policies: [], profiles: [] }),
    providers: async () => [],
    validateDef: async () => ({ problems: [] }),
    fieldOptions: async () => ({ options: [] }),
    modelBackends: () => modelBackends(),
    generateDef: (input: WorkflowGenerateRequest) => generateDef(input),
  },
}))
vi.mock('@solidjs/router', () => ({ useNavigate: () => () => undefined }))
// One `createQuery` for both readers: the editor's workspaces and the Generate dialog's prefs. The
// dialog asks the prefs record for one key, and an array answers nothing, which is the same as no
// remembered pick — so the dialog opens on the first backend, which is what these cases assert.
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: [{ id: 'w1', projects: [{ id: 'p-1' }] }] }),
  useQueryClient: () => ({ setQueryData: () => undefined }),
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

// The dialog portals to the body, outside `host`, and it has a Generate of its own, so every lookup
// says which half of the screen it means.
const dialog = (): HTMLElement | null => document.querySelector('.overlay')
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
  const field = dialog()?.querySelector('textarea')
  if (!field) throw new Error('the dialog has no description field')
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

const chooseGeneration = async (choice: 'Overwrite' | 'Edit'): Promise<void> => {
  await press('Generate')
  await press(choice, document)
}

/** Open the overwrite dialog, describe something, and submit it. */
const generate = async (): Promise<void> => {
  await chooseGeneration('Overwrite')
  type('Two agents look at one issue at once and a third reads both.')
  await settle()
  const open = dialog()
  if (!open) throw new Error('the dialog did not open')
  await press('Overwrite', open)
}

beforeEach(() => {
  modelBackends.mockResolvedValue([backend('c1')])
  generateDef.mockResolvedValue({
    def: generated, notes: [], problems: [], repaired: false, providerId: 'anthropic', modelId: 'opus',
  })
})

afterEach(() => {
  dispose?.()
  host.remove()
  toasts.length = 0
  vi.clearAllMocks()
})

describe('the Generate button', () => {
  it('is absent when there is nothing to generate with', async () => {
    modelBackends.mockResolvedValue([])
    await mount('db:abc')
    expect(button('Generate')).toBeUndefined()
    expect(button('Undo')).toBeDefined()
  })

  it('is absent on a committed file, which has nothing to write into', async () => {
    await mount('repo:ship-it')
    expect(host.textContent).toContain('This one is a committed file')
    expect(button('Generate')).toBeUndefined()
  })

  it('is a dropdown beside Undo when there is a saved workflow to preserve', async () => {
    await mount('db:abc')
    const labels = buttons().map((el) => el.textContent?.trim())
    expect(labels.indexOf('Generate')).toBe(labels.indexOf('Undo') - 1)
    await press('Generate')
    expect(button('Overwrite', document)).toBeDefined()
    expect(button('Edit', document)).toBeDefined()
  })
})

describe('applying a generated definition', () => {
  it('replaces the draft and one Undo puts it back', async () => {
    await mount('db:abc')
    expect(button('Undo')?.disabled).toBe(true)

    await generate()
    expect(host.textContent).toContain('synthesise')
    expect(host.textContent).not.toContain('Plan the change')
    expect(toasts).toEqual(['Workflow generated.'])
    // The dialog closes on success.
    expect(dialog()).toBeNull()

    await press('Undo')
    expect(host.textContent).toContain('plan')
    expect(host.textContent).not.toContain('synthesise')
    // Exactly one entry: the second press has nothing left to undo.
    expect(button('Undo')?.disabled).toBe(true)
  })

  it('sends the row being edited, so it is not a worked example of itself', async () => {
    await mount('db:abc')
    await generate()
    expect(generateDef).toHaveBeenCalledWith(expect.objectContaining({
      backendId: 'c1',
      modelId: 'opus',
      workspaceId: 'w1',
      defId: 'abc',
      mode: 'overwrite',
      name: 'Ship it',
      description: 'Two agents look at one issue at once and a third reads both.',
    }))
  })

  it('draws the notes above the list, and dismisses them', async () => {
    generateDef.mockResolvedValue({
      def: generated,
      notes: [
        { code: 'unknown-kind', message: "'code-review' is not a step kind here, so 'review' is an agent step now." },
        { code: 'declared-input', message: "Declared the input 'issue', which a prompt referenced." },
      ],
      problems: [],
      repaired: true,
      providerId: 'anthropic',
      modelId: 'opus',
    })
    await mount('db:abc')
    await generate()
    expect(host.textContent).toContain('is not a step kind here')
    expect(host.textContent).toContain("Declared the input 'issue'")
    // Above the list, not in it.
    const text = host.textContent ?? ''
    expect(text.indexOf('is not a step kind here')).toBeLessThan(text.indexOf('+ Add'))

    await press('Dismiss')
    expect(host.textContent).not.toContain('is not a step kind here')
  })

  it('cannot be dismissed while the model is writing, so a late reply lands on the draft it was asked for', async () => {
    // There is no way to call a generation off once it is running, so Escape and a backdrop click
    // have to refuse for as long as Cancel does. Otherwise the dialog goes, the reply arrives two
    // minutes later, and it replaces whatever was edited in the meantime.
    let land: (result: WorkflowGenerateResult) => void = () => undefined
    generateDef.mockReturnValue(new Promise<WorkflowGenerateResult>((resolve) => { land = resolve }))
    await mount('db:abc')
    await generate()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    host.querySelector<HTMLElement>('.overlay-backdrop')?.click()
    await settle()
    expect(dialog()).not.toBeNull()

    land({ def: generated, notes: [], problems: [], repaired: false, providerId: 'anthropic', modelId: 'opus' })
    await settle()
    expect(dialog()).toBeNull()
    expect(host.textContent).toContain('synthesise')
  })

  it('closes on Escape before anything has been asked for', async () => {
    await mount('db:abc')
    await chooseGeneration('Overwrite')
    expect(dialog()).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(dialog()).toBeNull()
  })

  it('sends the current workflow for an edit and applies the result as one undo entry', async () => {
    await mount('db:abc')
    await chooseGeneration('Edit')
    expect(dialog()?.querySelector('textarea')?.getAttribute('aria-label')).toBe('Requested edits')
    type('Add a second independent review before the final step.')
    const open = dialog()
    if (!open) throw new Error('the dialog did not open')
    await press('Edit workflow', open)

    expect(generateDef).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'edit',
      currentDef: original,
      description: 'Add a second independent review before the final step.',
    }))
    expect(host.textContent).toContain('synthesise')
    expect(toasts).toEqual(['Workflow edited.'])

    await press('Undo')
    expect(host.textContent).toContain('plan')
    expect(button('Undo')?.disabled).toBe(true)
  })

  it('keeps the draft and says why when the model answer is unusable', async () => {
    generateDef.mockRejectedValue(Object.assign(new Error('The reply was not JSON.'), { code: 'model_answer_unusable' }))
    await mount('db:abc')
    await generate()
    // The message is in the dialog, which portals out of `host`.
    expect(dialog()?.textContent).toContain('The reply was not JSON.')
    // Still open, so the description is there to try again with.
    expect(dialog()).not.toBeNull()
    expect(toasts).toEqual([])
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
