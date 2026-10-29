import type { DiffItem, Guide } from '../shared/guide'
import type { GuideAnswer } from './prompt'

/**
 * Hold the harness's answer to the diff, so the guide shows every item exactly once. This is checked
 * here rather than asked for in the prompt, because a reviewer who trusts a guide doesn't look for what
 * it left out. An item in two sections stays in the first, an unknown ID is dropped, and an item in no
 * section goes to `uncovered` in file order. A section left with no items is dropped.
 */
export function checkCoverage(answer: GuideAnswer, items: DiffItem[]): Guide {
  const byId = new Map(items.map((item) => [item.id, item]))
  const placed = new Set<string>()
  let repeated = 0
  let unknown = 0
  const sections = answer.sections.flatMap(({ title, why, kind, hunks }) => {
    const sectionItems = hunks.flatMap((id) => {
      const item = byId.get(id)
      if (!item) unknown++
      else if (placed.has(id)) repeated++
      else {
        placed.add(id)
        return [item]
      }
      return []
    })
    return sectionItems.length ? [{ title, why, kind, items: sectionItems }] : []
  })
  return {
    summary: answer.summary,
    sections,
    uncovered: items.filter((item) => !placed.has(item.id)),
    repeated,
    unknown,
  }
}
