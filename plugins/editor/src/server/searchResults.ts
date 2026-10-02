import type { FileHits, SearchResult } from '../shared/search'
import { SearchFailure } from '../shared/search'

const MAX_TOTAL_HITS = 2000 // Bound the response; the pane reports when results are truncated.
const MAX_PREVIEW_LEN = 300 // Keep one long or minified line from bloating the response payload.

// One line of `rg --json` output. Only the fields we consume are typed; `type` discriminates.
type RgEvent = {
  type: 'begin' | 'end' | 'match' | 'summary' | 'context'
  data?: {
    path?: { text?: string }
    lines?: { text?: string }
    line_number?: number
    submatches?: { start: number; end: number }[]
  }
}

// ripgrep's submatch offsets are UTF-8 bytes, while JavaScript strings and editor columns use UTF-16
// code units. Convert on the node so every client consumer shares one column
// contract. rg only reports code-point boundaries, so a partial character cannot occur, and the >=
// check clamps a malformed offset to the next valid position.
function utf16OffsetAtUtf8Byte(text: string, byteOffset: number): number {
  let bytes = 0
  let utf16 = 0
  for (const char of text) {
    if (bytes >= byteOffset) break
    bytes += Buffer.byteLength(char, 'utf8')
    utf16 += char.length
  }
  return utf16
}

// Retain accepted hits only. An extra supported hit proves truncation.
export class RgResults {
  private files: FileHits[] = []
  private current: FileHits | null = null
  private total = 0
  truncated = false

  accept(raw: string): void {
    if (!raw) return
    let ev: RgEvent
    try { ev = JSON.parse(raw) as RgEvent }
    catch { throw new SearchFailure('invalid_output', 'Ripgrep returned an invalid JSON record.') }
    if (!ev || typeof ev !== 'object' || !['begin', 'end', 'match', 'summary', 'context'].includes(ev.type)) throw new SearchFailure('invalid_output', 'Ripgrep returned an invalid record.')
    if (ev.type === 'begin') {
      const rawPath = ev.data?.path?.text
      const path = rawPath?.startsWith('./') ? rawPath.slice(2) : rawPath
      this.current = path ? { path, hits: [] } : null
    } else if (ev.type === 'end') this.current = null
    else if (ev.type === 'match' && this.current) {
      const line = ev.data?.line_number
      const text = ev.data?.lines?.text
      if (line == null || text == null) return // Preserve the non-UTF-8 payload policy.
      const content = text.replace(/\r?\n$/, '')
      const preview = content.slice(0, MAX_PREVIEW_LEN)
      for (const sm of ev.data?.submatches ?? []) {
        if (this.total >= MAX_TOTAL_HITS) { this.truncated = true; return }
        if (!this.current.hits.length) this.files.push(this.current)
        this.current.hits.push({ line, col: utf16OffsetAtUtf8Byte(content, sm.start) + 1,
          endCol: utf16OffsetAtUtf8Byte(content, sm.end) + 1, preview })
        this.total++
      }
    }
  }

  result(): SearchResult { return { files: this.files, truncated: this.truncated } }
}

export function parseRgJson(stdout: string): SearchResult {
  const results = new RgResults()
  for (const record of stdout.split('\n')) {
    results.accept(record)
    if (results.truncated) break
  }
  return results.result()
}
