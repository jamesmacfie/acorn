import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The docs carry a second implementation of the design (architecture review, finding 7), so a
// reference that points at nothing is a bug rather than a typo. Twelve of the source paths cited
// across `docs/` had rotted by 2026-08-27, four of them naming files that no longer exist at all.
//
// Two things are checked, and the second one is the cheap half: a repo-rooted path in backticks has
// to resolve, and a relative markdown link between two docs has to resolve.

const ROOT = (() => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Could not locate the workspace root')
    dir = parent
  }
})()

const DOCS = join(ROOT, 'docs')

const markdown = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) markdown(path, out)
    else if (entry.name.endsWith('.md')) out.push(path)
  }
  return out
}

// The root README and CLAUDE.md are the two docs a reader meets first, and they cite the tree like any
// other. They sit outside `docs/`, so a walk of that folder alone left them unchecked.
const FILES = [...markdown(DOCS), join(ROOT, 'README.md'), join(ROOT, 'CLAUDE.md')].filter(existsSync)
const rel = (file: string) => relative(ROOT, file)

// A repo-rooted path starts with a workspace directory. Anything else in backticks is a fragment, a
// bare filename, or a package specifier, and chasing those means guessing which package a reader is
// meant to be standing in.
const ROOTS = ['apps/', 'packages/', 'plugins/', 'tools/', 'scripts/', 'docs/', '.github/']
const CITED = /`([A-Za-z0-9_./@-]+)`/g

// Two kinds of citation are excused, and both are conventions the docs already used before this
// check existed:
//
//   A path with no file extension is a directory or, in `tools/list`, a JSON-RPC method that reads
//   like one. Directories move for reasons that are not rot, and the review's finding was about
//   source files.
//
//   A path the same line marks as gone or not yet arrived. Design and phase files name the file a
//   change deleted and the file it will add, which is the point of them. The markers below are the
//   phrasings already in use, so nothing had to be reworded to pass.
const GONE = ['delete', 'replaced', 'moved to', 'git history', 'git log', '(new']

// `plugins/github.sqlite` and its siblings live in the data root, not the repo. They are spelled
// like repo paths because that is the layout under the root (docs/data-layer.md).
const isDataRoot = (path: string) => path.endsWith('.sqlite')

// A review is dated evidence. Rewriting one so a path resolves would falsify what was true when it
// was written, so reviews are read-only here and excluded. The list is empty today — the last entry
// went with the folder reorganisation whose record it was — and it stays here because the next review
// that lands in `docs/` needs the same exemption.
const REVIEWS: string[] = []
const isReview = (file: string) => REVIEWS.some((prefix) => rel(file).startsWith(prefix))

describe('docs cite paths that exist', () => {
  it('every repo-rooted path in backticks resolves', () => {
    const broken: string[] = []
    let checked = 0
    for (const file of FILES) {
      if (isReview(file)) continue
      for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        const lower = line.toLowerCase()
        CITED.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = CITED.exec(line))) {
          const path = match[1]
          if (!ROOTS.some((root) => path.startsWith(root))) continue
          if (!/\.[a-z]+$/.test(path) || isDataRoot(path)) continue
          checked += 1
          if (existsSync(join(ROOT, path))) continue
          if (GONE.some((marker) => lower.includes(marker))) continue
          broken.push(`${rel(file)}:${index + 1}: ${path}`)
        }
      }
    }
    expect(broken.sort()).toEqual([])
    // Anti-vacuity: the docs do cite the tree, and a broken regex would report a clean sweep.
    expect(checked).toBeGreaterThan(200)
  })

  it('every relative link between docs resolves', () => {
    const LINK = /\]\(([^)\s#]+)(?:#[^)]*)?\)/g
    const broken: string[] = []
    let checked = 0
    for (const file of FILES) {
      for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        LINK.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = LINK.exec(line))) {
          const target = match[1]
          if (/^(https?:|mailto:|#)/.test(target)) continue
          checked += 1
          if (!existsSync(resolve(dirname(file), target))) broken.push(`${rel(file)}:${index + 1}: ${target}`)
        }
      }
    }
    expect(broken.sort()).toEqual([])
    expect(checked).toBeGreaterThan(100)
  })
  it('no doc cites a retired directory name', () => {
    // The escape hatch above — a path with no file extension is a directory, and directories move for
    // reasons that are not rot — is exactly what let twelve source paths rot behind a folder rename.
    // This is the narrow half of the check the hatch gives up: a denylist of directory names the
    // 2026-08-30 reorganisation retired, which may only appear on a line that says they are gone.
    const RETIRED = ['src/main/', 'src/app/', 'src/wiring/', 'src/service/']
    const offenders: string[] = []
    let checked = 0
    for (const file of FILES) {
      if (isReview(file)) continue
      for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        const lower = line.toLowerCase()
        checked += 1
        if (GONE.some((marker) => lower.includes(marker))) continue
        for (const name of RETIRED) if (line.includes(name)) offenders.push(`${rel(file)}:${index + 1}: ${name}`)
      }
    }
    expect(offenders.sort()).toEqual([])
    // Anti-vacuity: the lines are being read, rather than the walk having come back empty.
    expect(checked).toBeGreaterThan(2000)
  })
})
