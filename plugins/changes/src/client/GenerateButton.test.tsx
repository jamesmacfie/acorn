import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectiveModelPick } from '@acorn/plugin-api/client'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import type { ChangesModel } from './changesModel'
import { GenerateButton } from './GenerateButton'
import type { CommitMode } from './model'
import type { ModelPick } from '../shared/api'

// The wand in jsdom, which is the tier that can answer what a press does: whether the control is
// drawn at all, whether it arms over text somebody wrote, and which backend it spends. The pure
// half — what a refusal reads as — is in model.test.ts, which pick wins is in client-core's
// generatePick.test.ts, and what the node does with the request is in ../server/routes/localGit.test.ts.
//
// The model is a stand-in, for the reason the other two pane tests give: `createChangesModel` fetches
// over HTTP and subscribes to the task poll, and neither is what a button is about.

const backend = (id: string, label: string, models: string[], kind: ModelBackend['kind'] = 'connection'): ModelBackend =>
  ({ id, kind, label, models: models.map((m) => ({ id: m, label: m })), defaultModelId: '' })

const generate = vi.fn()
const setModelPick = vi.fn()

const model = (over: {
  backends?: ModelBackend[]
  remembered?: ModelPick | null
  draft?: string
  mode?: CommitMode
  generating?: boolean
}) => {
  const backends = over.backends ?? []
  const [draft, setDraft] = createSignal(over.draft ?? '')
  return {
    modelBackends: () => backends,
    modelPick: () => effectiveModelPick(backends, over.remembered ?? null),
    setModelPick,
    draft,
    setDraft,
    commitMode: () => over.mode ?? 'staged',
    generating: () => !!over.generating,
    generate,
  } as unknown as ChangesModel
}

let host: HTMLElement
const disposers: (() => void)[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  host.remove()
  for (const surface of document.querySelectorAll('.ui-popover')) surface.remove()
  generate.mockClear()
  setModelPick.mockClear()
})

// Built before the render, not inside it: a JSX prop is a getter, so `model={model(...)}` would mint
// a new one on every read.
const draw = (over: Parameters<typeof model>[0]) => {
  const built = model(over)
  disposers.push(render(() => <GenerateButton model={built} />, host))
  return built
}

const wand = () => host.querySelector<HTMLButtonElement>('button[aria-label="Write the commit message"]')
const picker = () => host.querySelector<HTMLButtonElement>('button[aria-label="Model for the message"]')
const popover = () => document.querySelector('.ui-popover')

describe('whether it is drawn at all', () => {
  it('draws nothing with nothing to spend', () => {
    draw({ backends: [] })
    expect(host.querySelectorAll('button')).toHaveLength(0)
  })

  // The whole point of the backends list: an owner with no API key and `claude` on PATH gets the wand.
  it('draws the wand for an installed CLI with no key connected', () => {
    draw({ backends: [backend('harness:claude-code', 'Claude Code', [], 'harness')] })
    expect(wand()).toBeTruthy()
  })

  it('draws the wand alone with one backend, and a picker beside it with two', () => {
    draw({ backends: [backend('c1', 'Work', ['fast'])] })
    expect(wand()).toBeTruthy()
    expect(picker()).toBe(null)

    host.replaceChildren()
    for (const dispose of disposers.splice(0)) dispose()
    draw({ backends: [backend('c1', 'Work', ['fast']), backend('c2', 'Home', ['slow'])] })
    expect(picker()).toBeTruthy()
  })
})

describe('what a press does', () => {
  it('generates on one press over an empty field', () => {
    const chosen = backend('c1', 'Work', ['fast'])
    draw({ backends: [chosen] })
    wand()!.click()
    // The second argument is the backend itself, which only the failure copy reads: a signed-out CLI
    // fails like an unreachable provider and needs a different next step (./model.ts § generateReason).
    expect(generate).toHaveBeenCalledWith({ backendId: 'c1', modelId: 'fast' }, chosen)
  })

  // The text it would overwrite is the reader's, so the button asks before it replaces it. Two
  // presses, and the label between them is the whole prompt (docs/ui-design.md § The closed kit).
  it('arms first over a message somebody wrote', () => {
    draw({ backends: [backend('c1', 'Work', ['fast'])], draft: 'feat: I wrote this' })
    wand()!.click()
    expect(generate).not.toHaveBeenCalled()
    expect(wand()!.textContent).toContain('Replace?')

    wand()!.click()
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('uses the remembered backend without opening the picker', () => {
    const home = backend('c2', 'Home', ['slow'])
    draw({ backends: [backend('c1', 'Work', ['fast']), home], remembered: { backendId: 'c2', modelId: 'slow' } })
    wand()!.click()
    expect(generate).toHaveBeenCalledWith({ backendId: 'c2', modelId: 'slow' }, home)
    expect(popover()).toBe(null)
  })

  // A stale note in a device preference is not a decision to honour.
  it('falls back to the first backend when the remembered one has gone', () => {
    const work = backend('c1', 'Work', ['fast'])
    draw({ backends: [work], remembered: { backendId: 'deleted', modelId: 'x' } })
    wand()!.click()
    expect(generate).toHaveBeenCalledWith({ backendId: 'c1', modelId: 'fast' }, work)
  })

  it('is off with nothing to describe, and says why', () => {
    draw({ backends: [backend('c1', 'Work', ['fast'])], mode: 'none' })
    expect(wand()!.disabled).toBe(true)
    expect(wand()!.getAttribute('data-tip')).toBe('Nothing staged or changed to describe')
  })

  it('is busy while a provider is writing', () => {
    draw({ backends: [backend('c1', 'Work', ['fast'])], generating: true })
    expect(wand()!.getAttribute('aria-busy')).toBe('true')
  })
})

describe('the picker', () => {
  it('opens off its own trigger and remembers what is chosen', () => {
    draw({ backends: [backend('c1', 'Work', ['fast']), backend('c2', 'Home', ['slow'])] })
    picker()!.click()
    expect(popover()).toBeTruthy()

    const [backendSelect] = [...document.querySelectorAll<HTMLSelectElement>('.ui-popover select')]
    backendSelect!.value = 'c2'
    backendSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    // The model resets with the backend: a model id belongs to one backend, and carrying `fast` over
    // would ask Home for a model Work serves.
    expect(setModelPick).toHaveBeenCalledWith({ backendId: 'c2', modelId: 'slow' })
  })
})
