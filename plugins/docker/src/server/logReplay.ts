// Mirrors the client display tail's UTF-16 limit. Projection happens only when a viewer joins.
const MAX_CHARS = 512 * 1024
const BLOCK_CHARS = 4096

export class LogReplay {
  private chunks: string[] = []
  private chars = 0
  private headOffset = 0

  append(text: string): void {
    if (!text) return
    if (text.length >= MAX_CHARS) {
      text = text.slice(-MAX_CHARS)
      this.chunks = []
      this.chars = 0
      this.headOffset = 0
    }
    const last = this.chunks.at(-1)
    let cursor = 0
    if (last && last.length < BLOCK_CHARS) {
      cursor = Math.min(BLOCK_CHARS - last.length, text.length)
      this.chunks[this.chunks.length - 1] = last + text.slice(0, cursor)
    }
    for (; cursor < text.length; cursor += BLOCK_CHARS) this.chunks.push(text.slice(cursor, cursor + BLOCK_CHARS))
    this.chars += text.length
    let excess = this.chars - MAX_CHARS
    while (excess > 0) {
      const first = this.chunks[0]
      const remaining = first.length - this.headOffset
      if (remaining <= excess) { this.chunks.shift(); this.headOffset = 0; excess -= remaining; this.chars -= remaining }
      else { this.headOffset += excess; this.chars -= excess; excess = 0 }
    }
  }

  text(): string { return this.chunks.map((chunk, index) => index === 0 ? chunk.slice(this.headOffset) : chunk).join('') }
}
