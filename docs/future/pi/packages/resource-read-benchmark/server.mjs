#!/usr/bin/env node
// A stdio MCP server that stands in for acorn's in one of the phase 08 experiment modes. It lists
// the tools a development node advertised on 2026-10-07 (tools.json) and, when the mode asks for
// them, the resource aliases the phase 08 design proposes. Tool calls and resource reads answer
// from fixture.json, so no acorn node, task, or provider is touched.
//
//   node server.mjs tools | tools-and-resources | resources-and-write-tools
//
// MCP over stdio is newline-delimited JSON-RPC, so this needs no SDK and runs from any folder.
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const here = new URL('.', import.meta.url)
const tools = JSON.parse(readFileSync(new URL('tools.json', here), 'utf8'))
const fixture = JSON.parse(readFileSync(new URL('fixture.json', here), 'utf8'))
const mode = process.argv[2] ?? 'tools'
if (!['tools', 'tools-and-resources', 'resources-and-write-tools'].includes(mode)) throw new Error(`unknown mode ${mode}`)

// Each alias names the tool whose handler it shares. agent_read is left out: the registry marks it
// `execute`, not `read`, so it isn't eligible.
const fixed = {
  'task://': 'task_current',
  'task://context': 'task_context',
  'pr://': 'pr_current',
  'pr://files': 'pr_changed_files',
  'pr://checks': 'pr_checks',
  'pr://comments': 'pr_review_comments',
  'changes://': 'local_changes',
}
const templates = {
  'issue://{kind}/{id}': 'issue_detail',
  'changes://{path}': 'local_diff',
  'memory://{name}': 'memory_get',
  'notes://{kind}': 'notes_read',
}
const aliased = new Set([...Object.values(fixed), ...Object.values(templates)])
const withResources = mode !== 'tools'
const description = (tool) => tools.find((t) => t.name === tool).description

const listedTools = () =>
  tools
    .filter((t) => mode !== 'resources-and-write-tools' || !aliased.has(t.name))
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))

function read(uri) {
  if (fixed[uri]) return fixture.tools[fixed[uri]]
  const [, scheme, rest] = /^([a-z]+):\/\/(.+)$/.exec(uri) ?? []
  if (scheme === 'issue') return fixture.issues[rest]
  if (scheme === 'changes') return fixture.diffs[decodeURIComponent(rest)]
  if (scheme === 'memory') return fixture.memories[decodeURIComponent(rest)]
  if (scheme === 'notes') return fixture.notes[rest]
  return undefined
}

function callTool({ name, arguments: args = {} }) {
  if (!listedTools().some((t) => t.name === name)) return { isError: true, content: [{ type: 'text', text: `unknown tool ${name}` }] }
  const keyed = { issue_detail: args.identifier && fixture.issues[`${args.provider ?? 'linear'}.issue/${args.identifier}`], local_diff: fixture.diffs[args.path], memory_get: fixture.memories[args.name], notes_read: fixture.notes[args.kind] }
  const value = name in keyed ? keyed[name] : fixture.tools[name]
  return { content: [{ type: 'text', text: JSON.stringify(value ?? { status: 'not-found' }, null, 2) }] }
}

const handlers = {
  initialize: () => ({
    protocolVersion: '2025-06-18',
    serverInfo: { name: 'acorn', version: '1.0.0' },
    capabilities: { tools: { listChanged: true }, ...(withResources ? { resources: {} } : {}) },
  }),
  'tools/list': () => ({ tools: listedTools() }),
  'tools/call': callTool,
  'resources/list': () => ({
    resources: withResources ? Object.entries(fixed).map(([uri, tool]) => ({ uri, name: tool, description: description(tool), mimeType: 'application/json' })) : [],
  }),
  'resources/templates/list': () => ({
    resourceTemplates: withResources ? Object.entries(templates).map(([uriTemplate, tool]) => ({ uriTemplate, name: tool, description: description(tool), mimeType: 'application/json' })) : [],
  }),
  'resources/read': ({ uri }) => {
    const value = withResources ? read(uri) : undefined
    if (value === undefined) throw Object.assign(new Error(`Resource not found: ${uri}`), { code: -32002 })
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }] }
  },
  ping: () => ({}),
}

const log = process.env.FIXTURE_LOG
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return
  const { id, method, params } = JSON.parse(line)
  if (log) (await import('node:fs')).appendFileSync(log, `${JSON.stringify({ mode, method, params })}\n`)
  if (id === undefined) return
  const handler = handlers[method]
  if (!handler) return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  try {
    send({ jsonrpc: '2.0', id, result: handler(params ?? {}) })
  } catch (error) {
    send({ jsonrpc: '2.0', id, error: { code: error.code ?? -32603, message: error.message } })
  }
})
