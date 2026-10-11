import { createSignal, type Accessor } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'

const [project, setProject] = createSignal('revision-project')
const [node, setNode] = createSignal('revision-node')
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: node,
  nodeReady: () => true,
  onScopeEvicted: () => () => {},
}))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { queryKey: [string, string, string | undefined] }) => ({
    get data() {
      const [projectId, id, requestedBase] = options().queryKey
      return {
        nodeId: node(),
        projectId,
        id,
        requestedBase,
        detail: {
          base: requestedBase ?? 'parent-a',
          commit: {
            id,
            message: 'Retained revision',
            parents: ['parent-a', 'parent-b'],
            refs: [],
            author: { name: 'Ada', email: 'ada@example.com', at: 0 },
            committer: { name: 'Ada', email: 'ada@example.com', at: 0 },
          },
          files: [
            { path: 'first.ts', status: 'M', oldMode: '100644', newMode: '100644' },
            { path: 'second.ts', status: 'M', oldMode: '100644', newMode: '100644' },
          ],
        },
      }
    },
  }),
}))
vi.mock('./historyClient', () => ({
  revisionOptions: (projectId: string, id: string, base: string | undefined) => ({ queryKey: [projectId, id, base] }),
}))
vi.mock('./revisionSource', () => ({
  revisionSource: (_target: unknown, _detail: unknown, selectedPath: Accessor<string>) => ({ selectedPath }),
}))
vi.mock('@acorn/plugin-api/ui', async (original) => ({
  ...(await original<typeof import('@acorn/plugin-api/ui')>()),
  DiffPane: (props: { source: { selectedPath: Accessor<string> } }) => (
    <div data-file-target={props.source.selectedPath()}>Diff</div>
  ),
}))

const { RevisionView } = await import('./RevisionView')
let host: HTMLDivElement | undefined
let dispose = () => {}
afterEach(() => {
  dispose()
  host?.remove()
})

it('restores selected files and folds without issuing another file jump, scoped by project and Node', () => {
  host = document.createElement('div')
  document.body.append(host)
  const draw = () =>
    render(() => <RevisionView projectId={project()} id="commit" explain={false} onCommit={() => {}} />, host!)
  dispose = draw()
  const details = () => host!.querySelector<HTMLDetailsElement>('details')!
  details().open = true
  details().dispatchEvent(new Event('toggle'))
  const file = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((row) =>
    row.textContent?.includes('second.ts'),
  )!
  file.click()
  expect(host.querySelector('[data-file-target]')?.getAttribute('data-file-target')).toBe('second.ts')
  dispose()
  dispose = draw()
  expect(details().open).toBe(true)
  expect(
    [...host.querySelectorAll('[aria-selected="true"]')].some((row) => row.textContent?.includes('second.ts')),
  ).toBe(true)
  expect(host.querySelector('[data-file-target]')?.getAttribute('data-file-target')).toBe('')
  setProject('other-revision-project')
  expect(details().open).toBe(false)
  setProject('revision-project')
  expect(details().open).toBe(true)
  setNode('other-revision-node')
  expect(details().open).toBe(false)
  setNode('revision-node')
  expect(details().open).toBe(true)
})
