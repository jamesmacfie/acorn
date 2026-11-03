/** The last `count` lines of `text`, and how many lines came before them. */
export function lastLines(text: string, count: number): { text: string; hidden: number } {
  const lines = text.replace(/\n$/, '').split('\n')
  if (lines.length <= count) return { text, hidden: 0 }
  return { text: lines.slice(-count).join('\n'), hidden: lines.length - count }
}
