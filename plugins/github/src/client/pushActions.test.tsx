import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/plugin-api/client'
import { CHANGES_PUSH_ACTIONS_POINT, GithubPushActions } from './pushActions'

// This plugin's one contribution into somebody else's surface: the button that turns a pushed branch
// into a pull request, drawn under the Changes pane's branch bar (docs/plugins.md § Cooperative
// extension points).
//
// Three states worth pinning, and all three are decisions this side makes from facts the owner handed
// over. The owner draws the slot and knows none of them, which is the whole point of the seam, so this
// is the only place they can be checked.

const seams = vi.hoisted(() => ({
  navigate: vi.fn<(to: string) => void>(),
  setSelectedSource: vi.fn<(source: string | null) => void>(),
  tasks: [] as Task[],
}))

vi.mock('@solidjs/router', () => ({ useNavigate: () => seams.navigate }))

// The task query, answered from the array above. The component reads `pullNumber` and the mirrored
// repository off this rather than out of the props, because the changes plugin does not know either
// word.
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: seams.tasks }) }))

// One seam, because it reaches outside this render: selecting the rail source is what makes the create
// form appear at all, and a navigate on its own only moves the address bar.
vi.mock('@acorn/plugin-api/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, setSelectedSource: seams.setSelectedSource }
})

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'fix login',
  icon: null,
  origin: 'local',
  projectId: 'p1',
  branch: 'james/fix-login',
  github: { owner: 'runn-fast', name: 'acorn' },
  worktreePath: '/tmp/wt',
  pullNumber: null,
  status: 'active',
  parentId: null,
  sort: 0,
  links: [],
  ...over,
})

let host: HTMLElement
const disposers: (() => void)[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  seams.tasks = [task()]
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  host.remove()
  seams.navigate.mockClear()
  seams.setSelectedSource.mockClear()
})

/** The five facts the owner hands over, with an upstream and no pull request unless a case says so. */
const draw = (props: Partial<Parameters<typeof GithubPushActions>[0]> = {}) => {
  disposers.push(render(
    () => (
      <GithubPushActions
        taskId="t1"
        projectId="p1"
        branch="james/fix-login"
        upstream="origin/james/fix-login"
        ahead={2}
        {...props}
      />
    ),
    host,
  ))
  return host.querySelector<HTMLButtonElement>('button')
}

describe('Open pull request', () => {
  it('opens the create form with this branch as the head', () => {
    draw()!.click()
    // The rail source first, then the route: the shell draws from the selected source rather than from
    // the location (./commands.ts § github.pull.list).
    expect(seams.setSelectedSource).toHaveBeenCalledWith('github')
    expect(seams.navigate).toHaveBeenCalledWith('/p/p1/pulls/new?head=james%2Ffix-login')
  })

  it('names the repository the pull request will land in', () => {
    expect(draw()!.getAttribute('data-tip-sub')).toBe('runn-fast/acorn')
  })

  it('stays away on a branch that has never been pushed', () => {
    // Nothing to compare against, so the form would have no head to offer. Publish is the next move
    // and it is already the bar's own button.
    expect(draw({ upstream: null, ahead: null })).toBeNull()
  })

  it('stays away once the task has a pull request', () => {
    // From then on the PR pane appears and owns everything about it, this button included.
    seams.tasks = [task({ pullNumber: 42 })]
    expect(draw()).toBeNull()
  })

  it('stays away on a project with no mirrored repository', () => {
    seams.tasks = [task({ github: null })]
    expect(draw()).toBeNull()
  })

  it('stays away on a detached HEAD, and on a task the query has not answered yet', () => {
    expect(draw({ branch: null })).toBeNull()
    seams.tasks = []
    expect(draw()).toBeNull()
  })
})

describe('the point it fills', () => {
  // Spelled by hand on this side, because a plugin may not import another plugin. A drift in either
  // manifest is a contribution nobody delivers, silently, which is what this line exists to catch.
  it('names the changes plugin out loud', () => {
    expect(CHANGES_PUSH_ACTIONS_POINT).toBe('changes:push-actions')
  })
})
