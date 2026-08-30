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
const model = (title: string): PrModel => ({
  scope: { taskId: 't1', owner: 'runn-fast', repo: 'acorn', number: 7 },
  readOnly: true,
  pull: () => ({ title, state: 'open', draft: false, updatedAt: null }),
  fileSummary: () => ({ count: 0, additions: 0, deletions: 0 }),
  reviewers: () => [],
  labels: () => [],
  checks: () => [],
  linearRefs: () => [],
  conflicting: () => false,
  actionError: () => '',
  mergeMethod: () => 'squash',
  refPrefixes: () => new Map([['CRA', 'linear']]),
  showLinearIssue: (id: string) => opened.push(id),
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

const draw = (title: string) => {
  disposers.push(render(
    () => <PrOverview model={model(title)} onOpenFile={() => {}} onLinkClick={() => {}} />,
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
