import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryProposalRow } from './memoryClient'

// The human gate over agent-proposed memory, in jsdom. What is stubbed is the node behind it; the
// buttons, the description edit, the error path and the callback out are the shipped code.
//
// This tier exists because accept and reject are the only two irreversible things this plugin does
// from a click, and neither had a test that pressed the button.

// jsdom does no layout, so a card cannot scroll itself into view. `Card`'s `focus` prop does exactly
// that for the proposal a notification row named, and without the stub it throws.
Element.prototype.scrollIntoView ??= () => {}

const resolveProposal = vi.fn<(id: string, approved: boolean, edited?: unknown) => Promise<{ ok: boolean; reason?: string }>>()
vi.mock('./memoryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./memoryClient')>()),
  memoryApi: () => ({ resolveProposal }),
}))

const { default: ProposalList } = await import('./ProposalList')

const proposal = (over: Partial<MemoryProposalRow> = {}): MemoryProposalRow => ({
  id: 'p1', taskId: 't1', projectId: 'proj-1', name: 'no-ponytail-comments', type: 'convention',
  description: 'strip the marker before committing', body: 'Why: it is a review marker.',
  flags: [], status: 'pending', createdAt: 0, ...over,
})

let host: HTMLDivElement
let dispose: () => void
const onResolved = vi.fn()

const mount = (rows: MemoryProposalRow[] = [proposal()]) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <ProposalList proposals={rows} onResolved={onResolved} />, host)
}

const button = (label: string): HTMLButtonElement => {
  const found = [...host.querySelectorAll('button')].find((el) => el.textContent?.trim() === label)
  if (!found) throw new Error(`no ${label} button in: ${[...host.querySelectorAll('button')].map((el) => el.textContent).join(', ')}`)
  return found
}

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  resolveProposal.mockReset()
  resolveProposal.mockResolvedValue({ ok: true })
  onResolved.mockReset()
})
afterEach(() => {
  dispose?.()
  host?.remove()
})

describe('resolving a proposal', () => {
  it('accepts with no edit, and tells the owner so it can refetch', async () => {
    mount()
    button('Accept').click()
    await settle()
    // No `edited`: the description was not touched, and sending it back unchanged would make every
    // accept look like an edit in the store.
    expect(resolveProposal).toHaveBeenCalledWith('p1', true, undefined)
    expect(onResolved).toHaveBeenCalled()
  })

  it('sends the edited description when the owner changed it', async () => {
    mount()
    const input = host.querySelector('input') as HTMLInputElement
    input.value = 'strip it before you commit'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    button('Accept').click()
    await settle()
    expect(resolveProposal).toHaveBeenCalledWith('p1', true, {
      name: 'no-ponytail-comments', type: 'convention', description: 'strip it before you commit',
      body: 'Why: it is a review marker.',
    })
  })

  it('rejects without carrying the edit, since nothing is written', async () => {
    mount()
    button('Reject').click()
    await settle()
    expect(resolveProposal).toHaveBeenCalledWith('p1', false, undefined)
    expect(onResolved).toHaveBeenCalled()
  })

  // The two ways this used to fail silently. A refused accept answers 200 with `ok: false`, and a
  // route that is gated, missing or 500s throws out of the client. Neither put anything on screen, so
  // the button read as dead.
  it('shows the node’s reason when it refuses', async () => {
    resolveProposal.mockResolvedValue({ ok: false, reason: 'The task worktree is gone.' })
    mount()
    button('Accept').click()
    await settle()
    expect(host.textContent).toContain('The task worktree is gone.')
  })

  it('shows a thrown request rather than swallowing it', async () => {
    resolveProposal.mockRejectedValue(new Error('bridge-unavailable'))
    mount()
    button('Accept').click()
    await settle()
    expect(host.textContent).toContain('bridge-unavailable')
    // The owner can try again: a failed accept must not leave the row wedged.
    expect(button('Accept').disabled).toBe(false)
    // And it did not report success, which would have refetched the row away.
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('says which proposal failed, not just that one did', async () => {
    resolveProposal.mockResolvedValue({ ok: false, reason: 'The task worktree is gone.' })
    mount([proposal(), proposal({ id: 'p2', name: 'prefer-node-sqlite' })])
    button('Accept').click() // the first card's
    await settle()
    const cards = [...host.querySelectorAll('.ui-card')]
    expect(cards[0].textContent).toContain('The task worktree is gone.')
    expect(cards[1].textContent).not.toContain('The task worktree is gone.')
  })
})

describe('arriving from a notification', () => {
  it('selects the proposal the row named, and only that one', () => {
    host = document.createElement('div')
    document.body.append(host)
    dispose = render(
      () => <ProposalList proposals={[proposal(), proposal({ id: 'p2' })]} onResolved={onResolved} highlightId="p2" />,
      host,
    )
    const selected = [...host.querySelectorAll('.ui-card')].map((card) => card.hasAttribute('data-selected'))
    expect(selected).toEqual([false, true])
  })
})
