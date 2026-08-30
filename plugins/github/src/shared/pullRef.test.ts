import { describe, expect, it } from 'vitest'
import { formatPullRef, parsePullRef, pullRefMatchesTask } from './pullRef'

// The one spelling of "which pull request", used by four callers that each used to spell it themselves:
// the collection row id, the URL recogniser's `item`, the reference panel parsing it back, and the "is
// there already a task for this?" check.

describe('the pull-request reference', () => {
  it('round-trips', () => {
    expect(formatPullRef('Runn-Fast', 'runn', 8811)).toBe('Runn-Fast/runn#8811')
    expect(parsePullRef('Runn-Fast/runn#8811')).toEqual({ owner: 'Runn-Fast', repo: 'runn', number: '8811' })
  })

  it('refuses anything that is not one', () => {
    // A panel handed a stranger's displayId has to say so rather than render an empty shell.
    expect(parsePullRef('ENG-42')).toBeNull()
    expect(parsePullRef('runn/acorn')).toBeNull()
    expect(parsePullRef('runn/acorn#')).toBeNull()
    expect(parsePullRef('runn/acorn#abc')).toBeNull()
  })
})

describe('matching a reference to a task', () => {
  const github = { owner: 'runn-fast', name: 'runn' }

  it('matches the task that already tracks this pull request', () => {
    expect(pullRefMatchesTask('runn-fast/runn#8811', github, 8811)).toBe(true)
    expect(pullRefMatchesTask('runn-fast/runn#8810', github, 8811)).toBe(false)
    // Same number, different repository, which is why the reference carries the repo.
    expect(pullRefMatchesTask('runn-fast/other#8811', github, 8811)).toBe(false)
  })

  // The casing trap, for the third time in this area and pinned here so it's the last. Core's
  // `projects` stores the owner folded (`runn-fast`), github's mirror and every URL keep GitHub's
  // canonical spelling (`Runn-Fast`), and a task row carries whichever core gave it. An exact match
  // fails silently and looks exactly like "no task for this PR", so the panel would offer to create a
  // duplicate.
  it('folds case on owner and repo, as GitHub does', () => {
    expect(pullRefMatchesTask('Runn-Fast/runn#8811', github, 8811)).toBe(true)
    expect(pullRefMatchesTask('RUNN-FAST/RUNN#8811', github, 8811)).toBe(true)
  })

  it('says no to a reference that is not a pull request at all', () => {
    expect(pullRefMatchesTask('ENG-42', github, 8811)).toBe(false)
  })
})
