import { afterEach, describe, expect, it } from 'vitest'
import { _resetRouter, useNavigate } from '../kit/router'
import { routedProjectId } from './routing'

// The shell's reading of the path, which is a different question from what the path parses to.
//
// `routedProjectId` is what every project-scoped surface reads and what the shell's "keep the path on
// a project this workspace has" effect compares against. Answering `null` where the path plainly
// carries a project is how that effect came to navigate away from the project a reader had just
// chosen, on every row they moved to: a plugin surface whose pattern nothing here registered matched
// no route, so `params` was empty, so the shell decided nothing was routed.
describe('the project the shell is on', () => {
  afterEach(() => _resetRouter())

  it('is nothing before anything has been navigated to', () => {
    expect(routedProjectId()).toBeNull()
  })

  it('is the routed parameter where a pattern matched', () => {
    useNavigate()('/p/proj-1')
    expect(routedProjectId()).toBe('proj-1')
  })

  it('is still the path’s own project where no pattern matched at all', () => {
    useNavigate()('/p/proj-1/x/some-plugin/board/ENG-42')
    expect(routedProjectId()).toBe('proj-1')
  })

  it('decodes it, the same way a matched parameter is decoded', () => {
    useNavigate()(`/p/${encodeURIComponent('owner/repo')}/x/some-plugin/board/1`)
    expect(routedProjectId()).toBe('owner/repo')
  })

  it('is nothing for a path that is not about a project', () => {
    useNavigate()('/t/task-9')
    expect(routedProjectId()).toBeNull()
  })
})
