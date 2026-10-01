// Page-controlled diagnostics have both a retention budget and a per-entry budget. Truncate before
// concatenating the message, so a large page string does not create another unbounded retained copy.
export type DiagnosticLimits = { entries: number; entryBytes: number; totalBytes: number }
const LIMITS: DiagnosticLimits = { entries: 200, entryBytes: 8 * 1024, totalBytes: 256 * 1024 }
const TRUNCATED = '… [truncated]'

function prefixWithinBytes(text: string, bytes: number): string {
  let end = 0
  let used = 0
  for (const point of text) {
    const size = Buffer.byteLength(point)
    if (used + size > bytes) break
    used += size
    end += point.length
  }
  return text.slice(0, end)
}

export class BrowserDiagnostics {
  #lines: string[] = []
  #bytes = 0

  constructor(private readonly limits: DiagnosticLimits = LIMITS) {
    if (!Object.values(limits).every((value) => Number.isSafeInteger(value) && value > 0) ||
        Math.min(limits.entryBytes, limits.totalBytes) < Buffer.byteLength(TRUNCATED)) {
      throw new Error('Invalid browser diagnostic limits')
    }
  }

  append(kind: string, text: string): void {
    const budget = Math.min(this.limits.entryBytes, this.limits.totalBytes)
    // Kinds come from Playwright, but keep their contribution bounded as well.
    const prefix = `[${prefixWithinBytes(kind, 32)}] `
    const fullBytes = Buffer.byteLength(prefix) + Buffer.byteLength(text)
    const line = fullBytes <= budget ? prefix + text :
      prefixWithinBytes(prefix, budget - Buffer.byteLength(TRUNCATED)) +
      prefixWithinBytes(text, Math.max(0, budget - Buffer.byteLength(prefix) - Buffer.byteLength(TRUNCATED))) + TRUNCATED
    const bytes = Buffer.byteLength(line)
    this.#lines.push(line)
    this.#bytes += bytes
    while (this.#lines.length > this.limits.entries || this.#bytes > this.limits.totalBytes) {
      this.#bytes -= Buffer.byteLength(this.#lines.shift()!)
    }
  }

  lines(): string[] { return [...this.#lines] }
}
