import type { FindingEvidence, FindingObservation, FindingOrigin } from '../contract/records'

const REVIEW_INPUT_KIND = 'findings:review-input'
const STREAM_FRAGMENT_MINIMUM = 12

const plainText = (value: string): string => value
  .replace(/```[\s\S]*?```/g, ' code sample ')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[`*_>#]/g, '')
  .replace(/^\s*[-+]\s+/gm, '')
  .replace(/\s+/g, ' ')
  .replace(/\b([A-Za-z]+)\s+('(ll|re|ve|d|m|s|t))\b/g, '$1$2')
  .trim()

const fragmentedStream = (body: string): boolean => {
  const fragments = body.split('\n\n').map((part) => part.trim()).filter(Boolean)
  if (fragments.length < STREAM_FRAGMENT_MINIMUM) return false
  const averageLength = fragments.reduce((total, part) => total + part.length, 0) / fragments.length
  return averageLength < 64
}

/**
 * Older agent review inputs joined every streamed delta as if it were a complete message. The rows
 * are immutable, so repair only their presentation: compact the fragmented assistant portion while
 * leaving the separately captured user message intact. New rows retain their Markdown structure.
 */
export function findingBody(finding: FindingObservation): { markdown: string; repaired: boolean } {
  if (finding.kind.id !== REVIEW_INPUT_KIND || !fragmentedStream(finding.body)) {
    return { markdown: finding.body, repaired: false }
  }
  const marker = '\n\nUser message:\n'
  const at = finding.body.lastIndexOf(marker)
  const response = at < 0 ? finding.body : finding.body.slice(0, at)
  const userMessage = at < 0 ? '' : finding.body.slice(at + marker.length).trim()
  return {
    markdown: [plainText(response), userMessage ? `---\n\n**User message**\n\n${userMessage}` : '']
      .filter(Boolean)
      .join('\n\n'),
    repaired: true,
  }
}

export function findingExcerpt(finding: FindingObservation, limit = 150): string {
  const body = findingBody(finding)
  const summary = body.repaired ? body.markdown.split('\n\n---\n\n', 1)[0]! : body.markdown
  const text = plainText(summary)
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`
}

export function findingOriginLabel(origin: FindingOrigin): string {
  switch (origin.kind) {
    case 'agent': return `Agent run${origin.attempt ? ` · attempt ${origin.attempt}` : ''}`
    case 'workflow': return origin.stepId ? 'Workflow step' : 'Workflow run'
    case 'schedule': return 'Scheduled run'
    case 'device': return 'Recorded on this device'
    case 'plugin': return `Plugin · ${origin.pluginId}`
    case 'legacy': return 'Imported legacy proposal'
  }
}

export function evidenceLabel(evidence: FindingEvidence): string {
  if (evidence.label) return evidence.label
  switch (evidence.kind) {
    case 'repository': return evidence.path
    case 'url': return evidence.url
    case 'managed-turn': return 'Agent turn'
    case 'workflow-step': return evidence.stepId ? 'Workflow step' : 'Workflow run'
    case 'observation': return 'Related finding'
    case 'memory-version': return 'Memory version'
  }
}

export function findingTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export const findingClaimLabel = (status: FindingObservation['claimStatus']): string =>
  status === 'asked' ? 'Question' : status === 'inferred' ? 'Inferred' : 'Observed'
