import { ToolError } from '@acorn/plugin-api/node'
import { DIRECT_MEMORY_TYPES, isValidMemoryName } from './memory'

export type MemoryWrite = {
  name: string
  description: string
  type: typeof DIRECT_MEMORY_TYPES[number]
  body: string
  hash?: string
}

export function validateMemoryWrite(input: MemoryWrite): void {
  if (!isValidMemoryName(input.name) || input.name.toUpperCase() === 'MEMORY') {
    throw new ToolError('bad_request', 'Invalid or reserved memory name.')
  }
  if (!DIRECT_MEMORY_TYPES.includes(input.type)) throw new ToolError('bad_request', 'Invalid memory type.')
  if (!input.description.trim() || input.description.length > 200 || /[\r\n]/.test(input.description)) {
    throw new ToolError('bad_request', 'Description must be one line of at most 200 characters.')
  }
  if (Buffer.byteLength(input.body, 'utf8') > 16_384) throw new ToolError('bad_request', 'Memory body exceeds 16 KiB.')
  const text = `${input.name}\n${input.description}\n${input.body}`
  const checks: [RegExp, string][] = [
    [/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u, 'invisible or bidirectional control characters'],
    [/<\/?\s*(?:system|assistant|developer|user)(?:\s|>|\/)/i, 'role-like tags'],
    [/\b(?:ignore|disregard|override)\b[^\n.]{0,80}\b(?:previous|prior|system|developer)\b[^\n.]{0,40}\binstructions?\b/i, 'an instruction override'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
    [/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{16,}|github_pat_[a-zA-Z0-9_]{16,})\b/, 'a token-shaped secret'],
    [/\b(?:[A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|SECRET_KEY|PASSWORD|CLIENT_SECRET))\s*[:=]\s*["']?[^\s"']{4,}/i, 'a credential assignment'],
  ]
  for (const [pattern, reason] of checks) {
    if (pattern.test(text)) throw new ToolError('bad_request', `Memory refused: ${reason}.`)
  }
}
