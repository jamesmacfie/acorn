import { describe, expect, it } from 'vitest'
import { changeRequestPointIds, changeRequestPoints, DIFF_LINE_KEY, SUMMARY_BADGES_MAX } from './points'

// The two points every code host opens. Held here rather than where they are drawn, because an
// unmatched contribution is silent by design: a point whose name or key drifted produces an empty
// surface and no error.
//
// The field list is written out rather than compared against `DIFF_ANNOTATION_FIELDS`: that constant
// lives beside the viewer in client-core, and the pairing is held from the other end too, in
// client-core's `annotationKey` tests.
describe('the diff-line annotation point', () => {
  it("is keyed by the three fields the viewer mints, in the viewer's order", () => {
    expect(DIFF_LINE_KEY).toEqual(['file', 'line', 'side'])
    expect(changeRequestPoints('Pull request')[0]).toMatchObject({
      id: 'diff-line',
      kind: 'annotation',
      key: ['file', 'line', 'side'],
    })
  })

  it("is addressed under each host's own name", () => {
    expect(changeRequestPointIds('github').diffLine).toBe('github:diff-line')
    expect(changeRequestPointIds('gitlab').diffLine).toBe('gitlab:diff-line')
  })
})

describe('the summary-badges slot', () => {
  it("is addressed under each host's own name", () => {
    expect(changeRequestPointIds('github').summaryBadges).toBe('github:summary-badges')
    expect(changeRequestPoints('Merge request')[1]).toMatchObject({ id: 'summary-badges', mode: 'stack' })
  })

  // The ceiling is the owner's, because it is the owner's screen: past it the host draws a count
  // rather than a fourth and fifth card.
  it('holds a few contributors, not an unbounded strip', () => {
    expect(SUMMARY_BADGES_MAX).toBeGreaterThan(0)
    expect(SUMMARY_BADGES_MAX).toBeLessThanOrEqual(6)
  })
})
