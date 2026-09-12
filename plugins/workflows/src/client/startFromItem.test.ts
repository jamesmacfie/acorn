import { describe, expect, it } from 'vitest'
import { prefillFromItem } from './startFromItem'

// The prefill rule (docs/workflows.md § Starting a run). It is the whole reason "Start workflow…" is
// one click rather than a form: a Rollbar error, a Linear issue and a GitHub pull request all arrive
// as a title, a body and a link, and the rule maps those onto the names a definition declares.

describe('what an item fills in', () => {
  it('joins the title and the body with a blank line, under all three item names', () => {
    const filled = prefillFromItem({ title: 'TypeError in pullsBatch', body: 'It started on Tuesday.' })
    expect(filled.issue).toBe('TypeError in pullsBatch\n\nIt started on Tuesday.')
    expect(filled.item).toBe(filled.issue)
    expect(filled.context).toBe(filled.issue)
  })

  it('uses the title alone when the row carries no body', () => {
    // Every row has a title; a body is what a tracker's list route happens to send. GitHub's does not
    // unless the pull's detail is already warmed.
    expect(prefillFromItem({ title: 'ENG-42 Ship it' }).issue).toBe('ENG-42 Ship it')
  })

  it('fills a link input from the item link, under both spellings', () => {
    const filled = prefillFromItem({ title: 'ENG-42', link: 'https://linear.app/x/issue/ENG-42' })
    expect(filled.link).toBe('https://linear.app/x/issue/ENG-42')
    expect(filled.url).toBe(filled.link)
  })

  it('offers nothing for a name outside the rule', () => {
    // The point of the phase's decision: guessing at `focus` from an error title puts words in a
    // prompt nobody chose.
    expect(Object.keys(prefillFromItem({ title: 'a', body: 'b', link: 'c' })).sort())
      .toEqual(['context', 'issue', 'item', 'link', 'url'])
  })

  it('says nothing at all about an item with nothing on it', () => {
    expect(prefillFromItem({})).toEqual({})
    expect(prefillFromItem({ title: '   ' })).toEqual({})
  })
})
