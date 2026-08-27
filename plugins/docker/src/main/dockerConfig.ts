// Per-repo matcher overrides: the `[docker]` table of `.acorn/config.toml`, layered
// worktree-over-home like runConfig.ts. Label keys and project names, no commands, and it is read
// without the repo-config trust gate that `[scripts.*]` goes through.
//
// "It holds no commands" is not on its own what makes that safe, because what this table decides is
// which containers a task is matched to, and `docker:exec:open` opens a shell in a container. Two
// invariants are what keep the ungated read from reaching that shell, and both are load-bearing:
//
//   - Exec is ref-addressed, never matcher-addressed. The WS frame names the container it wants and
//     `isDockerRef` validates it (plugins/docker/src/shared/model.ts). Widening the matcher adds rows
//     to a list; it does not choose what a caller execs into.
//   - The hub refuses every non-`term:` channel to a task-confined socket (main/wsHub.ts), so an agent
//     cannot open a docker channel at all.
//
// If either one changes — an exec that resolves through the matcher, or a docker channel opened to a
// task-confined socket — this table becomes an execution input and needs the trust gate.
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
