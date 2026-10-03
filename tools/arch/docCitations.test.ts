import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT, anchors, slug } from './docAnchors'

// Source comments cite the docs about 3,000 times, most as `docs/<page>.md § Heading`.
// `docPaths.test.ts` reads only the docs, so a renamed page or a moved section broke those comments
// with nothing to say so. On October 3, 2026, 64 comments named a doc file that no longer existed.
//
// Two things are checked: every `docs/….md` a source file names exists, and every `§ Heading` after
// one names a heading or an explicit anchor in that file. The heading is matched as a prefix of the
// cited text, after wrapped comment lines are joined, because a comment carries on past the heading
// and wraps wherever the line runs out.

// Tracked files only. A walk of the tree would read `node_modules`, build output, and, in the main
// checkout, every task worktree under `apps/node/.acorn`.
const SOURCE = /\.(?:[cm]?[jt]sx?|rs|css|json|toml|ya?ml|sh|html)$/
const FILES = execFileSync('git', ['ls-files', '-z', '--', 'apps', 'packages', 'plugins', 'tools', 'scripts'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\0')
  .filter((file) => SOURCE.test(file))

// A repo-rooted doc path. The lookbehind skips a path inside a URL or a relative path, such as an
// upstream project's own `…/docs/overview.md`.
const CITATION = /(?<![\w./-])docs\/[\w./-]+?\.md\b/g
const SECTION = /^\s*§\s*/
const COMMENT = /^\s*(?:\/\/|\/\*+|\{\/\*|\*|#)\s?/
const anchorCache = new Map<string, Set<string>>()

// Section citations that failed when this check landed. Each is a comment naming a heading that was
// renamed or moved. The phase that rewrites the cited doc fixes its entries. The list may only
// shrink: an entry that passes fails the test until it is deleted.
const ALLOWLIST_FILE = join(ROOT, 'tools/arch/docCitations.allowlist.txt')
const ALLOWLIST = readFileSync(ALLOWLIST_FILE, 'utf8').split('\n').filter(Boolean)

describe('source comments cite docs that exist', () => {
  const missing: string[] = []
  const broken = new Map<string, string>()
  const sections = new Set<string>()
  let cited = 0
  let sectionsCited = 0

  for (const file of FILES) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(CITATION)) {
        const path = match[0]
        cited += 1
        if (!existsSync(join(ROOT, path))) {
          missing.push(`${file}:${index + 1}: ${path}`)
          continue
        }
        const after = line.slice(match.index + path.length)
        if (!SECTION.test(after)) continue
        sectionsCited += 1
        // Join up to three wrapped comment lines, so a heading split across two lines still matches.
        let text = after.replace(SECTION, '')
        for (const next of lines.slice(index + 1, index + 4)) {
          if (!COMMENT.test(next)) break
          text += ` ${next.replace(COMMENT, '')}`
        }
        text = text.replace(/\s+/g, ' ')
        const heading = text.split(/[),;]|\.(?:\s|$)|\*\//)[0].trim().slice(0, 60)
        sections.add(`${path} § ${heading}`)
        if (!anchorCache.has(path)) anchorCache.set(path, anchors(join(ROOT, path)))
        const target = slug(text)
        if ([...anchorCache.get(path)!].some((id) => id && (target === id || target.startsWith(`${id}-`)))) continue
        broken.set(`${file}: ${path} § ${heading}`, `${file}:${index + 1}`)
      }
    }
  }

  it('every cited doc file exists', () => {
    expect(missing.sort()).toEqual([])
    // Anti-vacuity: the source does cite the docs, and a broken pattern would report a clean sweep.
    expect(cited).toBeGreaterThan(2000)
  })

  it('every cited section names a heading or anchor in that doc', () => {
    const allowed = new Set(ALLOWLIST)
    const unexpected = [...broken].filter(([key]) => !allowed.has(key)).map(([key, at]) => `${at}: ${key}`)
    const stale = ALLOWLIST.filter((key) => !broken.has(key))
    console.info(
      `doc citations: ${cited} in source, ${sectionsCited} name a section, ${sections.size} distinct sections, ` +
        `${broken.size} broken (allowlisted)`,
    )
    expect(unexpected.sort()).toEqual([])
    expect(stale, `delete these from ${ALLOWLIST_FILE}`).toEqual([])
    expect(ALLOWLIST.length).toBe(allowed.size)
    expect(sectionsCited).toBeGreaterThan(1500)
  })

  // A report, not a gate, until the documentation overhaul splits the long pages. Its last phase makes
  // this a hard limit. `docs/future/` holds proposals and `docs/testing/` and the dated security
  // review hold evidence, so none of them count.
  it('reports docs longer than 200 lines', () => {
    const docs = execFileSync('git', ['ls-files', '--', 'docs/*.md', 'README.md'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((file) => file && !/^docs\/(?:future|testing)\/|^docs\/security\/review-/.test(file))
    const long = docs
      .map((file) => ({ file, lines: readFileSync(join(ROOT, file), 'utf8').split('\n').length - 1 }))
      .filter(({ lines }) => lines > 200)
      .sort((a, b) => b.lines - a.lines)
    expect(docs.length).toBeGreaterThan(50)
    console.info(`${long.length} docs over 200 lines:\n${long.map(({ file, lines }) => `  ${lines}  ${file}`).join('\n')}`)
  })
})
