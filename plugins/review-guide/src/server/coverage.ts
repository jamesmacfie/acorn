import type { DiffItem, Guide } from '../shared/guide'
import type { GuideAnswer } from './prompt'

/**
 * Hold the harness's answer to the diff, so the guide shows every item exactly once. This is checked
 * here rather than asked for in the prompt, because a reviewer who trusts a guide doesn't look for what
 * it left out. An item in two steps stays in the first, an unknown ID is dropped, and an item in no
 * step goes to `uncovered` in file order. A step left with no items is dropped with its notes, and the
 * notes that survive are still unchecked: `checkNotes` holds them to their lines.
 */
export function checkCoverage(answer: GuideAnswer, items: DiffItem[]): Guide {
  const byId = new Map(items.map((item) => [item.id, item]))
  const placed = new Set<string>()
  let repeated = 0
  let unknown = 0
  let misplacedNotes = 0
  const steps = answer.steps.flatMap(({ hunks, ...step }) => {
    const stepItems = hunks.flatMap((id) => {
      const item = byId.get(id)
      if (!item) unknown++
      else if (placed.has(id)) repeated++
      else {
        placed.add(id)
        return [item]
      }
      return []
    })
    if (stepItems.length) return [{ ...step, items: stepItems }]
    misplacedNotes += step.notes.length
    return []
  })
  return {
    summary: answer.summary,
    steps,
    uncovered: items.filter((item) => !placed.has(item.id)),
    repeated,
    unknown,
    misplacedNotes,
  }
}
