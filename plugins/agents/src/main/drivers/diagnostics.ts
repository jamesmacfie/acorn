const TOKEN_PATTERNS = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b((?:authorization|api[-_ ]?key|token|password|secret)\s*[:=]\s*)\S+/gi,
]

export function safeProviderMessage(
  value: unknown,
  fallback: string,
  secrets: Iterable<string> = [],
): string {
  let message = typeof value === 'string'
    ? value
    : value instanceof Error
      ? value.message
      : fallback
  message = message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  for (const secret of secrets) {
    if (secret.length >= 8) message = message.replaceAll(secret, '<redacted>')
  }
  for (const pattern of TOKEN_PATTERNS) {
    message = message.replace(pattern, (_match, prefix?: string) =>
      prefix ? `${prefix}<redacted>` : '<redacted>')
  }
  const bounded = message.trim().slice(0, 2_000)
  return bounded || fallback
}

export const providerStderrNotice = (provider: string, byteLength: number): string =>
  `${provider} wrote ${byteLength.toLocaleString()} bytes to its diagnostic stream; content was redacted.`
