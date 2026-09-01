/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { hasFfi } from './ffi'
import { renderFixture } from './harness'

// The shell has to stay on the project the reader chose, whatever the path says next.
//
// Two rules meet here and they used to disagree. The shell keeps the path on a project this workspace
// has, and it reads the project out of the routed parameters; the router only has parameters for a
// path some registered pattern matched. A plugin surface registers its pattern with the project
// surface registry rather than as a source route, and this host read only the source table — so a
// row in a Linear or Rollbar list navigated somewhere nothing matched, the shell read that as "no
// project is routed", and it navigated to the workspace's first project. Every row you moved to threw
// you back to a repository you were not looking at, which empties whatever list you were in
// (./kit/router.ts, ./chrome/routing.ts § routedProjectId).
describe('browsing while the path says something the router does not know', () => {
  it.skipIf(!hasFfi)('stays on the chosen project rather than bouncing to the first', async () => {
    const screen = await renderFixture({ width: 120, height: 32 })
    await screen.until('Reviews', 30)

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

    // Still project-2. Before, the shell answered `null` here and navigated to `project-1`.
    expect(routedProjectId()).toBe('project-2')
  }, 120_000)
})
