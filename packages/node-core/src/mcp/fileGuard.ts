// The file guard (docs/managed-agents/read-block.md § Claude's own file tools): a harness runs this
// before each of its own file tool calls, which run outside its shell sandbox. It decides here, from the
// policy on its command line, and never asks the Node, so it works while the Node is down.
//
// It checks the real path of every target, including a file that doesn't exist yet, against the
// session's allowlist. Rules written at start only cover the entries that existed then, so a `.env`
// created later in the data root would have none.
//
// Unlike the loop hook bridge, it fails closed. Claude Code reads exit code 2 as a refusal, so bad input
// or an internal error refuses the call. The harness runs it only for its file tools.
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

export type FileGuardPolicy = {
  /** The data root, in every spelling the Node knows, and the client folders (`clientCustodyDirs`). */
  dataDir: string[]
  /** What the file tools may read inside the data root. */
  read: string[]
  /** What they may write inside the data root. */
  write: string[]
  /** What they may never write, inside the data root or not. */
  writeDenied: string[]
}

export type FileToolCall = { tool_name?: unknown; tool_input?: unknown; cwd?: unknown }

const READ_TOOLS = new Set(['Read', 'NotebookRead', 'LS'])
const SEARCH_TOOLS = new Set(['Glob', 'Grep'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
/** The `matcher` a harness's hook entry uses, so the guard runs for exactly the tools it understands. */
export const FILE_GUARD_MATCHER = [...READ_TOOLS, ...SEARCH_TOOLS, ...WRITE_TOOLS].join('|')

export const encodeFileGuardPolicy = (policy: FileGuardPolicy): string =>
  Buffer.from(JSON.stringify(policy)).toString('base64url')

const within = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

/** The path with every link resolved. A path that doesn't exist yet resolves through its nearest
 *  existing folder, so a new file is judged by where it would land. */
function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(canonicalPath(parent), basename(path))
  }
}

// A glob's folder part, which is what decides where Glob looks: `/a/b/**/*.ts` searches `/a/b`.
const globRoot = (pattern: string): string => {
  const parts = pattern.split('/')
  const literal = parts.findIndex((part) => /[*?[\]{}]/.test(part))
  return (literal === -1 ? parts : parts.slice(0, literal)).join('/') || '/'
}

/** The paths a call touches, absolute. */
function targets(call: FileToolCall): string[] {
  const input = (call.tool_input && typeof call.tool_input === 'object' ? call.tool_input : {}) as Record<
    string,
    unknown
  >
  const cwd = typeof call.cwd === 'string' && isAbsolute(call.cwd) ? call.cwd : process.cwd()
  const named = [input.file_path, input.notebook_path, input.path].filter(
    (value): value is string => typeof value === 'string' && !!value,
  )
  if (SEARCH_TOOLS.has(String(call.tool_name)) && !named.length) named.push(cwd)
  if (call.tool_name === 'Glob' && typeof input.pattern === 'string' && isAbsolute(input.pattern))
    named.push(globRoot(input.pattern))
  return named.map((path) => resolve(cwd, path))
}

/** Why the call is refused, or null when it may go ahead. */
export function fileToolRefusal(policy: FileGuardPolicy, call: FileToolCall): string | null {
  const tool = String(call.tool_name)
  const writes = WRITE_TOOLS.has(tool)
  if (!writes && !READ_TOOLS.has(tool) && !SEARCH_TOOLS.has(tool)) return `${tool} isn't a file tool this guard knows.`
  // Every root in both spellings, because a policy path may itself pass through a link.
  const roots = (paths: string[]) => [...new Set(paths.flatMap((path) => [resolve(path), canonicalPath(path)]))]
  const dataDir = roots(policy.dataDir)
  const allowed = roots(writes ? policy.write : policy.read)
  const denied = roots(policy.writeDenied)
  for (const target of targets(call)) {
    const real = canonicalPath(target)
    for (const path of new Set([target, real])) {
      if (writes && denied.some((root) => within(path, root)))
        return `${target} is a git file this session may not write.`
      if (dataDir.some((root) => within(path, root)) && !allowed.some((root) => within(path, root))) {
        return `${target} is in Acorn's data folder, outside what this session may ${writes ? 'write' : 'read'}.`
      }
      if (SEARCH_TOOLS.has(tool) && dataDir.some((root) => within(root, path))) {
        return `A search of ${target} would include Acorn's data folder.`
      }
    }
  }
  return null
}

const MAX_INPUT_BYTES = 1024 * 1024

async function readInput(): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_INPUT_BYTES) throw new Error('The hook input is too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** `argv` is the encoded policy. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  let refusal: string | null
  try {
    const policy = JSON.parse(Buffer.from(argv[0] ?? '', 'base64url').toString('utf8')) as FileGuardPolicy
    refusal = fileToolRefusal(policy, JSON.parse(await readInput()) as FileToolCall)
  } catch (error) {
    refusal = `Acorn's file guard couldn't check this call: ${error instanceof Error ? error.message : String(error)}`
  }
  if (refusal) process.stderr.write(`${refusal}\n`)
  process.exitCode = refusal ? 2 : 0
}
