import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Shared by the path checkers: `docPaths.test.ts` reads the docs, and `docCitations.test.ts` and
// `commentPaths.test.ts` read source comments. They have to agree on what a heading's id is and on
// which words mark a path as gone.

export const ROOT = (() => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Could not locate the workspace root')
    dir = parent
  }
})()

// A line holding one of these marks the path it names as deleted or not yet added, so the path checks
// skip it. They're the phrasings the docs already used when the doc path check landed.
export const GONE = ['delete', 'replaced', 'moved to', 'git history', 'git log', '(new']

// GitHub-style heading ids: markup is removed, punctuation is dropped, and spaces become hyphens.
export const slug = (text: string): string =>
  text
    .replace(/<\/?(?:a|span|code|em|strong)\b[^>]*>/gi, '')
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-')

// Every id a link can land on in a doc. A repeated heading receives a numeric suffix. Explicit
// `<a id="…">` anchors are included because a split page may keep one for a link it can't update
// (docs/writing-docs.md § Split a long page).
export const anchors = (file: string): Set<string> => {
  const found = new Set<string>()
  const duplicates = new Map<string, number>()
  let fenced = false
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    for (const match of line.matchAll(/<a\s+(?:name|id)=["']([^"']+)["'][^>]*>/gi)) found.add(match[1])
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!heading) continue
    const base = slug(heading[2])
    const count = duplicates.get(base) ?? 0
    duplicates.set(base, count + 1)
    found.add(count === 0 ? base : `${base}-${count}`)
  }
  return found
}
