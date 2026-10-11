/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { renderFixture } from './harness'

// The shell has to stay on the project the reader chose, whatever the path says next.
//
// Two rules meet here. The shell keeps the path on a project this workspace has, and it reads the
// project out of the routed parameters; the router only has parameters for a path some registered
// pattern matched. A plugin's row can navigate to a path nothing here matches, and reading that as "no
// project is routed" would throw the reader back to the workspace's first project on every row they
// move to (./kit/router.ts, ./chrome/routing.ts § routedProjectId).
describe('browsing while the path says something the router does not know', () => {
  it('stays on the chosen project rather than bouncing to the first', async () => {
    const screen = await renderFixture({ width: 120, height: 32 })
    await screen.until('Pull requests', 30)

    const { useNavigate } = await import('./kit/router')
    const { routedProjectId } = await import('./chrome/routing')

    // The reader is on the second project, then a surface navigates to a path with an item in it that
    // no registered pattern covers. Both are ordinary: the first is the project picker, and the second
    // is any descriptor plugin's row.
    useNavigate()('/p/project-2')
    await screen.frame()
    expect(routedProjectId()).toBe('project-2')

    useNavigate()('/p/project-2/x/some-plugin/board/ENG-42')
    await screen.frame()
    screen.done()

    // Still project-2, rather than `null` and a navigation to `project-1`.
    expect(routedProjectId()).toBe('project-2')
  }, 120_000)
})
