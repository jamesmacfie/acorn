import type { DiffItem } from '../shared/guide'

// Splits `git diff --no-color --no-ext-diff` output into the items a guide arranges: one per hunk, or
// one per file change that has no hunk text (a binary file, a pure rename, a mode change, an empty file).

export function parseDiff(output: string): DiffItem[] {
  const items: DiffItem[] = []
  for (const block of output.split(/^diff --git /m).slice(1)) {
    const lines = block.replace(/\n$/, '').split('\n')
    const firstHunk = lines.findIndex((line) => line.startsWith('@@'))
    const header = firstHunk === -1 ? lines : lines.slice(0, firstHunk)
    const file = fileHeader(header)
    const path = file.newPath ?? file.oldPath ?? ''
    const oldPath = file.oldPath !== null && file.oldPath !== path ? file.oldPath : null
    if (firstHunk === -1) {
      items.push({ id: `${path}#1`, path, oldPath, patch: '', note: file.note })
      continue
    }
    // A content line starts with a space, `+`, `-`, or `\`, so every line starting `@@` opens a hunk.
    const hunks: string[][] = []
    for (const line of lines.slice(firstHunk)) {
      if (line.startsWith('@@')) hunks.push([])
      hunks.at(-1)!.push(line)
    }
    hunks.forEach((hunk, index) =>
      items.push({ id: `${path}#${index + 1}`, path, oldPath, patch: hunk.join('\n'), note: '' }),
    )
  }
  return items
}

type FileHeader = { oldPath: string | null; newPath: string | null; note: string }

function fileHeader(lines: string[]): FileHeader {
  const [gitLine = '', ...rest] = lines
  const field = (prefix: string) => rest.find((line) => line.startsWith(prefix))?.slice(prefix.length)
  const minus = field('--- ')
  const plus = field('+++ ')
  const copied = field('copy from ') !== undefined
  const movedFrom = field('rename from ') ?? field('copy from ')
  const movedTo = field('rename to ') ?? field('copy to ')
  const [headerOld, headerNew] = gitPaths(gitLine)
  // `--- /dev/null` on an added file, `+++ /dev/null` on a deleted one.
  const oldPath = minus !== undefined ? sidePath(minus) : movedFrom !== undefined ? unquote(movedFrom) : headerOld
  const newPath = plus !== undefined ? sidePath(plus) : movedTo !== undefined ? unquote(movedTo) : headerNew
  const added = field('new file mode ') !== undefined
  const deleted = field('deleted file mode ') !== undefined
  const oldMode = field('old mode ')
  const newMode = field('new mode ')
  const note = rest.some((line) => line.startsWith('Binary files '))
    ? `Binary file ${added ? 'added' : deleted ? 'deleted' : 'changed'}`
    : added
      ? 'Empty file added'
      : deleted
        ? 'Empty file deleted'
        : movedFrom !== undefined
          ? `${copied ? 'Copied' : 'Renamed'} from ${oldPath}`
          : oldMode && newMode
            ? `Mode changed from ${oldMode} to ${newMode}`
            : 'Changed'
  return { oldPath, newPath, note }
}

// A `---` or `+++` path: `a/<path>`, `b/<path>`, or `/dev/null`. Git ends one that holds a space with a tab.
function sidePath(value: string): string | null {
  const path = unquote(value.replace(/\t$/, ''))
  return path === '/dev/null' ? null : path.slice(2)
}

// The two paths in `a/<old> b/<new>`. Unquoted, a path may hold spaces, so this reads only the case
// with no rename, where both halves are the same path. A renamed file names its paths elsewhere.
function gitPaths(line: string): [string | null, string | null] {
  if (line.startsWith('"')) {
    const end = closingQuote(line, 0)
    const second = line.slice(end + 2)
    return [unquote(line.slice(0, end + 1)).slice(2), unquote(second).slice(2)]
  }
  const length = (line.length - 5) / 2
  if (!Number.isInteger(length) || length < 1) return [null, null]
  const path = line.slice(2, 2 + length)
  return [path, path]
}

const closingQuote = (text: string, open: number): number => {
  for (let index = open + 1; index < text.length; index++) {
    if (text[index] === '\\') index++
    else if (text[index] === '"') return index
  }
  return text.length - 1
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }

// Git quotes a path holding a quote, a backslash, a control character, or a byte above 0x7f, with C
// escapes and octal bytes, such as `"caf\303\251.txt"`.
function unquote(value: string): string {
  if (!value.startsWith('"')) return value
  const bytes: number[] = []
  const body = value.slice(1, closingQuote(value, 0))
  for (let index = 0; index < body.length; index++) {
    const char = body[index]!
    if (char !== '\\') {
      bytes.push(...new TextEncoder().encode(char))
      continue
    }
    const next = body[index + 1] ?? ''
    if (/[0-7]/.test(next)) {
      bytes.push(Number.parseInt(body.slice(index + 1, index + 4), 8))
      index += 3
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0))
      index += 1
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}
