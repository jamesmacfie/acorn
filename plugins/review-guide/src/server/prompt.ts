import type { DiffItem, GuideNote } from '../shared/guide'

/** What the harness answers, as GUIDE_SCHEMA describes it. */
export type GuideAnswer = {
  summary: string
  steps: {
    title: string
    goal: string
    why: string
    kind: 'core' | 'supporting'
    hunks: string[]
    notes: GuideNote[]
  }[]
}

// The agents plugin checks the answer against this before it hands it back, so `structuredOutput` on
// an `ok` result already has this shape. Lengths and counts aren't limits here: an answer that broke
// one would fail whole, so the note check cuts them instead.
export const GUIDE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'steps'],
  properties: {
    summary: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'goal', 'why', 'kind', 'hunks', 'notes'],
        properties: {
          title: { type: 'string' },
          goal: { type: 'string' },
          why: { type: 'string' },
          kind: { type: 'string', enum: ['core', 'supporting'] },
          hunks: { type: 'array', items: { type: 'string' } },
          notes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['hunk', 'side', 'line', 'text', 'tone', 'title', 'body'],
              properties: {
                hunk: { type: 'string' },
                side: { type: 'string', enum: ['old', 'new'] },
                line: { type: 'integer' },
                text: { type: 'string' },
                tone: { type: 'string', enum: ['explain', 'attention', 'risk'] },
                title: { type: 'string' },
                body: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
}

// Past this much hunk text, the harness gets each hunk's header line only and reads the files itself.
// The agents plugin refuses more than 512 KiB of context in one turn, and the list needs room too.
const FULL_TEXT_BYTES = 256 * 1024

// The background a workflow passes in, cut to this many characters so it and the hunks stay under that limit.
const BACKGROUND_CHARS = 32_000

const heading = (item: DiffItem) => `### ${item.id}${item.oldPath ? ` (renamed from ${item.oldPath})` : ''}`

/** The prompt and context for one guide turn over `items`, the diff from `baseSha` to HEAD. `background`
 *  is text a workflow step passes in, such as an earlier step's output. */
export function guideTurn(
  change: { baseRef: string; baseSha: string; items: DiffItem[] },
  background?: string,
): {
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
    ...(background
      ? [
          "The context also has background from the workflow that made this change, such as the plan or an earlier step's report. Use it to understand why the change exists. Where it disagrees with the diff, trust the diff.",
        ]
      : []),
    'Arrange the hunks as steps of a path through the change, in the order a reviewer should read them. Start where the data or the request enters, and let each step build on the one before it. Put the core steps first. Put supporting steps, such as tests, docs, configuration, and wiring, after them.',
    'For each step, give a short title; a goal: the words that finish the sentence "After this step you\'ll know", without those opening words, such as "which answers are retried and which are final.", so the reviewer can check themselves against it; a "why" of one to three sentences in Markdown that says why the change exists rather than what its lines say; a kind, core or supporting; the IDs of the hunks it covers, in reading order; and its notes.',
    "Leave a note only where a careful reviewer would stop: a line whose purpose isn't obvious, a decision worth questioning, or a likely bug. Don't narrate what a line says. Most hunks need no note, and a hunk takes at most three.",
    "A note names one of its own step's hunks; a side, new for an added or unchanged line and old for a deleted one; the line's number on that side; the line's text, quoted exactly and whole, without its +, -, or space marker; a tone, explain for context, attention for a judgment call, or risk for a likely bug; a title of one sentence, at most 120 characters; and a body in Markdown, at most 600 characters. List a step's notes in reading order.",
    'Use every hunk ID exactly once, and only IDs from the list. Start with a summary of the whole change in two or three sentences.',
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
      ...(background
        ? [
            {
              label: 'Background from the workflow',
              source: 'review-guide',
              content: background.slice(0, BACKGROUND_CHARS),
            },
          ]
        : []),
    ],
  }
}
