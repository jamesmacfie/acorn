// Extract Linear ticket references from PR text (description / comments / reviews — already
// client-side as sanitized HTML). We match linear.app issue URLs only — bare "ENG-123" tokens
// are too false-positive-prone (e.g. "HTTP-200"). ponytail: URLs only; add prefix-scoped bare-id
// matching if users ask. Deduped by identifier, first occurrence wins (preserves mention order).

const LINEAR_ISSUE_RE = /https?:\/\/linear\.app\/[^/\s"'<>]+\/issue\/([A-Z][A-Z0-9]*-\d+)/g

export type LinearRef = { identifier: string; url: string }

export function scanLinearRefs(texts: (string | null | undefined)[]): LinearRef[] {
  const seen = new Map<string, string>()
  for (const t of texts) {
    if (!t) continue
    LINEAR_ISSUE_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = LINEAR_ISSUE_RE.exec(t)) !== null) {
      if (!seen.has(m[1])) seen.set(m[1], m[0])
    }
  }
  return [...seen].map(([identifier, url]) => ({ identifier, url }))
}
