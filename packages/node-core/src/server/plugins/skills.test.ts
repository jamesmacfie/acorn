import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pluginManifestSchema } from './manifest'
import { readPackageSkill, SKILL_LIMITS } from './skills'
import { skillStateStore } from './skillState'
import { catalogueSkills, deliverableSkills, recordSkillDelivery, registerSkill, skillDeliveries } from '../pluginHost/skills'

// A package as the loader sees it: a folder with skills under it. Every case reads through
// readPackageSkill, the one function the installer, the loader and each session start share.
const roots: string[] = []
const pkg = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'acorn-skill-'))
  roots.push(root)
  return root
}
const skillFile = (description = 'Check a diff before review. Use when asked to review.', name = 'review-checklist') =>
  `---\nname: ${name}\ndescription: ${description}\nlicense: MIT\nmetadata:\n  name: ignored\n---\n\n# Review\n\nRead [the list](checklist.md).\n`
const write = (root: string, rel: string, text: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), text)
}
const read = (root: string, path = 'skills/review') => readPackageSkill(root, { id: 'review', path })
const reason = (result: ReturnType<typeof read>) => (result.ok ? '' : result.reason)

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('reading a skill out of a package', () => {
  it('reads the standard shape, ignores other keys, and hashes the supporting files too', () => {
    const root = pkg()
    write(root, 'skills/review/SKILL.md', skillFile())
    write(root, 'skills/review/checklist.md', '1. Tests pass.\n')
    const first = read(root)
    expect(first.ok && { name: first.skill.name, description: first.skill.description, file: first.skill.file.endsWith('/SKILL.md') })
      .toEqual({ name: 'review-checklist', description: 'Check a diff before review. Use when asked to review.', file: true })
    write(root, 'skills/review/checklist.md', '1. Tests pass.\n2. Docs updated.\n')
    const second = read(root)
    expect(first.ok && second.ok && first.skill.digest !== second.skill.digest).toBe(true)
  })

  it('reads quoted and block descriptions', () => {
    const root = pkg()
    write(root, 'skills/review/SKILL.md', `---\nname: review\ndescription: >\n  Check a diff.\n  Use when asked.\n---\nBody`)
    expect(read(root).ok && (read(root) as { skill: { description: string } }).skill.description).toBe('Check a diff. Use when asked.')
    write(root, 'skills/review/SKILL.md', `---\nname: "review"\ndescription: 'It''s a check.'\n---\nBody`)
    expect(read(root).ok && (read(root) as { skill: { description: string } }).skill.description).toBe("It's a check.")
  })

  it('refuses a path that leaves the package, through traversal or a symlink', () => {
    const root = pkg()
    const outside = pkg()
    write(outside, 'SKILL.md', skillFile())
    expect(reason(read(root, '../elsewhere'))).toContain('resolves outside the package')
    symlinkSync(outside, join(root, 'linked'))
    expect(reason(read(root, 'linked'))).toMatch(/outside the package|not a folder/)
  })

  it('refuses a symlink inside the skill folder, so every file an agent opens was hashed', () => {
    const root = pkg()
    const outside = pkg()
    write(outside, 'secret.txt', 'token')
    write(root, 'skills/review/SKILL.md', skillFile())
    symlinkSync(join(outside, 'secret.txt'), join(root, 'skills/review/notes.md'))
    expect(reason(read(root))).toContain('contains a symlink (notes.md)')
  })

  it('names what is wrong with malformed frontmatter', () => {
    const root = pkg()
    const cases: Array<[string, string]> = [
      ['# No frontmatter', 'must start with YAML frontmatter'],
      ['---\nname: review\n', 'no closing --- line'],
      ['---\ndescription: x\n---\n', 'has no name'],
      ['---\nname: Review Checklist\ndescription: x\n---\n', 'lower-case letters, digits and dashes'],
      ['---\nname: review\n---\n', 'has no description'],
      ['---\nname: review\ndescription: Use <system>this</system>\n---\n', 'contains an XML tag'],
      ['---\nname: review\ndescription: "a\\u202eb"\n---\n', 'contains a control character'],
    ]
    for (const [text, expected] of cases) {
      write(root, 'skills/review/SKILL.md', text)
      expect(reason(read(root))).toContain(expected)
    }
    expect(reason(read(root, 'skills/missing'))).toContain('is missing')
  })

  it('bounds the description in characters and the body in bytes', () => {
    const root = pkg()
    write(root, 'skills/review/SKILL.md', skillFile('é'.repeat(SKILL_LIMITS.descriptionChars)))
    expect(read(root).ok).toBe(true)
    write(root, 'skills/review/SKILL.md', skillFile('é'.repeat(SKILL_LIMITS.descriptionChars + 1)))
    expect(reason(read(root))).toContain('longer than 1,024 characters')
    write(root, 'skills/review/SKILL.md', `---\nname: review\ndescription: x\n---\n${'a'.repeat(SKILL_LIMITS.bodyBytes + 1)}`)
    expect(reason(read(root))).toContain('body is larger than 64 KiB')
  })

  it('refuses two skills with one id in a manifest', () => {
    const parsed = pluginManifestSchema.safeParse({
      id: 'acme', name: 'Acme', version: '1.0.0', baseline: 'acorn-1', apiVersion: '1',
      contributions: { skills: [{ id: 'review', path: 'a' }, { id: 'review', path: 'b' }] },
    })
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)).toContain("duplicate skill id 'review'")
  })
})

describe('what a starting provider may receive', () => {
  const owned: Array<() => void> = []
  afterEach(() => { for (const undo of owned.splice(0)) undo() })

  it('only approved, switched-on skills whose folder still holds the approved bytes', async () => {
    const root = pkg()
    const data = pkg()
    write(root, 'skills/review/SKILL.md', skillFile())
    const loaded = read(root)
    if (!loaded.ok) throw new Error(loaded.reason)
    owned.push(registerSkill('acme', loaded.skill).dispose)
    const state = skillStateStore(data)
    // Installed, not yet approved.
    expect(await deliverableSkills(data)).toEqual([])
    state.approve({ 'acme:review': loaded.skill.digest })
    expect((await deliverableSkills(data)).map((skill) => skill.name)).toEqual(['acme:review'])
    state.setDisabled('acme:review', true)
    expect(await deliverableSkills(data)).toEqual([])
    state.setDisabled('acme:review', false)
    // Edited under the running plugin: the approval covers the old bytes, so nothing is offered.
    write(root, 'skills/review/SKILL.md', skillFile('Changed after approval.'))
    expect(await deliverableSkills(data)).toEqual([])
  })

  it('reports a delivery only against the copy that was delivered', () => {
    const root = pkg()
    write(root, 'skills/review/SKILL.md', skillFile())
    const first = read(root)
    if (!first.ok) throw new Error(first.reason)
    const dispose = registerSkill('acme', first.skill).dispose
    recordSkillDelivery('Claude Code', { delivered: ['acme:review'], omitted: [] })
    expect(skillDeliveries(catalogueSkills('acme')[0]!).map((entry) => [entry.harness, entry.outcome])).toEqual([['Claude Code', 'delivered']])
    // A reload with changed bytes is a new entry with no claims yet.
    dispose()
    write(root, 'skills/review/SKILL.md', skillFile('Changed.'))
    const second = read(root)
    if (!second.ok) throw new Error(second.reason)
    owned.push(registerSkill('acme', second.skill).dispose)
    expect(skillDeliveries(catalogueSkills('acme')[0]!)).toEqual([])
  })
})
