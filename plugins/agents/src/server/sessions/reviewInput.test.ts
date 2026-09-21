import { describe, expect, it } from 'vitest'
import { assistantReviewSummary } from './reviewInput'

describe('assistant review summary', () => {
  it('folds append-only deltas from one message without inventing paragraph breaks', () => {
    expect(assistantReviewSummary([
      { type: 'assistant_message', text: 'A read', messageId: 'one', append: true },
      { type: 'assistant_message', text: 'able answer.', messageId: 'one', append: true },
    ])).toBe('A readable answer.')
  })

  it('keeps separate assistant messages separated', () => {
    expect(assistantReviewSummary([
      { type: 'assistant_message', text: 'First.', append: true },
      { type: 'tool' },
      { type: 'assistant_message', text: 'Second.', append: true },
    ])).toBe('First.\n\nSecond.')
  })

  it('keeps only the bounded tail and ignores non-assistant events', () => {
    expect(assistantReviewSummary([
      { type: 'user_message', text: 'private prompt' },
      { type: 'assistant_message', text: '123456', messageId: 'one', append: true },
    ], 4)).toBe('3456')
  })
})
