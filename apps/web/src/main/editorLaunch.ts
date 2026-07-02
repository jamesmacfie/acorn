// External-editor command classification (docs/next 01 P2, after orca's external-editor-launch):
// a bare word ('code', 'zed') resolves on PATH; a compound ('cursor -n') splits into argv with the
// word resolved; an absolute path execs directly. Pure — PATH dirs and an exists() probe are
// injected so this is unit-testable under plain Node; the spawn glue lives in terminal.ts.
import { delimiter, isAbsolute, join } from 'node:path'

export type EditorLaunch = { ok: true; file: string; args: string[] } | { ok: false; reason: string }

export type ClassifyOpts = {
  pathVar: string // process.env.PATH
  exists: (p: string) => boolean
}

// ponytail: whitespace argv split, no quote handling — editor commands are 'code' / 'cursor -n',
// not shell scripts. Add a real tokenizer only if a quoted argument ever shows up.
export function classifyEditorCommand(input: string, opts: ClassifyOpts): EditorLaunch {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, reason: 'No editor command configured.' }
  const parts = trimmed.split(/\s+/)
  const word = parts[0]
  const args = parts.slice(1)
  if (isAbsolute(word)) {
    return opts.exists(word) ? { ok: true, file: word, args } : { ok: false, reason: `Editor not found at ${word}.` }
  }
  if (word.includes('/')) return { ok: false, reason: 'Editor command must be a bare word or an absolute path.' }
  for (const dir of opts.pathVar.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, word)
    if (opts.exists(candidate)) return { ok: true, file: candidate, args }
  }
  return { ok: false, reason: `'${word}' is not on PATH.` }
}

// Full launch argv for a task dir: precedence repo editorCommand → prefs default → 'code', with the
// target directory as the final positional. The IPC handler just spawns the result.
export function buildEditorArgv(
  configured: string | null,
  fallbackDefault: string | null,
  targetDir: string,
  opts: ClassifyOpts,
): EditorLaunch {
  const launch = classifyEditorCommand(configured ?? fallbackDefault ?? 'code', opts)
  return launch.ok ? { ok: true, file: launch.file, args: [...launch.args, targetDir] } : launch
}
