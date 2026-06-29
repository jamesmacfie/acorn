// GitHub job logs are one plaintext blob per job (no per-step API). Each line is prefixed with an
// ISO timestamp, and steps appear as top-level ##[group]…##[endgroup] sections in order. We strip
// the timestamps and slice the blob into per-step sections by positional alignment.

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s/

export function stripTimestamps(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(TIMESTAMP, ''))
    .join('\n')
}

// Returns the cleaned full log plus a per-step slice map. The map is populated only when the
// number of top-level groups matches the number of steps; otherwise callers fall back to `full`.
// ponytail: positional group→step alignment; whole-log fallback when counts mismatch (nested or
// group-less steps). Upgrade path: match group headers to step names if alignment proves too lossy.
export function splitJobLog(text: string, steps: { number: number }[]): { byStep: Map<number, string>; full: string } {
  const full = stripTimestamps(text)
  const byStep = new Map<number, string>()

  const sections: string[] = []
  let current: string[] | null = null
  for (const line of full.split('\n')) {
    if (line.startsWith('##[group]')) {
      if (current) sections.push(current.join('\n'))
      current = [line]
    } else if (current) {
      current.push(line)
    }
  }
  if (current) sections.push(current.join('\n'))

  if (sections.length === steps.length) steps.forEach((s, i) => byStep.set(s.number, sections[i]))
  return { byStep, full }
}
