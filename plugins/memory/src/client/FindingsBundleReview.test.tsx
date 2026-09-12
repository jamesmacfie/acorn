import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FindingBundle, FindingCandidateRevision } from '@acorn/plugin-findings/contract/review.ts'

Element.prototype.scrollIntoView ??= () => {}
const mocks = vi.hoisted(() => ({ bundles: vi.fn(), finding: vi.fn(), findingHistory: vi.fn(), prepare: vi.fn(), retryPreparation: vi.fn(), approveFinding: vi.fn(), editFinding: vi.fn(), decideFinding: vi.fn(), cancelPreparation: vi.fn(), restoreFindingObservation: vi.fn(), splitFinding: vi.fn() }))
vi.mock('./memoryClient', () => ({ memoryApi: () => mocks }))
vi.mock('@acorn/plugin-api/client', async (original) => ({ ...await original<Record<string, unknown>>(), onPluginFrame: () => () => {} }))
const { default: FindingsBundleReview } = await import('./FindingsBundleReview')

const payload = { operation: 'update' as const, name: 'owner-boundaries', type: 'architecture' as const, description: 'Keep writes with owners.', body: 'New full body.', scope: { kind: 'project' as const, projectId: 'project-1' }, baseMemoryId: 'memory-1', baseHash: 'hash-1' }
const candidate = (id: string): FindingCandidateRevision => ({ candidateId: id, revision: 1, targetKind: 'memory:change', targetVersion: 1, scope: { kind: 'project', projectId: 'project-1' }, payload, sourceObservationIds: ['observation-1'], payloadHash: 'payload-hash', fingerprint: id, subjectKey: id, groupingExplanation: 'Grouped exact target evidence.', warnings: ['Review the contradiction.'], base: { targetId: 'memory-1', hash: 'hash-1', payload: { ...payload, description: 'Old description.', body: 'Old full body.' } }, status: 'ready', snoozedUntil: null, createdAt: 1, updatedAt: 1 })
const bundle = (count: number): FindingBundle => ({ id: 'bundle', scope: { kind: 'project', projectId: 'project-1' }, boundaryKey: 'manual', revision: 1, state: 'ready', backendId: null, modelId: null, candidates: Array.from({ length: count }, (_, index) => candidate(`candidate-${index + 1}`)), outcomes: [], inputCount: count, pendingCount: 0, createdAt: 1, updatedAt: 1, error: null })

