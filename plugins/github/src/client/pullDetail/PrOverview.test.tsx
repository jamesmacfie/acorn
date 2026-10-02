import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrOverview } from './PrOverview'
import type { PrModel } from './prModel'

// A bare `CRA-404` in a pull title is clickable, and clicking it opens the ticket. The host learns
// the prefix from a Linear URL it already saw in the same pull (contentLinks.ts § Bare tokens), and
// this component renders the result as its own text nodes rather than as provider HTML.
//
// What is worth pinning is that the token is a control a person can reach: it used to be a raw
// anchor with no href, which no keyboard could land on, and it is a `Link` node now.

vi.mock('@solidjs/router', () => ({
  useNavigate: () => () => {},
  useSearchParams: () => [{}, () => {}],
}))

vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  createMutation: () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false }),
  useQueryClient: () => ({
    invalidateQueries: async () => {},
    getQueryData: () => undefined,
    setQueryData: () => {},
    cancelQueries: async () => {},
  }),
}))

const opened: string[] = []

// Read-only, open, no body and no labels, checks or refs, so the only thing rendered below the
// heading is the facts table. Cast because `PrModel` is what `build()` returns: nothing here needs
// the twenty-odd mutations the toolbar would have asked for.
const idle = { isPending: false, mutateAsync: async () => {} }
const model = (title: string, overrides: Record<string, unknown> = {}): PrModel => ({
  scope: { taskId: 't1', owner: 'runn-fast', repo: 'acorn', number: 7 },
  readOnly: true,
  pull: () => ({ title, state: 'open', draft: false, updatedAt: null }),
  fileSummary: () => ({ count: 0, additions: 0, deletions: 0 }),
  reviewers: () => [],
  reviewDecision: () => ({ state: 'none', reviewers: [] }),
  labels: () => [],
  checks: () => [],
  linearRefs: () => [],
  conflicting: () => false,
  actionError: () => '',
  actionNeedsReconnect: () => false,
  mergeMethod: () => 'squash',
  refPrefixes: () => new Map([['CRA', 'linear']]),
  showLinearIssue: (id: string) => opened.push(id),
  merge: idle, autoMergeEnable: idle, autoMergeDisable: idle, close: idle, reopen: idle, draft: idle,
  run: () => {},
  ...overrides,
} as unknown as PrModel)

let host: HTMLElement
const disposers: (() => void)[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  host.remove()
  opened.length = 0
})

const draw = (title: string, overrides?: Record<string, unknown>) => {
  disposers.push(render(
    () => <PrOverview model={model(title, overrides)} onOpenFile={() => {}} onLinkClick={() => {}} />,
    host,
  ))
  return host
}

describe('a ref token in a pull title', () => {
  it('renders as a kit link on the heading\'s own text baseline', () => {
    const heading = draw('Fix CRA-404 in the rail').querySelector('.ui-heading')
    const link = heading?.querySelector('.ui-link')
    expect(link).not.toBeNull()
    expect(link!.textContent).toBe('CRA-404')
    // The rest of the title is still plain text beside it, not swallowed by the link.
    expect(heading!.textContent).toContain('Fix CRA-404 in the rail')
    // No raw anchor: a bare token has no URL, so the node is the platform's own control and the
    // keyboard reaches it.
    expect(heading!.querySelector('a')).toBeNull()
  })

  it('opens the ticket it names when pressed', () => {
    const link = draw('Fix CRA-404 in the rail').querySelector('.ui-link') as HTMLElement
    link.click()
    expect(opened).toEqual(['CRA-404'])
  })

  it('leaves a title with no witnessed prefix alone', () => {
    expect(draw('Fix the rail').querySelector('.ui-link')).toBeNull()
  })
})

describe('the merge box', () => {
  const buttons = (node: HTMLElement) => [...node.querySelectorAll<HTMLButtonElement>('button.ui-btn')]
  const named = (node: HTMLElement, text: string) => buttons(node).find((button) => button.textContent?.trim() === text)

  it('makes Merge the one solid button, with the method beside it and not in its label', () => {
    const node = draw('Fix the rail', { readOnly: false })
    const merge = named(node, 'Merge')!
    expect(merge.dataset.variant).toBe('solid')
    expect(buttons(node).filter((button) => button.dataset.variant === 'solid')).toHaveLength(1)
    expect(node.textContent).toContain('Squash and merge')
    expect(node.textContent).not.toContain('(squash)')
    expect(named(node, 'Convert to draft')?.dataset.variant).toBe('ghost')
    expect(named(node, 'Close')?.dataset.variant).toBe('ghost')
  })

  it('offers Ready for review instead of Merge on a draft', () => {
    const node = draw('Fix the rail', { readOnly: false, pull: () => ({ title: 'Fix the rail', state: 'open', draft: true, updatedAt: null }) })
    expect(named(node, 'Merge')).toBeUndefined()
    expect(named(node, 'Ready for review')?.dataset.variant).toBe('solid')
    expect(node.querySelector('[aria-label="Merge method"]')).toBeNull()
  })

  it('disables Merge while the branch conflicts', () => {
    const node = draw('Fix the rail', { readOnly: false, conflicting: () => true, conflicts: () => undefined, conflictsLoading: () => true })
    expect(named(node, 'Merge')?.disabled).toBe(true)
    expect(node.textContent).toContain('This branch has conflicts')
  })

  it('says a related pull is read-only instead of drawing the box', () => {
    const node = draw('Fix the rail')
    expect(named(node, 'Merge')).toBeUndefined()
    expect(node.textContent).toContain('Related pull request.')
  })
})

describe('the overview facts', () => {
  it('states the review decision and the checks in words', () => {
    const node = draw('Fix the rail', {
      reviewDecision: () => ({ state: 'changes-requested', reviewers: ['grace'] }),
      checks: () => [{ name: 'test', status: 'FAILURE' }, { name: 'lint', status: 'SUCCESS' }],
    })
    const text = node.textContent ?? ''
    expect(text).toContain('Open')
    expect(text).toContain('Changes requested')
    expect(node.querySelector('[data-tip="Changes requested by grace"]')).not.toBeNull()
    expect(text).toContain('1 check failing')
    expect(text).not.toContain('Reviewers')
    expect(text).not.toContain('Files')
  })

  it('says when there are no reviews and no checks', () => {
    const text = draw('Fix the rail').textContent ?? ''
    expect(text).toContain('No reviews')
    expect(text).toContain('No checks')
  })
})

