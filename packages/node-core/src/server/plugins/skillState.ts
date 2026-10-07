import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writePrivateAtomic } from '../storage/dataRoot'

// What the owner decided about loaded plugins' skills (docs/managed-agents/skills.md § Skills). Two
// separate answers about each skill, keyed by its runtime name `<pluginId>:<id>`:
//
// - `approved` is the folder digest the owner accepted in the trust prompt. A package whose skill bytes
//   change asks again, because the digest no longer matches.
// - `disabled` is the switch on the plugin's settings page. It survives updates; uninstalling forgets both.
//
// Read fresh on every call, as input grants are (./inputGrants.ts), so a write from a route shows at the
// next session start without anything holding a copy.

export type SkillState = {
  approved: Readonly<Record<string, string>>
  disabled: readonly string[]
}

export type SkillStateStore = {
  get(): SkillState
  approve(digests: Readonly<Record<string, string>>): void
  setDisabled(name: string, disabled: boolean): void
  /** Forget a plugin's skills, on uninstall. */
  forget(pluginId: string): void
}

const FILE_NAME = 'skill-state.json'
const EMPTY: SkillState = { approved: {}, disabled: [] }

// Anything unparseable reads as nothing approved and nothing switched off. That fails closed: no skill
// is delivered until the owner approves it again.
const parse = (raw: string): SkillState => {
  try {
    const value = JSON.parse(raw) as { approved?: unknown; disabled?: unknown }
    const approved = value.approved && typeof value.approved === 'object' && !Array.isArray(value.approved)
      ? Object.fromEntries(Object.entries(value.approved).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {}
    const disabled = Array.isArray(value.disabled) ? value.disabled.filter((name): name is string => typeof name === 'string') : []
    return { approved, disabled }
  } catch {
    return EMPTY
  }
}

export function skillStateStore(dataDir: string): SkillStateStore {
  const file = join(dataDir, FILE_NAME)
  const read = (): SkillState => {
    try {
      const state = parse(readFileSync(file, 'utf8'))
      chmodSync(file, 0o600)
      return state
    } catch {
      return EMPTY
    }
  }
  const write = (state: SkillState) => {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    writePrivateAtomic(file, `${JSON.stringify({ approved: state.approved, disabled: [...new Set(state.disabled)].sort() })}\n`)
  }
  return {
    get: read,
    approve(digests) {
      const state = read()
      write({ ...state, approved: { ...state.approved, ...digests } })
    },
    setDisabled(name, disabled) {
      const state = read()
      write({ ...state, disabled: disabled ? [...state.disabled, name] : state.disabled.filter((entry) => entry !== name) })
    },
    forget(pluginId) {
      const state = read()
      const own = (name: string) => name.startsWith(`${pluginId}:`)
      write({
        approved: Object.fromEntries(Object.entries(state.approved).filter(([name]) => !own(name))),
        disabled: state.disabled.filter((name) => !own(name)),
      })
    },
  }
}