let host: HTMLDivElement, dispose: () => void
afterEach(() => { dispose?.(); host?.remove(); vi.clearAllMocks() })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('findings-backed memory review', () => {
  it('limits summaries to three, then opens the exact full preview with update diff and evidence', async () => {
    mocks.bundles.mockResolvedValue([bundle(4)])
    mocks.finding.mockResolvedValue({ ...candidate('candidate-1'), observations: [{ id: 'observation-1', title: 'Evidence', body: 'Observed source body.', claimStatus: 'observed', evidence: [] }] })
    mocks.findingHistory.mockResolvedValue({ items: [{ id: 'history-1', candidateId: 'candidate-1', expectedRevision: 1, actorId: 'device-1', action: 'edit', reason: null, createdAt: 1 }] })
    host = document.createElement('div'); document.body.append(host); dispose = render(() => <FindingsBundleReview scope={{ kind: 'project', projectId: 'project-1' }} />, host)
    await settle()
    expect([...host.querySelectorAll('button')].filter((button) => button.textContent === 'View change')).toHaveLength(3)
    const showAll = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Show all 4 changes')! as HTMLButtonElement
    showAll.click(); expect([...host.querySelectorAll('button')].filter((button) => button.textContent === 'View change')).toHaveLength(4)
    ;([...host.querySelectorAll('button')].find((button) => button.textContent === 'View change') as HTMLButtonElement).click(); await settle()
    expect(host.textContent).toContain('New full body.')
    expect(host.textContent).toContain('Old full body.')
    expect(host.textContent).toContain('Observed source body.')
    expect(host.textContent).toContain('Applies to this project')
    expect(host.textContent).toContain('Review history')
  })

  it('opens a legacy-mapped candidate when the asynchronous mapping arrives', async () => {
    mocks.bundles.mockResolvedValue([bundle(4)])
    mocks.finding.mockResolvedValue({ ...candidate('candidate-4'), observations: [] })
    mocks.findingHistory.mockResolvedValue({ items: [] })
    const [focus, setFocus] = createSignal<string>()
    host = document.createElement('div'); document.body.append(host)
    dispose = render(() => <FindingsBundleReview scope={{ kind: 'project', projectId: 'project-1' }} focusCandidateId={focus()} />, host)
    await settle()
    setFocus('candidate-4')
    await settle()
    expect(host.textContent).toContain('New full body.')
  })

  it('keeps undo available after a dismissal without leaving approval active', async () => {
    mocks.bundles.mockResolvedValue([bundle(1)])
    mocks.finding.mockResolvedValue({ ...candidate('candidate-1'), observations: [] })
    mocks.decideFinding.mockResolvedValue({ ...candidate('candidate-1'), status: 'dismissed' })
    host = document.createElement('div'); document.body.append(host); dispose = render(() => <FindingsBundleReview scope={{ kind: 'project', projectId: 'project-1' }} />, host)
    await settle()
    ;([...host.querySelectorAll('button')].find((button) => button.textContent === 'View change') as HTMLButtonElement).click()
    await settle()
    ;([...host.querySelectorAll('button')].find((button) => button.textContent === 'Dismiss') as HTMLButtonElement).click()
    await settle()
    expect(host.textContent).toContain('Suggestion dismissed')
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === 'Approve')).toBe(false)
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === 'Undo')).toBe(true)
    ;([...host.querySelectorAll('button')].find((button) => button.textContent === 'Task-specific') as HTMLButtonElement).click()
    await settle()
    expect(mocks.decideFinding).toHaveBeenLastCalledWith('candidate-1', expect.objectContaining({ action: 'dismiss-reason', reason: 'task-specific' }))
  })

  it('restores omitted evidence and separates a source through device review actions', async () => {
    const grouped = { ...candidate('candidate-1'), sourceObservationIds: ['observation-1', 'observation-2'] }
    const withOmission = { ...bundle(1), candidates: [grouped], outcomes: [{ observationId: 'observation-3', outcome: 'not-selected' as const, candidateId: null, explanation: 'Task-specific.' }] }
    mocks.bundles.mockResolvedValue([withOmission])
    mocks.finding.mockResolvedValue({ ...grouped, observations: [{ id: 'observation-1', title: 'First', body: 'First body.', claimStatus: 'observed', evidence: [] }, { id: 'observation-2', title: 'Second', body: 'Second body.', claimStatus: 'observed', evidence: [] }] })
    mocks.restoreFindingObservation.mockResolvedValue(withOmission)
    mocks.splitFinding.mockResolvedValue(withOmission)
    host = document.createElement('div'); document.body.append(host); dispose = render(() => <FindingsBundleReview scope={{ kind: 'project', projectId: 'project-1' }} />, host)
    await settle()
    ;([...host.querySelectorAll('button')].find((button) => button.textContent === 'View change') as HTMLButtonElement).click()
    await settle()
    ;([...host.querySelectorAll('button')].find((button) => button.textContent === 'Restore to open change') as HTMLButtonElement).click()
    ;([...host.querySelectorAll('button')].find((button) => button.textContent === 'Separate') as HTMLButtonElement).click()
    await settle()
    expect(mocks.restoreFindingObservation).toHaveBeenCalledWith('bundle', 'observation-3', 'candidate-1', 1, expect.any(String))
    expect(mocks.splitFinding).toHaveBeenCalledWith('candidate-1', 'bundle', 1, ['observation-1'], expect.any(String))
  })

  it('resumes an automatic bundle by durable bundle identity', async () => {
    const cancelled = { ...bundle(1), state: 'cancelled' as const, boundaryKey: 'workflow:run-1:terminal', backendId: 'connection:model-1', modelId: 'fixture-model', pendingCount: 1 }
    mocks.bundles.mockResolvedValue([cancelled])
    mocks.retryPreparation.mockResolvedValue({ ...cancelled, state: 'preparing' })
    host = document.createElement('div'); document.body.append(host); dispose = render(() => <FindingsBundleReview scope={{ kind: 'project', projectId: 'project-1' }} />, host)
    await settle()
    ;([...host.querySelectorAll('button')].find((button) => button.textContent === 'Resume') as HTMLButtonElement).click()
    await settle()
    expect(mocks.retryPreparation).toHaveBeenCalledWith('bundle')
  })

  it('offers a review-selected snooze date', async () => {
    mocks.bundles.mockResolvedValue([bundle(1)])
    mocks.finding.mockResolvedValue({ ...candidate('candidate-1'), observations: [] })
    mocks.decideFinding.mockResolvedValue({ ...candidate('candidate-1'), status: 'snoozed' })
    host = document.createElement('div'); document.body.append(host); dispose = render(() => <FindingsBundleReview scope={{ kind: 'project', projectId: 'project-1' }} />, host)
    await settle()
    ;([...host.querySelectorAll('button')].find((button) => button.textContent === 'View change') as HTMLButtonElement).click()
    await settle()
    ;([...host.querySelectorAll('button')].find((button) => button.textContent === 'Snooze') as HTMLButtonElement).click()
    const date = host.querySelector('input[type="date"]')! as HTMLInputElement
    date.value = '2030-01-02'; date.dispatchEvent(new InputEvent('input', { bubbles: true }))
    ;([...host.querySelectorAll('button')].find((button) => button.textContent === 'Snooze until date') as HTMLButtonElement).click()
    await settle()
    expect(mocks.decideFinding).toHaveBeenCalledWith('candidate-1', expect.objectContaining({ action: 'snooze', until: new Date('2030-01-02T23:59:59').getTime() }))
  })
})
