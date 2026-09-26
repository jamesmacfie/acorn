import { SEARCH_PAGE_MATCHES, type DiffSearchMatch, type DiffSearchPage, type DiffSearchRequest, type PlainDiffRow } from './model'

// Find across a whole document without the renderer holding it. The provider runs this over the
// segments it can produce and answers a page of matches by segment and row; the viewer loads only the
// segment it takes the reader to.
//
// Code rows only, the text a line shows, and occurrences in one line never overlap because the scan
// steps past each hit. That is what the in-pane find always did over the rows it had.

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
): Promise<DiffSearchPage | null> {
  const from = decodeSearchCursor(request.cursor)
  if (!from) return null
  if (!request.query) return { matches: [], nextCursor: null }
  const needle = request.caseSensitive ? request.query : request.query.toLowerCase()
  const matches: DiffSearchMatch[] = []
  for (let f = from.file; f < files.length; f++) {
    const file = files[f]!
    if (!file.patchKey) continue
    const patchKey = file.patchKey
    const segments = await load({ path: file.path, patchKey })
    const first = f === from.file
    for (let ordinal = first ? from.ordinal : 0; ordinal < segments.length; ordinal++) {
      const rows = segments[ordinal]!
      const startRow = first && ordinal === from.ordinal ? from.row : 0
      for (let row = startRow; row < rows.length; row++) {
        const entry = rows[row]!
        if (entry.kind === 'hunk' || entry.kind === 'gap') continue
        const hay = request.caseSensitive ? entry.raw : entry.raw.toLowerCase()
        let at = first && ordinal === from.ordinal && row === from.row ? from.offset : 0
        for (;;) {
          const hit = hay.indexOf(needle, at)
          if (hit < 0) break
          if (matches.length === limit) {
            return { matches, nextCursor: encodeSearchCursor({ file: f, ordinal, row, offset: hit }) }
          }
          matches.push({ path: file.path, patchKey, ordinal, row, start: hit, end: hit + needle.length })
          at = hit + needle.length
        }
      }
    }
  }
  return { matches, nextCursor: null }
}
