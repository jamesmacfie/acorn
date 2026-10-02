import { render } from 'solid-js/web'
import { createStore } from 'solid-js/store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PullDetail from './PullDetail'
import { _resetPrModels } from './pullDetail/prModel'

// The browse detail follows the routed pull all the way into its diff column. `Sections` renders the
// diff once and `DiffForPull` reads its route once, so without a keyed mount the column kept the
// first pull's diff while the navigator moved on.

const route = vi.hoisted(() => ({ params: undefined as unknown as { projectId: string; number: string } }))
vi.mock('@solidjs/router', () => ({
  useParams: () => route.params,
  useNavigate: () => () => {},
  useSearchParams: () => [{}, () => {}],
}))

vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { queryKey: readonly unknown[] }) => ({
    get data() {
      const key = options().queryKey
      if (key[0] === 'projects') return [{ id: 'p1', name: 'acorn', github: { owner: 'runn-fast', name: 'acorn' } }]
      if (key[0] === 'pull') {
        return {
          pull: { number: Number(key[3]), title: `Pull ${String(key[3])}`, state: 'open', draft: false, body: null, headSha: null },
          labels: [], reviews: [], requestedReviewers: [], comments: [], commits: [], checks: [], threads: [],
        }
      }
      return undefined
    },
    isLoading: false,
    isError: false,
  }),
  createMutation: () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: async () => {}, setQueryData: () => {} }),
}))

vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  onPluginFrame: () => () => {},
}))

// The real diff needs the whole viewer. This stand-in reads its route once, as the real one does.
vi.mock('./DiffForPull', () => ({
  DiffForPull: (props: { route: { number: string } }) => {
    const element = document.createElement('p')
    element.dataset.diff = props.route.number
    return element
  },
}))

afterEach(() => {
  document.body.replaceChildren()
  _resetPrModels()
})

describe('the browse pull detail', () => {
  it('shows the diff of the pull that is selected now', () => {
    const [params, setParams] = createStore({ projectId: 'p1', number: '42' })
    route.params = params
    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(() => <PullDetail />, host)

    expect(host.querySelector<HTMLElement>('[data-diff]')?.dataset.diff).toBe('42')
    setParams('number', '44')
    expect(host.querySelector<HTMLElement>('[data-diff]')?.dataset.diff).toBe('44')
    setParams('number', '45')
    expect(host.querySelectorAll('[data-diff]')).toHaveLength(1)
    expect(host.querySelector<HTMLElement>('[data-diff]')?.dataset.diff).toBe('45')
    dispose()
  })
})
