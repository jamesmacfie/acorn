import { describe, expect, it } from 'vitest'
import type { FindingObservation } from '../contract/records'
import { evidenceLabel, findingBody, findingExcerpt, findingOriginLabel } from './findingPresentation'

const observation = (body: string, kind = 'findings:review-input'): FindingObservation => ({
  id: 'finding-1',
  scope: { kind: 'task', taskId: 'task-1' },
  scopeLabels: { task: 'Readable findings' },
  origin: { kind: 'agent', sessionId: 'session-1', turnId: 'turn-1', attempt: 2 },
  kind: { id: kind, version: 1, label: 'Review input', available: true },
  title: 'Managed agent turn completed',
  body,
  claimStatus: 'observed',
  sourceKey: 'source-1',
  evidence: [],
  createdAt: 1,
  withdrawal: null,
})

describe('finding presentation', () => {
  it('repairs legacy streamed captures without flattening the user message', () => {
    const body = [
      'The', ' answer', ' was streamed', ' in', ' tiny', ' pieces.', ' It', ' should', ' read', ' as', ' one', ' sentence.',
    ].join('\n\n') + '\n\nUser message:\nKeep\n\nthese paragraphs.'

    expect(findingBody(observation(body))).toEqual({
      markdown: 'The answer was streamed in tiny pieces. It should read as one sentence.\n\n---\n\n**User message**\n\nKeep\n\nthese paragraphs.',
      repaired: true,
    })
    expect(findingExcerpt(observation(body))).toBe('The answer was streamed in tiny pieces. It should read as one sentence.')
  })

  it('rejoins contractions split across old stream chunks', () => {
    const body = ['I', "'ll explain", 'the issue', 'in a', 'single readable', 'sentence with', 'enough fragments', 'to trigger', 'the legacy', 'capture repair', 'without showing', 'the source message.'].join('\n\n')
    expect(findingBody(observation(body)).markdown).toContain("I'll explain")
  })

  it('preserves ordinary Markdown and produces a bounded plain-text excerpt', () => {
    const body = 'A useful **finding** with `code`.\n\n- One\n- Two'
    expect(findingBody(observation(body))).toEqual({ markdown: body, repaired: false })
    expect(findingExcerpt(observation(body), 24)).toBe('A useful finding with c…')
  })

  it('names provenance without exposing opaque identifiers as the primary label', () => {
    expect(findingOriginLabel(observation('body').origin)).toBe('Agent run · attempt 2')
    expect(evidenceLabel({ kind: 'managed-turn', sessionId: 'session-1', turnId: 'turn-1' })).toBe('Agent turn')
    expect(evidenceLabel({ kind: 'repository', path: 'src/example.ts' })).toBe('src/example.ts')
  })
})
