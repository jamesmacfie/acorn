// The folder a harness with its own skill support loads acorn's skills from. One per provider start,
// under the Node's data root, never in the worktree.
// See docs/managed-agents/native-skills.md § Native skills.
//
// Each contributing plugin gets a Claude Code plugin folder: `.claude-plugin/plugin.json` named
// `acorn-<pluginId>`, beside `skills/<id>/` holding a copy of the skill's files. Both harnesses put the
// plugin's name in front: Claude Code 2.1.292 adds the folder name and Codex 0.159.2, given `skills/` as
// an extra root, adds the frontmatter `name`. The copy's `name` is rewritten to the id, so both call the
// skill `acorn-<pluginId>:<id>`. Two plugins with the same skill id land in different folders under
// different names.
//
// The copy is written once and never changed, so a package updated under a running process can't
// change what that process reads. The lifecycle removes it when the process is done.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeliverableSkill } from '@acorn/plugin-api/node'

/** What a harness calls a skill it loaded from this folder. The prefix keeps it apart from the
 *  person's own plugins: Claude Code replaces an installed plugin with a session plugin of the same name. */
export const nativeSkillName = (name: string): string => `acorn-${name}`

export type SkillFolder = {
  /** One folder per contributing plugin, for the harness to load. */
  plugins: string[]
  /** The skills, pointing at their copies. */
  skills: DeliverableSkill[]
}

// Frontmatter `name`, with any indented lines of a block value after it.
const FRONTMATTER_NAME = /^name:[^\n]*(?:\n[ \t]+[^\n]*)*/m

export async function writeSkillFolder(root: string, skills: readonly DeliverableSkill[]): Promise<SkillFolder> {
  // Generation numbers restart with the Node, so a Node that died can have left this path behind.
  await removeSkillFolder(root)
  const plugins = new Set<string>()
  const copies: DeliverableSkill[] = []
  for (const skill of skills) {
    const split = skill.name.indexOf(':')
    const pluginId = skill.name.slice(0, split)
    const plugin = join(root, pluginId)
    if (!plugins.has(plugin)) {
      await mkdir(join(plugin, '.claude-plugin'), { recursive: true })
      await writeFile(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: nativeSkillName(pluginId) }))
      plugins.add(plugin)
    }
    const id = skill.name.slice(split + 1)
    const dir = join(plugin, 'skills', id)
    await cp(skill.dir, dir, { recursive: true, errorOnExist: true, force: false })
    const file = join(dir, 'SKILL.md')
    const text = await readFile(file, 'utf8')
    const end = text.indexOf('\n---', 3)
    await writeFile(file, text.slice(0, end).replace(FRONTMATTER_NAME, `name: ${id}`) + text.slice(end))
    copies.push({ ...skill, dir, file })
  }
  return { plugins: [...plugins], skills: copies }
}

export const removeSkillFolder = (root: string): Promise<void> => rm(root, { recursive: true, force: true })

/** Removes every session's folders under `root` except those of a session with a live process. */
export async function sweepSkillFolders(root: string, live: (sessionId: string) => boolean): Promise<void> {
  for (const sessionId of await readdir(root).catch(() => [])) {
    if (!live(sessionId)) await removeSkillFolder(join(root, sessionId))
  }
}
