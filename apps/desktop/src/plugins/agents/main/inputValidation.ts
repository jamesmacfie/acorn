import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { AgentInputPart } from '@acorn/protocol/managedAgents.ts'
import { MAX_AGENT_CONTEXT_BYTES } from '@acorn/protocol/agentContext.ts'

export const MAX_AGENT_INPUT_BYTES = 2 * 1024 * 1024
export const MAX_AGENT_CONFIG_BYTES = 256 * 1024
export const MAX_AGENT_POLICY_BYTES = 64 * 1024
export const MAX_AGENT_RESOLUTION_BYTES = 256 * 1024

export function assertBoundedJson(label: string, value: unknown, maxBytes: number): void {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error(`${label} must be JSON serializable.`)
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new Error(`${label} exceeds the ${Math.floor(maxBytes / 1024)} KiB limit.`)
  }
}

export async function validateAgentInputFiles(cwd: string, input: AgentInputPart[]): Promise<void> {
  assertBoundedJson('Agent turn input', input, MAX_AGENT_INPUT_BYTES)
  const contextBytes = input.reduce((total, part) =>
    part.type === 'context' ? total + Buffer.byteLength(part.content, 'utf8') : total, 0)
  if (contextBytes > MAX_AGENT_CONTEXT_BYTES) {
    throw new Error('Acorn context snapshots are limited to 512 KiB per turn.')
  }
  const root = await realpath(cwd)
  for (const part of input) {
    if (part.type !== 'file') continue
    if (isAbsolute(part.path)) throw new Error(`File mentions must be relative to the task worktree: ${part.path}`)
    const candidate = resolve(root, part.path)
    const lexicalRelative = relative(root, candidate)
    if (lexicalRelative === '..' || lexicalRelative.startsWith('../') || isAbsolute(lexicalRelative)) {
      throw new Error(`File mention escapes the task worktree: ${part.path}`)
    }
    let resolved: string
    try {
      resolved = await realpath(candidate)
    } catch {
      throw new Error(`Mentioned file does not exist in the task worktree: ${part.path}`)
    }
    const resolvedRelative = relative(root, resolved)
    if (resolvedRelative === '..' || resolvedRelative.startsWith('../') || isAbsolute(resolvedRelative)) {
      throw new Error(`Mentioned file resolves outside the task worktree: ${part.path}`)
    }
    if (!(await stat(resolved)).isFile()) throw new Error(`Mentioned path is not a file: ${part.path}`)
    if (part.lineStart && part.lineEnd && part.lineEnd < part.lineStart) {
      throw new Error(`File mention has an invalid line range: ${part.path}`)
    }
  }
}
