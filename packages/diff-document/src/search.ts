import { SEARCH_PAGE_MATCHES, SEARCH_PAGE_SEGMENTS, type DiffSearchMatch, type DiffSearchPage, type DiffSearchRequest, type PlainDiffRow } from './model'

// Find across a whole document without the renderer holding it. The provider runs this over the
// segments it can produce and answers a page of matches by segment and row; the viewer loads only the
// segment it takes the reader to.
//
// Code rows only, the text a line shows, and occurrences in one line never overlap because the scan
// steps past each hit. That is what the in-pane find always did over the rows it had.
//
// A page stops at its match limit or its segment budget, whichever comes first, so a page can be
// empty and still carry a cursor. The caller keeps reading until it has matches or the cursor ends.

/** Where the next page starts: a file's index in the request, then a segment, a row, and an offset
 *  into that row's text. */
type Cursor = { file: number; ordinal: number; row: number; offset: number }

export const encodeSearchCursor = (cursor: Cursor): string => `${cursor.file}.${cursor.ordinal}.${cursor.row}.${cursor.offset}`

export function decodeSearchCursor(text: string | null): Cursor | null {
  if (text == null) return { file: 0, ordinal: 0, row: 0, offset: 0 }
  const parts = text.split('.').map(Number)
  if (parts.length !== 4 || !parts.every((part) => Number.isInteger(part) && part >= 0)) return null
  const [file, ordinal, row, offset] = parts as [number, number, number, number]
  return { file, ordinal, row, offset }
}

type FileRef = { path: string; patchKey: string | null }

/**
 * One page of matches. `load` produces a file's segments; it is called in file order and only as far
 * as the page needs, so a query that fills its page in the first file reads one file.
 *
 * Returns null for a cursor that does not parse, which a route answers as a bad request.
 */
export async function searchDocument(
  files: readonly FileRef[],
  load: (file: FileRef & { patchKey: string }) => Promise<readonly (readonly PlainDiffRow[])[]>,
  request: DiffSearchRequest,
  limit = SEARCH_PAGE_MATCHES,
  budget = SEARCH_PAGE_SEGMENTS,
): Promise<DiffSearchPage | null> {
  const from = decodeSearchCursor(request.cursor)
  if (!from) return null
  if (!request.query) return { matches: [], nextCursor: null }
  const find = finder(request.query, request.caseSensitive)
  const matches: DiffSearchMatch[] = []
  let read = 0
  for (let f = from.file; f < files.length; f++) {
    const file = files[f]!
    if (!file.patchKey) continue
    const patchKey = file.patchKey
    const segments = await load({ path: file.path, patchKey })
    const first = f === from.file
    for (let ordinal = first ? from.ordinal : 0; ordinal < segments.length; ordinal++) {
      const resumed = first && ordinal === from.ordinal
      if (read === budget) return { matches, nextCursor: encodeSearchCursor({ file: f, ordinal, row: resumed ? from.row : 0, offset: resumed ? from.offset : 0 }) }
      read++
      const rows = segments[ordinal]!
      for (let row = resumed ? from.row : 0; row < rows.length; row++) {
        const entry = rows[row]!
        if (entry.kind === 'hunk' || entry.kind === 'gap') continue
        let at = resumed && row === from.row ? from.offset : 0
        for (;;) {
          const hit = find(entry.raw, at)
          if (!hit) break
          if (matches.length === limit) {
            return { matches, nextCursor: encodeSearchCursor({ file: f, ordinal, row, offset: hit.start }) }
          }
          matches.push({ path: file.path, patchKey, ordinal, row, start: hit.start, end: hit.end })
          at = hit.end
        }
      }
    }
  }
  return { matches, nextCursor: null }
}

/** The next occurrence at or after `at`, as offsets into the line itself. Ignoring case goes through
 *  a regular expression rather than lowercasing the line, because lowercasing can change a line's
 *  length (`İ` becomes two characters) and move every offset after it. */
function finder(query: string, caseSensitive: boolean): (text: string, at: number) => { start: number; end: number } | null {
  if (caseSensitive) {
    return (text, at) => {
      const start = text.indexOf(query, at)
      return start < 0 ? null : { start, end: start + query.length }
    }
  }
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  return (text, at) => {
    pattern.lastIndex = at
    const hit = pattern.exec(text)
    return hit ? { start: hit.index, end: hit.index + hit[0].length } : null
  }
}
