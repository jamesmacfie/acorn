import { createHash } from 'node:crypto'

// A catalogue is untrusted server output. Keep the full declaration, including extension fields,
// because a harness may forward fields this version of acorn does not know by name.
const MAX_CATALOGUE_BYTES = 256 * 1024
const MAX_TOOLS = 256
const MAX_DEPTH = 32
export const MCP_CATALOGUE_VERSION = 1

function canonical(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) throw new Error('The MCP catalogue is too deeply nested.')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry, depth + 1)).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        if (record[key] === undefined) throw new Error('The MCP catalogue contains an undefined field.')
        return `${JSON.stringify(key)}:${canonical(record[key], depth + 1)}`
      })
      .join(',')}}`
  }
  throw new Error('The MCP catalogue contains an unsupported value.')
}

export type McpCatalogue = {
  version: typeof MCP_CATALOGUE_VERSION
  digest: string
  tools: Record<string, unknown>[]
}

export function mcpCatalogue(tools: unknown[]): McpCatalogue {
  if (tools.length > MAX_TOOLS) throw new Error('The MCP server offers too many tools.')
  const names = new Set<string>()
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool))
      throw new Error('The MCP server returned an invalid tool.')
    const name = (tool as Record<string, unknown>).name
    if (typeof name !== 'string' || !name || names.has(name))
      throw new Error('The MCP server returned a missing or duplicate tool name.')
    names.add(name)
  }
  const bytes = canonical(tools, 0)
  if (Buffer.byteLength(bytes) > MAX_CATALOGUE_BYTES) throw new Error('The MCP catalogue is too large.')
  return {
    version: MCP_CATALOGUE_VERSION,
    digest: createHash('sha256').update(bytes).digest('hex'),
    tools: tools as Record<string, unknown>[],
  }
}
