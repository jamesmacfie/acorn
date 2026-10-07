import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareSkillStart, skillIndex, skillReportLine } from './skillIndex'

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

describe('a start with native skills', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'acorn-skill-start-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  // Two plugins that both call their skill `review`, one with a supporting file.
  const packaged = async () => {
    const make = async (pluginId: string, files: Record<string, string>) => {
      const dir = join(root, 'packages', pluginId, 'review')
      await mkdir(dir, { recursive: true })
      for (const [file, text] of Object.entries(files)) await writeFile(join(dir, file), text)
      return { name: `${pluginId}:review`, description: `${pluginId} review.`, dir, file: join(dir, 'SKILL.md') }
    }
    return [
      await make('acme', { 'SKILL.md': '---\nname: house-review\ndescription: acme review.\n---\nRead format.md.\n', 'format.md': 'The format.\n' }),
      await make('beta', { 'SKILL.md': '---\nname: |\n  review\ndescription: beta review.\n---\nname: not frontmatter\n' }),
    ]
  }

  it('copies each skill with its files into a plugin folder per contributor, under names that cannot collide', async () => {
    const folder = join(root, 'agent-skills', 's1', '1')
    const start = await prepareSkillStart(await packaged(), { folder, lastTold: [] })
    expect(start.plugins).toEqual([join(folder, 'acme'), join(folder, 'beta')])
    expect(JSON.parse(await readFile(join(folder, 'acme', '.claude-plugin', 'plugin.json'), 'utf8'))).toEqual({ name: 'acorn-acme' })
    expect(await readFile(join(folder, 'acme', 'skills', 'review', 'format.md'), 'utf8')).toBe('The format.\n')
    expect(await readFile(join(folder, 'acme', 'skills', 'review', 'SKILL.md'), 'utf8'))
      .toBe('---\nname: review\ndescription: acme review.\n---\nRead format.md.\n')
    // The frontmatter name becomes the id, a block value is replaced whole, and the body is left alone.
    expect(await readFile(join(folder, 'beta', 'skills', 'review', 'SKILL.md'), 'utf8'))
      .toBe('---\nname: review\ndescription: beta review.\n---\nname: not frontmatter\n')
    expect(start.folders).toEqual([join(folder, 'acme', 'skills', 'review'), join(folder, 'beta', 'skills', 'review')])
    await start.retire()
    await expect(stat(folder)).rejects.toThrow()
  })

  it('indexes a skill until the harness lists it under its native name', async () => {
    const folder = join(root, 'agent-skills', 's1', '1')
    const start = await prepareSkillStart(await packaged(), { folder, lastTold: [] })
    const before = start.firstTurn(new Set())!
    expect(before.part?.content).toContain(join(folder, 'acme', 'skills', 'review', 'SKILL.md'))
    expect(before.report).toMatchObject({ native: [], delivered: ['acme:review', 'beta:review'], removed: [] })
    const after = start.firstTurn(new Set(['acorn-acme:review', 'acorn-beta:review', 'someone-elses:skill']))!
    expect(after.part).toBeNull()
    expect(after.report).toMatchObject({ native: ['acme:review', 'beta:review'], delivered: [], told: ['acorn-acme:review', 'acorn-beta:review'] })
    expect(skillReportLine(after.report)).toBe('Skills the agent can load: acorn-acme:review (native), acorn-beta:review (native).')
  })

  it('names what the agent was told before and is gone now', async () => {
    const [acme] = await packaged()
    const start = await prepareSkillStart([acme!], { folder: join(root, 'agent-skills', 's1', '2'), lastTold: ['acorn-acme:review', 'acorn-beta:review'] })
    const turn = start.firstTurn(new Set(['acorn-acme:review']))!
    expect(turn.part?.content).toBe("These procedures were removed and can't be loaded now, even if an earlier list in this conversation names them: acorn-beta:review.")
    expect(turn.report.removed).toEqual(['acorn-beta:review'])
    // Nothing left, nothing told before: nothing to say.
    expect((await prepareSkillStart([], { folder: null, lastTold: 'a phase 06 digest' })).firstTurn(new Set())).toBeNull()
  })

  it('puts every skill in the index, at its installed path, when the folder cannot be written', async () => {
    const skills = await packaged()
    const blocked = join(root, 'a-file')
    await writeFile(blocked, '')
    const start = await prepareSkillStart(skills, { folder: join(blocked, 'generation'), lastTold: [] })
    expect(start.plugins).toEqual([])
    const turn = start.firstTurn(new Set(['acorn-acme:review']))!
    expect(turn.part?.content).toContain(skills[0]!.file)
    expect(turn.report.delivered).toEqual(['acme:review', 'beta:review'])
    expect(skillReportLine(turn.report)).toMatch(/^Couldn't prepare the harness's own skill folder \(.+\), so every skill went in acorn's list\. Skills the agent can load: acme:review, beta:review\.$/)
  })
})
