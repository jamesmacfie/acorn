// Per-repo matcher overrides: the `[docker]` table of `.acorn/config.toml`, layered
// worktree-over-home like runConfig.ts. Non-executable configuration only (label keys, project
// names) — so unlike [scripts.*] it needs no repo-config trust gate. Commands like "runn up"
// deliberately stay in [scripts.run.*] run targets, which are gated and already have a UI.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'

export type DockerMatchOverrides = {
  composeProject: string | null // always link this compose project's containers to the task
  matchLabels: string[] // label keys whose value must equal the task's branch slug
  matchName: boolean // enable the name-contains-slug fallback (default true)
}

export const defaultOverrides: DockerMatchOverrides = { composeProject: null, matchLabels: [], matchName: true }

// Pure parse of one config text → the overrides it declares (absent keys stay undefined).
export function parseDockerConfig(text: string): Partial<DockerMatchOverrides> {
  let root: Record<string, unknown>
  try {
    root = parseToml(text) as Record<string, unknown>
  } catch {
    return {}
  }
  const table = root.docker
  if (!table || typeof table !== 'object' || Array.isArray(table)) return {}
  const t = table as Record<string, unknown>
  const out: Partial<DockerMatchOverrides> = {}
  if (typeof t.compose_project === 'string' && t.compose_project) out.composeProject = t.compose_project
  if (Array.isArray(t.match_labels)) out.matchLabels = t.match_labels.filter((v): v is string => typeof v === 'string')
  if (typeof t.match_name === 'boolean') out.matchName = t.match_name
  return out
}

const CACHE_TTL_MS = 30_000
const cache = new Map<string, { at: number; value: Partial<DockerMatchOverrides> }>()

async function readOverrides(path: string): Promise<Partial<DockerMatchOverrides>> {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  let value: Partial<DockerMatchOverrides> = {}
  try {
    value = parseDockerConfig(await readFile(path, 'utf8'))
  } catch {
    // missing file → no overrides
  }
  cache.set(path, { at: Date.now(), value })
  return value
}

// Layered resolution: defaults ← ~/.acorn/config.toml ← <worktree>/.acorn/config.toml.
export async function loadDockerOverrides(worktreePath: string | null): Promise<DockerMatchOverrides> {
  const home = await readOverrides(join(homedir(), '.acorn', 'config.toml'))
  const repo = worktreePath ? await readOverrides(join(worktreePath, '.acorn', 'config.toml')) : {}
  return { ...defaultOverrides, ...home, ...repo }
}
