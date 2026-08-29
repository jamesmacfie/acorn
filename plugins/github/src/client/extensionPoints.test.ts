import { describe, expect, it } from 'vitest'
import { DIFF_LINE_KEY, DIFF_LINE_POINT, SUMMARY_BADGES_MAX, SUMMARY_BADGES_POINT } from './extensionPoints'

// The two points this plugin opens (docs/plugins.md § Cooperative extension points). Both are held
// here rather than where they are drawn, because an unmatched contribution is silent by design: a
// point whose name or key drifted produces an empty surface and no error.
//
// The field list is written out rather than compared against `DIFF_ANNOTATION_FIELDS`: that constant
// lives beside the viewer in client-core, and importing across the plugin boundary to check a
// three-string list would be the coupling this seam exists to avoid. The pairing is held from the
// other end too, in client-core's annotationKey.test.ts.
describe('the diff-line annotation point', () => {
  it('is keyed by the three fields the viewer mints, in the viewer\'s order', () => {
    expect(DIFF_LINE_KEY).toEqual(['file', 'line', 'side'])
  })

  it('is addressed under this plugin\'s own name, which the host mints', () => {
    expect(DIFF_LINE_POINT).toBe('github:diff-line')
  })
})

describe('the summary-badges slot', () => {
  it('is addressed under this plugin\'s own name', () => {
    expect(SUMMARY_BADGES_POINT).toBe('github:summary-badges')
  })

  // The ceiling is the owner's, because it is the owner's screen: past it the host draws a count
  // rather than a fourth and fifth card.
  it('holds a few contributors, not an unbounded strip', () => {
    expect(SUMMARY_BADGES_MAX).toBeGreaterThan(0)
    expect(SUMMARY_BADGES_MAX).toBeLessThanOrEqual(6)
  })
})
