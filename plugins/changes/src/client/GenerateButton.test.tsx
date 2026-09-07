import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvailableModelConnection } from '@acorn/protocol/modelProviders.ts'
import type { ChangesModel } from './changesModel'
import { GenerateButton } from './GenerateButton'
import { effectiveModelPick, type CommitMode } from './model'
import type { ModelPick } from '../shared/api'

// The wand in jsdom, which is the tier that can answer what a press does: whether the control is
// drawn at all, whether it arms over text somebody wrote, and which connection it spends. The pure
// half — which pick wins, what a refusal reads as — is in model.test.ts, and what the node does with
// the request is in ../server/routes/localGit.test.ts.
//
// The model is a stand-in, for the reason the other two pane tests give: `createChangesModel` fetches
// over HTTP and subscribes to the task poll, and neither is what a button is about.

const connection = (id: string, label: string, models: string[]): AvailableModelConnection => ({
  provider: { id: `p-${id}`, label: `Provider ${label}`, models: models.map((m) => ({ id: m, label: m })) },
  connection: { id, label },
} as unknown as AvailableModelConnection)

const generate = vi.fn()
const setModelPick = vi.fn()

const model = (over: {
  connections?: AvailableModelConnection[]
  remembered?: ModelPick | null
  draft?: string
  mode?: CommitMode
  generating?: boolean
}) => {
  const connections = over.connections ?? []
  const [draft, setDraft] = createSignal(over.draft ?? '')
  return {
    modelConnections: () => connections,
    modelPick: () => effectiveModelPick(connections, over.remembered ?? null),
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
  it('draws nothing with no model provider connected', () => {
    draw({ connections: [] })
    expect(host.querySelectorAll('button')).toHaveLength(0)
  })

  it('draws the wand alone with one connection, and a picker beside it with two', () => {
    draw({ connections: [connection('c1', 'Work', ['fast'])] })
    expect(wand()).toBeTruthy()
    expect(picker()).toBe(null)

    host.replaceChildren()
    for (const dispose of disposers.splice(0)) dispose()
    draw({ connections: [connection('c1', 'Work', ['fast']), connection('c2', 'Home', ['slow'])] })
    expect(picker()).toBeTruthy()
  })
})

describe('what a press does', () => {
  it('generates on one press over an empty field', () => {
    draw({ connections: [connection('c1', 'Work', ['fast'])] })
    wand()!.click()
    expect(generate).toHaveBeenCalledWith({ connectionId: 'c1', modelId: 'fast' })
  })

  // The text it would overwrite is the reader's, so the button asks before it replaces it. Two
  // presses, and the label between them is the whole prompt (docs/ui-design.md § The closed kit).
  it('arms first over a message somebody wrote', () => {
    draw({ connections: [connection('c1', 'Work', ['fast'])], draft: 'feat: I wrote this' })
    wand()!.click()
    expect(generate).not.toHaveBeenCalled()
    expect(wand()!.textContent).toContain('Replace?')

    wand()!.click()
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('uses the remembered connection without opening the picker', () => {
    const connections = [connection('c1', 'Work', ['fast']), connection('c2', 'Home', ['slow'])]
    draw({ connections, remembered: { connectionId: 'c2', modelId: 'slow' } })
    wand()!.click()
    expect(generate).toHaveBeenCalledWith({ connectionId: 'c2', modelId: 'slow' })
    expect(popover()).toBe(null)
  })

  // A stale note in a device preference is not a decision to honour.
  it('falls back to the first connection when the remembered one has gone', () => {
    draw({ connections: [connection('c1', 'Work', ['fast'])], remembered: { connectionId: 'deleted', modelId: 'x' } })
    wand()!.click()
    expect(generate).toHaveBeenCalledWith({ connectionId: 'c1', modelId: 'fast' })
  })

  it('is off with nothing to describe, and says why', () => {
    draw({ connections: [connection('c1', 'Work', ['fast'])], mode: 'none' })
    expect(wand()!.disabled).toBe(true)
    expect(wand()!.getAttribute('data-tip')).toBe('Nothing staged or changed to describe')
  })

  it('is busy while a provider is writing', () => {
    draw({ connections: [connection('c1', 'Work', ['fast'])], generating: true })
    expect(wand()!.getAttribute('aria-busy')).toBe('true')
  })
})

describe('the picker', () => {
  it('opens off its own trigger and remembers what is chosen', () => {
    const connections = [connection('c1', 'Work', ['fast']), connection('c2', 'Home', ['slow'])]
    draw({ connections })
    picker()!.click()
    expect(popover()).toBeTruthy()

    const [connectionSelect] = [...document.querySelectorAll<HTMLSelectElement>('.ui-popover select')]
    connectionSelect!.value = 'c2'
    connectionSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(setModelPick).toHaveBeenCalledWith({ connectionId: 'c2', modelId: 'slow' })
  })
})
