import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Shared by the two doc checkers: `docPaths.test.ts` reads the docs, `docCitations.test.ts` reads the
// source comments that cite them. Both have to agree on what a heading's id is.

export const ROOT = (() => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Could not locate the workspace root')
    dir = parent
  }
})()

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
// `<a id="…">` anchors are included because the landing pages use them to preserve old section links
// after moving long references into subfolders.
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
