import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { CliError } from './error'
import type { CliNode } from './node'

export function requestKey(value?: string): string {
  if (!value) return randomUUID()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new CliError('usage', '--request-id must be a UUID.', 2)
  }
  return value.toLowerCase()
}

export function operationKey(requestId: string, step: string): string {
  const hex = createHash('sha256').update(`${requestId}:${step}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export async function readBounded(file: string, maxBytes: number): Promise<string> {
  const parts: Buffer[] = []
  let length = 0
  try {
    for await (const part of file === '-' ? process.stdin : createReadStream(file)) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part)
      length += chunk.length
      if (length > maxBytes) throw new CliError('input_too_large', `Input exceeds ${maxBytes} bytes.`, 2)
      parts.push(chunk)
    }
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError('input_error', `Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`, 2)
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)) }
  catch { throw new CliError('invalid_input', `${file} must be UTF-8 text.`, 2) }
}

export async function readJsonFile(file: string, maxBytes = 1_000_000): Promise<unknown> {
  try { return JSON.parse(await readBounded(file, maxBytes)) }
  catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError('invalid_json', `Invalid JSON in ${file}.`, 2)
  }
}

export async function typedId(value: string | undefined, kind: string, node: CliNode, option: string): Promise<string> {
  if (!value) throw new CliError('usage', `--${option} needs an ID.`, 2)
  if (value !== '-') return value
  const resource = await readJsonFile('-', 100_000) as Record<string, unknown>
  if (!resource || resource.apiVersion !== 'acorn.cli/v1' || resource.kind !== kind || resource.nodeId !== node.nodeId || typeof resource.id !== 'string' || !resource.id) {
    throw new CliError('invalid_pipe', `--${option} requires one ${kind} resource from Node ${node.nodeId}.`, 2)
  }
  return resource.id
}

export function requireOption(options: Record<string, string>, key: string): string {
  const value = options[key]
  if (!value) throw new CliError('usage', `--${key} is required.`, 2)
  return value
}

export function rejectDoubleStdin(values: (string | undefined)[]): void {
  if (values.filter((value) => value === '-').length > 1) throw new CliError('usage', 'This command would read stdin twice. Use a file for one input.', 2)
}
