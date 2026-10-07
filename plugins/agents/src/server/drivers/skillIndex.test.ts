import { describe, expect, it } from 'vitest'
import { skillIndex } from './skillIndex'

const skill = (name: string, description = 'Check a diff before review.') =>
  ({ name, description, dir: `/data/plugins/acme/skills/${name}`, file: `/data/plugins/acme/skills/${name}/SKILL.md` })

describe('the skills index', () => {
  it('lists names, one-line descriptions and body paths under the host sentence, with no bodies', () => {
    const index = skillIndex([skill('acme:review', 'Check a diff.\n  Use when asked to review.')])
    expect(index.text).toBe([
      'These are procedures you can load. Read the file when a task matches the description.',
      '',
      '- acme:review: Check a diff. Use when asked to review. (/data/plugins/acme/skills/acme:review/SKILL.md)',
    ].join('\n'))
    expect(index).toMatchObject({ folders: ['/data/plugins/acme/skills/acme:review'], delivered: ['acme:review'], omitted: [] })
  })

  it('leaves whole skills out past the bound, says so, and grants only what it listed', () => {
    // `b` doesn't fit after `a`; the shorter `c` still does.
    const index = skillIndex([skill('a', 'x'.repeat(300)), skill('b', 'y'.repeat(300)), skill('c')], 900)
    expect(index.delivered).toEqual(['a', 'c'])
    expect(index.omitted).toEqual(['b'])
    expect(index.folders).toEqual(['/data/plugins/acme/skills/a', '/data/plugins/acme/skills/c'])
    expect(index.text?.endsWith('\n1 more did not fit in this list.')).toBe(true)
    expect(index.text).not.toContain('yyy')
  })

  it('is empty with nothing to deliver', () => {
    expect(skillIndex([])).toEqual({ text: null, folders: [], delivered: [], omitted: [] })
  })
})
