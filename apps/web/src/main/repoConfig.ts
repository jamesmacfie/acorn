// Layered repo config (docs/next 13 §B): ./.acorn/config.toml (committed, team-shared) →
// ~/.acorn/config.toml (personal defaults) → DB columns (today's storage, the fallback). Returns a
// typed, validated config PLUS structured parse errors — a broken file is surfaced (palette row,
// 13 §B), never silently ignored. A repo with no .acorn/ behaves exactly as today.
// ponytail: smol-toml + hand validation — no config framework.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'

export type RunTarget = {
  id: string
  command: string
  stop?: string
  restart?: string // explicit restart command; when absent run_restart falls back to stop+start
  url?: string
  urlCommand?: string // url_command in TOML
  icon?: string
  default?: boolean
}

export type LayoutRecipe = {
  id: string
  panes: string[]
  ratio?: number
  terminal?: string // run.<id> to auto-start in the drawer
  browser?: string // 'run:<id>' — point the browser at that target's resolved URL
}

export type ConfigError = { source: string; message: string }

export type RepoConfig = {
  scripts: { setup: string | null; archive: string | null }
  runTargets: RunTarget[]
  copy: string[]
  layouts: LayoutRecipe[]
  errors: ConfigError[]
}

// The DB columns the file layers override. The `dev` run button now comes from the per-workspace
// dev script (or explicit config); the old scalar runCommand/devPort no longer maps to a target
// (devPort remains a browser-preview fallback in TaskView).
export type DbConfigFallback = {
  setupScript?: string | null
  teardownScript?: string | null
  devScript?: string | null // per-workspace "run dev" command → a base `dev` target (repo config overrides)
  devRestartScript?: string | null // per-workspace restart command for the base `dev` target
  runTargetsJson?: string | null // repo_paths.runTargets (JSON column, 13 §A DB fallback surface)
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

// One parsed [scripts.run.<id>] table → a validated RunTarget (or an error).
function parseRunTarget(id: string, v: unknown, source: string, errors: ConfigError[]): RunTarget | null {
  if (!v || typeof v !== 'object') {
    errors.push({ source, message: `run.${id} must be a table` })
    return null
  }
  const o = v as Record<string, unknown>
  const command = str(o.command)
  if (!command) {
    errors.push({ source, message: `run.${id} is missing 'command'` })
    return null
  }
  const url = str(o.url)
  const urlCommand = str(o.url_command)
  if (url && urlCommand) {
    errors.push({ source, message: `run.${id} declares both 'url' and 'url_command' — pick one` })
    return null
  }
  return {
    id,
    command,
    stop: str(o.stop),
    restart: str(o.restart),
    url,
    urlCommand,
    icon: str(o.icon),
    default: o.default === true || undefined,
  }
}

type Layer = {
  setup?: string
  archive?: string
  run: Map<string, RunTarget>
  copy?: string[]
  layouts: Map<string, LayoutRecipe>
}

function parseLayer(text: string, source: string, errors: ConfigError[]): Layer | null {
  let doc: Record<string, unknown>
  try {
    doc = parseToml(text) as Record<string, unknown>
  } catch (e) {
    errors.push({ source, message: e instanceof Error ? e.message : 'invalid TOML' })
    return null
  }
  const layer: Layer = { run: new Map(), layouts: new Map() }
  const scripts = doc.scripts
  if (scripts && typeof scripts === 'object') {
    const s = scripts as Record<string, unknown>
    layer.setup = str(s.setup)
    const archive = s.archive
    // [scripts.archive] may be a bare string or a { command } table (13 §A example).
    layer.archive = str(archive) ?? (archive && typeof archive === 'object' ? str((archive as Record<string, unknown>).command) : undefined)
    const run = s.run
    if (run && typeof run === 'object') {
      for (const [id, v] of Object.entries(run as Record<string, unknown>)) {
        const target = parseRunTarget(id, v, source, errors)
        if (target) layer.run.set(id, target)
      }
    }
  }
  const copy = doc.copy
  if (Array.isArray(copy)) layer.copy = copy.filter((c): c is string => typeof c === 'string' && !!c.trim()).map((c) => c.trim())
  else if (copy !== undefined) errors.push({ source, message: `'copy' must be an array of paths` })
  const layout = doc.layout
  if (layout && typeof layout === 'object') {
    for (const [id, v] of Object.entries(layout as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') {
        errors.push({ source, message: `layout.${id} must be a table` })
        continue
      }
      const o = v as Record<string, unknown>
      const panes = Array.isArray(o.panes) ? o.panes.filter((p): p is string => typeof p === 'string') : []
      if (!panes.length) {
        errors.push({ source, message: `layout.${id} needs a non-empty 'panes' array` })
        continue
      }
      layer.layouts.set(id, {
        id,
        panes,
        ratio: typeof o.ratio === 'number' ? o.ratio : undefined,
        terminal: str(o.terminal),
        browser: str(o.browser),
      })
    }
  }
  return layer
}

// The repo_paths.runTargets JSON column → RunTarget[] (the per-repo DB fallback surface). The old
// scalar runCommand/devPort no longer produces a `dev` target — the per-workspace dev script (Settings
// → workspace) replaces it, so an empty dev script means no run button. Malformed JSON → no targets.
export function legacyRunTargets(db: DbConfigFallback): RunTarget[] {
  if (!db.runTargetsJson) return []
  try {
    const arr = JSON.parse(db.runTargetsJson) as unknown
    if (!Array.isArray(arr)) return []
    const out: RunTarget[] = []
    for (const v of arr) {
      if (v && typeof v === 'object' && str((v as Record<string, unknown>).id) && str((v as Record<string, unknown>).command)) {
        const o = v as Record<string, unknown>
        out.push({
          id: (o.id as string).trim(),
          command: (o.command as string).trim(),
          stop: str(o.stop),
          url: str(o.url),
          urlCommand: str(o.urlCommand),
          icon: str(o.icon),
          default: o.default === true || undefined,
        })
      }
    }
    return out
  } catch {
    return [] // malformed JSON column → no targets
  }
}

// Read + merge the layers. Repo overrides user overrides DB; run targets and layouts merge by id
// (repo's id wins), scripts/copy are per-field.
export function loadRepoConfig(repoDir: string | null, userConfigDir: string | null, db: DbConfigFallback): RepoConfig {
  const errors: ConfigError[] = []
  const readLayer = (dir: string | null, label: string): Layer | null => {
    if (!dir) return null
    const file = join(dir, '.acorn', 'config.toml')
    if (!existsSync(file)) return null
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (e) {
      errors.push({ source: label, message: e instanceof Error ? e.message : 'unreadable config' })
      return null
    }
    return parseLayer(text, label, errors)
  }
  const repo = readLayer(repoDir, 'repo')
  const user = readLayer(userConfigDir, 'user')

  const run = new Map<string, RunTarget>()
  // Per-workspace dev script is the lowest-precedence base `dev` target: any repo-specific config
  // (legacy scalar, repo JSON, ~/.acorn, ./.acorn) overrides it. No `default` flag — it carries no
  // URL, so flagging it would shadow a repo's real default target in RuntimeService.defaultUrl.
  if (db.devScript?.trim()) run.set('dev', { id: 'dev', command: db.devScript.trim(), restart: db.devRestartScript?.trim() || undefined })
  for (const t of legacyRunTargets(db)) run.set(t.id, t)
  for (const t of user?.run.values() ?? []) run.set(t.id, t)
  for (const t of repo?.run.values() ?? []) run.set(t.id, t)

  const layouts = new Map<string, LayoutRecipe>()
  for (const l of user?.layouts.values() ?? []) layouts.set(l.id, l)
  for (const l of repo?.layouts.values() ?? []) layouts.set(l.id, l)

  return {
    scripts: {
      setup: repo?.setup ?? user?.setup ?? (db.setupScript?.trim() || null),
      archive: repo?.archive ?? user?.archive ?? (db.teardownScript?.trim() || null),
    },
    runTargets: [...run.values()],
    copy: repo?.copy ?? user?.copy ?? [],
    layouts: [...layouts.values()],
    errors,
  }
}
