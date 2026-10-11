import { afterEach, describe, expect, it } from 'vitest'
import type { Project, Task } from '@acorn/plugin-api/client'
import { setProjectsLookup } from '@acorn/plugin-api/testkit/client'
import { gitAvailable } from './paneContribution'

const task = { id: 't1', projectId: 'p1' } as Task
const withProject = (vcs: 'git' | null) => setProjectsLookup(() => [{ id: 'p1', vcs } as Project])

describe('gitAvailable', () => {
  afterEach(() => setProjectsLookup(() => []))

  it('shows the pane for a git project', () => {
    withProject('git')
    expect(gitAvailable(task)).toBe(true)
  })

  it('hides the pane for a project that is not a git repo', () => {
    withProject(null)
    expect(gitAvailable(task)).toBe(false)
  })

  it('shows the pane while the project list has not loaded', () => {
    expect(gitAvailable(task)).toBe(true)
  })
})
