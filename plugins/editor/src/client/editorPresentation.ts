import type { DocumentCustody } from '@acorn/plugin-api/ui/editor'
import type { LanguageId } from '@acorn/protocol/languageIds.ts'

export type Indentation = { mode: 'spaces' | 'tabs'; width: 2 | 4 | 8 }
export type Presentation = { wrap?: boolean; indentation?: Indentation }

const overrides = new Map<string, Presentation>()
const key = (nodeId: string | null, taskId: string, path: string) => JSON.stringify([nodeId, taskId, path])

export function presentationFor(nodeId: string | null, taskId: string, path: string): Presentation {
  return overrides.get(key(nodeId, taskId, path)) ?? {}
}

export function setPresentation(nodeId: string | null, taskId: string, path: string, next: Presentation): void {
  overrides.set(key(nodeId, taskId, path), next)
}

export function movePresentation(nodeId: string | null, taskId: string, from: string, to: string): void {
  for (const [stored, value] of [...overrides]) {
    const address = JSON.parse(stored) as [string | null, string, string]
    if (address[0] !== nodeId || address[1] !== taskId || address[2] !== from && !address[2].startsWith(`${from}/`)) continue
    overrides.delete(stored)
    overrides.set(key(nodeId, taskId, to + address[2].slice(from.length)), value)
  }
}

export function forgetPresentation(nodeId: string | null, taskId: string, path: string): void {
  overrides.delete(key(nodeId, taskId, path))
}

export function prunePresentation(nodeId: string | null, taskId?: string, path?: string): void {
  for (const stored of overrides.keys()) {
    const address = JSON.parse(stored) as [string | null, string, string]
    if (address[0] === nodeId && (taskId === undefined || address[1] === taskId)
      && (path === undefined || address[2] === path || address[2].startsWith(`${path}/`))) overrides.delete(stored)
  }
}

/** Inspect no more than 200 lines and 64 KiB. Inconclusive samples use the device default. */
export function inferIndentation(text: string, fallback: Indentation = { mode: 'spaces', width: 2 }): Indentation {
  const bytes = new TextEncoder().encode(text.slice(0, 64 * 1024)).subarray(0, 64 * 1024)
  const sample = new TextDecoder().decode(bytes).split(/\r?\n/, 200)
  const widths = new Map<number, number>()
  let tabs = 0
  let spaces = 0
  for (const line of sample) {
    if (!line.trim()) continue
    const prefix = /^[ \t]+/.exec(line)?.[0]
    if (!prefix) continue
    if (prefix.includes('\t') && prefix.includes(' ')) return fallback
    if (prefix[0] === '\t') { tabs++; continue }
    spaces++
    const width = prefix.length
    for (const candidate of [2, 4, 8]) if (width % candidate === 0) widths.set(candidate, (widths.get(candidate) ?? 0) + 1)
  }
  if (tabs && spaces || !tabs && !spaces) return fallback
  if (tabs) return { mode: 'tabs', width: fallback.width }
  const exact = sample.map((line) => /^ +/.exec(line)?.[0].length ?? 0).filter(Boolean)
  const smallest = Math.min(...exact)
  if (smallest !== 2 && smallest !== 4 && smallest !== 8) return fallback
  if ((widths.get(smallest) ?? 0) !== spaces) return fallback
  return { mode: 'spaces', width: smallest }
}

export function saveLabel(custody: DocumentCustody | undefined, disk: string | null): string {
  if (!custody) return 'Saved'
  if (disk === 'deleted') return 'Deleted on disk'
  if (disk === 'changed') return 'Changed on disk'
  if (disk === 'unknown' || disk === 'recovered' || custody.requiresResolution) return 'Recovered draft'
  if (custody.writeBlock) return 'Save failed'
  if (custody.writing) return 'Saving…'
  if (custody.error) return 'Save failed'
  return custody.dirty ? 'Unsaved' : 'Saved'
}

export function languageName(id: LanguageId): string {
  const names: Partial<Record<LanguageId, string>> = {
    plaintext: 'Plain text', typescript: 'TypeScript', typescriptreact: 'TypeScript React',
    javascript: 'JavaScript', javascriptreact: 'JavaScript React', json: 'JSON',
    css: 'CSS', scss: 'SCSS', less: 'Less', html: 'HTML', xml: 'XML',
    sql: 'SQL', yaml: 'YAML', toml: 'TOML', ini: 'INI', cpp: 'C++', c: 'C',
  }
  return names[id] ?? id[0].toUpperCase() + id.slice(1)
}
