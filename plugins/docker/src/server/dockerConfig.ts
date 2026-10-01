// Per-repo matcher overrides: the `[docker]` table of `.acorn/config.toml`, layered
// worktree-over-home like runConfig.ts. Label keys and project names, no commands, and it is read
// without the repo-config trust gate that `[scripts.*]` goes through.
//
// Hints affect only the device's summary, never task listing / teardown authority. Those use the
// host-stored task root and daemon working-directory metadata. Global HTTP lifecycle requires a
// device; WebSocket streams/exec permit devices and services, never task-confined sockets.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import type { DockerMatcherKeys, DockerProjectMatcher } from '../shared/model'
import { readRepoDockerConfig } from './repoDockerConfig'

// composeProject: suggest this compose project's containers in the device summary. matchLabels: keys
// whose value must equal the task's branch slug. matchName: the name-contains-slug fallback (default true).
export type DockerMatchOverrides = DockerMatcherKeys

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

async function readOverrides(path: string, checkout?: string): Promise<Partial<DockerMatchOverrides>> {
  const key = checkout ? `repo:${checkout}` : `home:${path}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  let value: Partial<DockerMatchOverrides> = {}
  try {
    value = parseDockerConfig(checkout ? await readRepoDockerConfig(checkout) : await readFile(path, 'utf8'))
  } catch {
    // Missing, unsafe, oversized or malformed repository input contributes no hints.
  }
  cache.set(key, { at: Date.now(), value })
  return value
}

// Layered resolution: defaults ← ~/.acorn/config.toml ← <worktree>/.acorn/config.toml. The layers are
// kept apart too, so a project's settings page can say which file set each key.
export async function loadDockerLayers(checkout: string | null): Promise<DockerProjectMatcher> {
  const home = await readOverrides(join(homedir(), '.acorn', 'config.toml'))
  const repo = checkout ? await readOverrides(join(checkout, '.acorn', 'config.toml'), checkout) : {}
  return { repo, home, effective: { ...defaultOverrides, ...home, ...repo } }
}

export async function loadDockerOverrides(worktreePath: string | null): Promise<DockerMatchOverrides> {
  return (await loadDockerLayers(worktreePath)).effective
}
