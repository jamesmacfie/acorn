// The Node's skill catalogue: every skill an active loaded plugin declared, read and checked by the
// loader (../plugins/skills.ts), and what each harness last received. See
// docs/managed-agents/skills.md § Skills.
//
// Core owns this list and the owner's answers about it (../plugins/skillState.ts). The agents plugin
// reads it through the two functions at the bottom, at every provider start and resume, and reports
// back what it sent. Nothing here knows how a harness is told.
import type { PackageSkill } from '../plugins/skills'
import { skillStateStore, type SkillState } from '../plugins/skillState'
import type { PluginSkills, PluginSkillStatus } from '@acorn/protocol/api.ts'
import type { Disposable } from './capabilities'

export type CatalogueSkill = PackageSkill & {
  /** `<pluginId>:<id>`, minted by the host. The name the agent and the settings page see. */
  name: string
  /** The frontmatter `name`. */
  title: string
  pluginId: string
}

export type SkillDelivery = {
  /** The harness's label, as the settings page names it. */
  harness: string
  at: number
  /** `omitted` when the index ran out of room before this skill. */
  outcome: 'delivered' | 'omitted'
  /** The harness loaded it with its own skill support rather than from acorn's index. */
  native?: true
}

/** What a plugin hands `ctx.skills`: one skill the loader already read out of its package. */
export type PluginSkillRegistry = {
  register(skill: PackageSkill): void
}

const catalogue = new Map<string, CatalogueSkill>()
// Kept apart from the catalogue entry so a reload's fresh entry starts with no claims about what an
// earlier copy reached. Keyed by digest as well as name for the same reason.
const deliveries = new Map<string, Map<string, SkillDelivery>>()
const deliveryKey = (skill: Pick<CatalogueSkill, 'name' | 'digest'>) => `${skill.name}\0${skill.digest}`

export function registerSkill(pluginId: string, skill: PackageSkill): Disposable {
  const entry: CatalogueSkill = { ...skill, name: `${pluginId}:${skill.id}`, title: skill.name, pluginId }
  catalogue.set(entry.name, entry)
  return {
    dispose: () => {
      if (catalogue.get(entry.name) === entry) catalogue.delete(entry.name)
    },
  }
}

export const catalogueSkills = (pluginId?: string): CatalogueSkill[] =>
  [...catalogue.values()]
    .filter((skill) => !pluginId || skill.pluginId === pluginId)
    .sort((a, b) => a.name.localeCompare(b.name))

/** The roster's account of a running plugin's skills (../pluginHost/state.ts). Undefined when it has none. */
export function pluginSkills(pluginId: string, state: SkillState): PluginSkills | undefined {
  const own = catalogueSkills(pluginId)
  if (!own.length) return undefined
  return {
    granted: Object.keys(state.approved).some((name) => name.startsWith(`${pluginId}:`)),
    skills: own.map((skill) => ({
      name: skill.name,
      title: skill.title,
      description: skill.description,
      digest: skill.digest,
      approved: state.approved[skill.name] === skill.digest,
      enabled: !state.disabled.includes(skill.name),
    })),
  }
}

export const skillDeliveries = (skill: CatalogueSkill): SkillDelivery[] =>
  [...(deliveries.get(deliveryKey(skill))?.values() ?? [])].sort((a, b) => a.harness.localeCompare(b.harness))

/** Re-hashes the folder, so a package edited under a running Node reads as changed. The reader loads
 *  on the first call rather than at boot. */
export async function skillStatus(state: SkillState, skill: CatalogueSkill): Promise<PluginSkillStatus> {
  if (state.disabled.includes(skill.name)) return 'disabled'
  if (state.approved[skill.name] !== skill.digest) return 'unapproved'
  const { skillFolderDigest } = await import('../plugins/skills')
  const folder = skillFolderDigest(skill.dir)
  return folder.ok && folder.digest === skill.digest ? 'ready' : 'changed'
}

// ── The contract agents consumes (@acorn/plugin-api/node) ──────────────────────────────────────────

export type DeliverableSkill = Pick<CatalogueSkill, 'name' | 'description' | 'dir' | 'file'>

/** Every skill a provider starting now may receive: switched on, approved at this digest, and still
 *  holding the approved bytes. Sorted by name, so two starts with the same answers send the same index. */
export async function deliverableSkills(dataDir: string): Promise<DeliverableSkill[]> {
  const state = skillStateStore(dataDir).get()
  const ready: DeliverableSkill[] = []
  for (const skill of catalogueSkills()) {
    if ((await skillStatus(state, skill)) === 'ready')
      ready.push({ name: skill.name, description: skill.description, dir: skill.dir, file: skill.file })
  }
  return ready
}

/** What one provider start actually received. Call it only once the start has succeeded, so a process
 *  that kept running with an older index never reads as refreshed. `native` names the skills the harness
 *  loaded with its own skill support; `delivered` and `omitted` describe the index. */
export function recordSkillDelivery(
  harness: string,
  report: { delivered: readonly string[]; omitted: readonly string[]; native?: readonly string[] },
): void {
  const at = Date.now()
  const note = (names: readonly string[], outcome: SkillDelivery['outcome'], native?: true) => {
    for (const name of names) {
      const skill = catalogue.get(name)
      if (!skill) continue
      const key = deliveryKey(skill)
      const byHarness = deliveries.get(key) ?? new Map<string, SkillDelivery>()
      byHarness.set(harness, { harness, at, outcome, ...(native ? { native } : {}) })
      deliveries.set(key, byHarness)
    }
  }
  note(report.native ?? [], 'delivered', true)
  note(report.delivered, 'delivered')
  note(report.omitted, 'omitted')
}
