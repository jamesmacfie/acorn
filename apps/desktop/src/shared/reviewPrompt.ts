// Review-notes prompt formatter (docs/next 04 §C): plain, copy-pasteable, exactly the doc's shape.
// Pure — unit tested; delivered via sendToAgent as one bracketed-paste block.
import type { ReviewNote } from './api'

const lineRef = (n: Pick<ReviewNote, 'startLine' | 'endLine'>): string =>
  n.endLine > n.startLine ? `${n.startLine}–${n.endLine}` : `${n.startLine}`

export function formatReviewPrompt(notes: ReviewNote[]): string {
  const items = notes.map((n, i) => {
    const snippet = n.snippet
      ? n.snippet
          .split('\n')
          .map((l) => `   > ${l}`)
          .join('\n') + '\n'
      : ''
    return `${i + 1}. ${n.path}:${lineRef(n)}\n${snippet}   ${n.body}`
  })
  return `Please address these review notes on the current changes:\n\n${items.join('\n\n')}`
}
