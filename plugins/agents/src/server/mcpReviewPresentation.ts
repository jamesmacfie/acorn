import { hiddenCharactersIn } from './sessions/instructionCheck'
import { redactInstructionText } from './sessions/instructionAnalysis'

export type McpReviewFinding = { tool: string; category: 'hidden-character' | 'instruction' | 'sensitive-path'; detail: string }

/** The digest uses raw declarations; only this device-facing copy is redacted for display. */
export function presentMcpTools(tools: Record<string, unknown>[], secrets: readonly string[]): Record<string, unknown>[] {
  const redact = (value: unknown): unknown => {
    if (typeof value === 'string') {
      let text = redactInstructionText(value).replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1[redacted]@')
      for (const secret of secrets) if (secret.length >= 8) text = text.replaceAll(secret, '[redacted]')
      return text
    }
    if (Array.isArray(value)) return value.map(redact)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]))
    return value
  }
  return tools.map((tool) => redact(tool) as Record<string, unknown>)
}

export function mcpReviewFindings(tools: Record<string, unknown>[]): McpReviewFinding[] {
  const findings: McpReviewFinding[] = []
  const phrases = /(?:ignore (?:all )?(?:previous|system|developer) instructions|override (?:the )?(?:system|developer)|you must (?:now )?ignore)/i
  const paths = /(?:\.ssh\/|\.aws\/|\.env\b|credentials|private[_ -]?key|api[_ -]?key)/i
  for (const tool of tools) {
    const name = String(tool.name)
    const visit = (value: unknown) => {
      if (findings.length >= 100) return
      if (typeof value === 'string') {
        for (const hidden of hiddenCharactersIn(value, name, 3)) findings.push({ tool: name, category: 'hidden-character', detail: hidden.codePoint })
        if (phrases.test(value)) findings.push({ tool: name, category: 'instruction', detail: 'Instruction override language' })
        if (paths.test(value)) findings.push({ tool: name, category: 'sensitive-path', detail: 'Sensitive path or credential reference' })
      } else if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') Object.values(value).forEach(visit)
    }
    visit(tool)
  }
  return findings.slice(0, 100)
}
