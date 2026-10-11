import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { GONE, ROOT } from './docAnchors'

// A source comment that names a file sends the reader to it. When the file moves, the comment keeps
// pointing at the old place, and nothing else notices. This check reads every comment in the
// TypeScript and JavaScript source and resolves each path it names. `docCitations.test.ts` already
// checks paths under `docs/`, so they're skipped here.
//
// A path resolves when it exists from the repository root or the commenting file's folder, when it
// starts with a workspace package's folder name and continues inside that package or its `src/`
// (`client-core/host/clientRuntime.ts`), when it's the tail of a tracked file (`server/core/git.ts`),
// or when it's inside a dependency installed for the package or the root. Three kinds are skipped: a
// path under a dot folder names a file in a person's project (`.acorn/config.toml`), a path under
// `dist/` names build output, and a line with one of the doc path check's "gone" markers names a file
// on purpose.

const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const TRACKED = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
const FILES = TRACKED.filter((file) => /^(?:apps|packages|plugins|tools|scripts)\//.test(file) && SOURCE.test(file))
const TRACKED_SET = new Set(TRACKED)

// A path with at least one folder and a file extension. The lookbehind skips the middle of a URL, a
// package specifier such as `@acorn/client-core/…`, and the tail of a longer path.
const PATH =
  /(?<![\w@./:-])(?:\.{1,2}\/)*(?:[\w.-]+\/)+[\w.-]+\.(?:[cm]?[jt]sx?|rs|css|json|toml|ya?ml|sh|sql|html|md)\b/g

// Every comment in a file, as its text and the line it starts on.
const comments = (file: string, text: string): { text: string; line: number }[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, scriptKind(file))
  const seen = new Set<number>()
  const found: { text: string; line: number }[] = []
  const collect = (ranges: readonly ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue
      seen.add(range.pos)
      found.push({
        text: text.slice(range.pos, range.end),
        line: source.getLineAndCharacterOfPosition(range.pos).line + 1,
      })
    }
  }
  const visit = (node: ts.Node) => {
    if (!ts.isJsxText(node)) {
      collect(ts.getLeadingCommentRanges(text, node.pos))
      collect(ts.getTrailingCommentRanges(text, node.end))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  collect(ts.getLeadingCommentRanges(text, source.endOfFileToken.pos))
  return found
}

const scriptKind = (file: string): ts.ScriptKind =>
  file.endsWith('.tsx') ? ts.ScriptKind.TSX : /\.[cm]?jsx?$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TS

// Each workspace package's folder, keyed by its folder name: `client-core` → `packages/client-core`.
const PACKAGE_DIRS = new Map(
  TRACKED.filter((file) => /^(?:apps|packages|plugins)\/[^/]+\/package\.json$/.test(file)).map((file) => {
    const dir = dirname(file)
    return [dir.split('/')[1], dir]
  }),
)

const packageOf = (file: string): string => file.split('/').slice(0, 2).join('/')

const skipped = (path: string): boolean => {
  const bare = path.replace(/^(?:\.{1,2}\/)+/, '')
  return bare.startsWith('.') || bare.startsWith('dist/')
}

const resolves = (file: string, path: string): boolean => {
  if (TRACKED_SET.has(path) || existsSync(join(ROOT, path))) return true
  if (existsSync(join(ROOT, dirname(file), path))) return true
  if (path.startsWith('.')) return false
  const [first, ...rest] = path.split('/')
  const pkg = PACKAGE_DIRS.get(first)
  if (pkg && [join(pkg, 'src', ...rest), join(pkg, ...rest)].some((candidate) => TRACKED_SET.has(candidate)))
    return true
  if (TRACKED.some((tracked) => tracked.endsWith(`/${posix.normalize(path)}`))) return true
  return [packageOf(file), '.'].some((dir) => existsSync(join(ROOT, dir, 'node_modules', path)))
}

describe('source comments name files that exist', () => {
  it('every path in a comment resolves', () => {
    const broken: string[] = []
    let checked = 0
    for (const file of FILES) {
      const text = readFileSync(join(ROOT, file), 'utf8')
      for (const comment of comments(file, text)) {
        for (const [offset, line] of comment.text.split('\n').entries()) {
          const lower = line.toLowerCase()
          for (const match of line.matchAll(PATH)) {
            const path = match[0]
            if (path.startsWith('docs/') || skipped(path)) continue
            checked += 1
            if (resolves(file, path)) continue
            if (GONE.some((marker) => lower.includes(marker))) continue
            broken.push(`${file}:${comment.line + offset}: ${path}`)
          }
        }
      }
    }
    expect(broken.sort()).toEqual([])
    // Anti-vacuity: comments do name files, and a broken pattern would report a clean sweep.
    expect(checked).toBeGreaterThan(1000)
    // Parsing every source file takes about three seconds alone and more than five inside `pnpm test`.
  }, 30_000)
})
