import type { InstructionFile, InstructionSnapshot } from './instructionSnapshot'
import { hiddenCharactersIn } from './instructionCheck'
import { createPatch } from 'diff'

export type InstructionFinding = { file: string; line: number; category: 'command' | 'domain' | 'sensitive-path' | 'permission' | 'override' | 'hidden-character' | 'unsupported'; detail: string }
export type InstructionChange = { path: string; status: 'added' | 'changed' | 'removed' | 'retargeted'; patch: string | null; beforeCanonical: string | null; afterCanonical: string | null }

const RULES: ReadonlyArray<{ category: InstructionFinding['category']; pattern: RegExp; detail: string }> = [
  { category: 'command', pattern: /(?:^|\s)(?:sudo|curl|wget|rm\s+-|chmod|chown|git\s+config|bash\s+-c|sh\s+-c|python\s+-c|node\s+-e)(?:\s|$)/i, detail: 'Command or shell operation' },
  { category: 'domain', pattern: /https?:\/\/[^\s)<>"']+/i, detail: 'External domain or URL' },
  { category: 'sensitive-path', pattern: /(?:\.ssh\/|\.aws\/|\.config\/|\.env\b|credentials|private[_ -]?key|secret[_ -]?key|api[_ -]?key)/i, detail: 'Sensitive path or credential reference' },
  { category: 'permission', pattern: /(?:allow|approve|grant|disable|bypass|skip|ignore).{0,60}(?:permission|approval|sandbox|security|guard|check)/i, detail: 'Permission or security control language' },
  { category: 'override', pattern: /(?:ignore (?:all )?(?:previous|prior|system|developer) instructions|you must (?:now )?ignore|override (?:the )?(?:system|developer|instructions))/i, detail: 'Instruction override phrase' },
]
const SECRET = /(\b[A-Za-z0-9_-]*(?:api[_-]?key|token|password|secret|authorization)[A-Za-z0-9_-]*\s*[:=]\s*)['"]?([^\s,'";]+)/gi
const TOKEN = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bglpat-[A-Za-z0-9_-]{10,}\b|\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
const MAX_FINDINGS = 2_000
const MAX_LINES = 20_000
const HIDDEN_NAMES: Record<string, string> = {
  'U+200B': 'zero width space', 'U+200C': 'zero width non-joiner', 'U+200D': 'zero width joiner',
  'U+202A': 'left-to-right embedding', 'U+202B': 'right-to-left embedding',
  'U+202D': 'left-to-right override', 'U+202E': 'right-to-left override',
  'U+2060': 'word joiner', 'U+FEFF': 'byte order mark', 'U+00AD': 'soft hyphen',
}

export function redactInstructionText(text: string): string {
  return text.replace(PRIVATE_KEY, '[redacted private key]').replace(TOKEN, '[redacted]').replace(SECRET, '$1[redacted]')
}

export function analyzeInstruction(snapshot: InstructionSnapshot): InstructionFinding[] {
  const findings: InstructionFinding[] = []
  for (const file of snapshot.files) {
    if (findings.length >= MAX_FINDINGS) break
    if (file.unsupported) {
      findings.push({ file: file.path, line: 0, category: 'unsupported', detail: 'Unsupported format; content was not analyzed.' })
      continue
    }
    const lines = (file.text ?? '').split(/\r?\n/)
    for (const hidden of hiddenCharactersIn(file.text ?? '', file.path)) {
      if (findings.length >= MAX_FINDINGS) break
      findings.push({ file: file.path, line: hidden.line, category: 'hidden-character',
        detail: `${hidden.codePoint} (${HIDDEN_NAMES[hidden.codePoint] ?? 'default ignorable character'})` })
    }
    for (let index = 0; index < Math.min(lines.length, MAX_LINES) && findings.length < MAX_FINDINGS; index++) {
      const line = lines[index]!
      for (const rule of RULES) {
        const match = line.match(rule.pattern)
        if (!match) continue
        let detail = rule.detail
        if (rule.category === 'domain') {
          try { detail += `: ${new URL(match[0]).hostname}` } catch { /* URL text is still flagged. */ }
        } else detail += `: ${redactInstructionText(match[0]).trim().slice(0, 100)}`
        findings.push({ file: file.path, line: index + 1, category: rule.category, detail })
        if (findings.length >= MAX_FINDINGS) break
      }
    }
    if (lines.length > MAX_LINES && findings.length < MAX_FINDINGS) {
      findings.push({ file: file.path, line: MAX_LINES, category: 'unsupported', detail: 'Analysis limited to the first 20,000 lines; inspect the full file.' })
    }
  }
  if (findings.length === MAX_FINDINGS) findings[MAX_FINDINGS - 1] = {
    file: findings[MAX_FINDINGS - 1]!.file, line: 0, category: 'unsupported', detail: 'Finding limit reached; inspect the full files.',
  }
  return findings
}

export function instructionChanges(
  before: ReadonlyArray<Pick<InstructionFile, 'path' | 'canonicalPath' | 'sha256'> & { text: string | null }> | null,
  after: InstructionSnapshot,
): InstructionChange[] {
  const prior = new Map(before?.map((file) => [file.path, file]) ?? [])
  const current = new Map(after.files.map((file) => [file.path, file]))
  const changes: InstructionChange[] = []
  const patch = (path: string, before: string | null, after: string | null) => {
    if (before === null && after === null) return null
    const limited = (value: string | null) => (value ?? '').slice(0, 64_000)
    const result = (createPatch(path, limited(before), limited(after), '', '', { context: 3, timeout: 100 })
      ?? '[diff calculation timed out; open the file for full text]').slice(0, 16_000)
    return result + ((before?.length ?? 0) > 64_000 || (after?.length ?? 0) > 64_000 ? '\n[diff truncated; open the file for full text]' : '')
  }
  for (const file of after.files) {
    const old = prior.get(file.path)
    const status = !old ? 'added' : old.canonicalPath !== file.canonicalPath ? 'retargeted' : old.sha256 !== file.sha256 ? 'changed' : null
    if (status) changes.push({ path: file.path, status, beforeCanonical: old?.canonicalPath ?? null, afterCanonical: file.canonicalPath, patch: patch(file.path,
      old?.text == null ? null : redactInstructionText(old.text), file.text == null ? null : redactInstructionText(file.text)) })
  }
  for (const old of prior.values()) if (!current.has(old.path)) {
    changes.push({ path: old.path, status: 'removed', beforeCanonical: old.canonicalPath, afterCanonical: null,
      patch: patch(old.path, old.text == null ? null : redactInstructionText(old.text), null) })
  }
  return changes
}
