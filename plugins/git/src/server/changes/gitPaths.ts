// Porcelain without -z C-quotes filenames as bytes, including octal UTF-8 sequences.
// The product's path contract is UTF-8 strings. Reject unsupported bytes rather than target a
// replacement-character filename, which could be a different real file.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '\\': 92, '"': 34 }

export function decodeGitPath(path: string): string {
  if (!path.startsWith('"')) return validatePath(path)
  if (!path.endsWith('"')) throw new Error('Malformed Git path.')
  const bytes: number[] = []
  for (let at = 1; at < path.length - 1; at++) {
    const char = path[at]!
    if (char === '"') throw new Error('Malformed Git path.')
    if (char !== '\\') {
      const point = path.codePointAt(at)!
      bytes.push(...Buffer.from(String.fromCodePoint(point)))
      if (point > 0xffff) at++
      continue
    }
    const escape = path[++at]!
    if (at >= path.length - 1) throw new Error('Malformed Git path escape.')
    if (escape in escapes) bytes.push(escapes[escape]!)
    else {
      const octal = path.slice(at, at + 3)
      if (!/^[0-3][0-7]{2}$/.test(octal)) throw new Error('Malformed Git path escape.')
      bytes.push(Number.parseInt(octal, 8))
      at += 2
    }
  }
  try {
    return validatePath(utf8.decode(Uint8Array.from(bytes)), true)
  } catch {
    throw new Error('Unsupported Git path encoding.')
  }
}

function validatePath(path: string, decoded = false): string {
  if (!path || path.includes('\0') || (!decoded && path.includes('\ufffd'))) throw new Error('Unsupported Git path encoding.')
  return path
}

type Counts = { a: number | null; d: number | null }
type Numstat = { path: string; oldPath?: string; counts: Counts }

// -z separates rename names instead of abbreviating them with arrows or braces. Literal arrows,
// braces, tabs, and newlines retain their identity. Both numstat commands use this format.
export function parseNumstat(text: string): Numstat[] {
  const fields = text.split('\0')
  const records: Numstat[] = []
  for (let at = 0; at < fields.length - 1; at++) {
    const match = fields[at]!.match(/^(\d+|-)\t(\d+|-)\t([\s\S]*)$/)
    if (!match) throw new Error('Malformed Git numstat record.')
    const counts = { a: match[1] === '-' ? null : Number(match[1]), d: match[2] === '-' ? null : Number(match[2]) }
    // Porcelain validates the supported filename bytes first. Numstat decorations are joined only
    // to those exact paths, including a legitimately encoded U+FFFD character.
    if (match[3]) records.push({ path: validatePath(match[3], true), counts })
    else {
      const oldPath = validatePath(fields[++at] ?? '', true)
      const path = validatePath(fields[++at] ?? '', true)
      records.push({ oldPath, path, counts })
    }
  }
  if (fields.at(-1) !== '') throw new Error('Incomplete Git numstat record.')
  return records
}
