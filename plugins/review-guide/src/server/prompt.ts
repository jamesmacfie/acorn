import type { DiffItem } from '../shared/guide'

/** What the harness answers, as GUIDE_SCHEMA describes it. */
export type GuideAnswer = {
  summary: string
  sections: { title: string; why: string; kind: 'core' | 'supporting'; hunks: string[] }[]
}

// The agents plugin checks the answer against this before it hands it back, so `structuredOutput` on
// an `ok` result already has this shape.
export const GUIDE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'sections'],
  properties: {
    summary: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why', 'kind', 'hunks'],
        properties: {
          title: { type: 'string' },
          why: { type: 'string' },
          kind: { type: 'string', enum: ['core', 'supporting'] },
          hunks: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

// Past this much hunk text, the harness gets each hunk's header line only and reads the files itself.
// The agents plugin refuses more than 512 KiB of context in one turn, and the list needs room too.
const FULL_TEXT_BYTES = 256 * 1024

const heading = (item: DiffItem) => `### ${item.id}${item.oldPath ? ` (renamed from ${item.oldPath})` : ''}`

/** The prompt and context for one guide turn over `items`, the diff from `baseSha` to HEAD. */
export function guideTurn(change: { baseRef: string; baseSha: string; items: DiffItem[] }): {
  prompt: string
  context: { label: string; source: string; content: string }[]
} {
  const textBytes = change.items.reduce((total, item) => total + Buffer.byteLength(item.patch, 'utf8'), 0)
  const whole = textBytes <= FULL_TEXT_BYTES
  const body = (item: DiffItem) => item.note || (whole ? item.patch : item.patch.split('\n', 1)[0])
  const prompt = [
    `Write a review guide for the change in this worktree: the diff from ${change.baseSha}, where it leaves ${change.baseRef}, to HEAD.`,
    'The context lists every hunk of the change. Each one starts with a heading that gives its ID, which is its path and its position in the file.',
    ...(whole
      ? []
      : [
          'The change is too large to send whole, so each hunk shows only its header line. Read the files in this worktree to see the lines.',
        ]),
    'Group the hunks into sections in the order a reviewer should read them. Put the core changes first. Put supporting changes, such as tests, docs, configuration, and wiring, after them.',
    'For each section, give a short title; a "why" of one to three sentences in Markdown that says why the change exists rather than what its lines say; a kind, core or supporting; and the IDs of the hunks it covers, in reading order.',
    'Use every ID exactly once, and only IDs from the list. Start with a summary of the whole change in two or three sentences.',
    "This is a read-only review. Don't change any files.",
  ].join('\n\n')
  return {
    prompt,
    context: [
      {
        label: `Hunks (${change.items.length})`,
        source: 'review-guide',
        content: change.items.map((item) => `${heading(item)}\n${body(item)}`).join('\n\n'),
      },
    ],
  }
}
