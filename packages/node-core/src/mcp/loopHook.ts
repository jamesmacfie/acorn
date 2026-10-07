// The harness bridge (docs/managed-agents/loop-hooks.md): a harness's own command hook runs this once
// per tool call. It forwards the hook's input to the Node and prints the reply the Node composed. It
// decides nothing, and it never prints an allow, because the Node never composes one.
//
// The route and the request version come from the command line, so the plugin that installs the hook
// owns its own wire shape and this program names no plugin.
//
// Any failure, a stopped Node included, prints nothing and exits zero. Every bridged harness reads
// that as no decision, so a broken bridge leaves the call to the harness's own checks.
import { apiSend } from './api'

// What a bridged harness sends, bounded the way the route bounds it.
const MAX_INPUT_BYTES = 1024 * 1024

async function readInput(): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_INPUT_BYTES) throw new Error('hook input is too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** `argv` is `<route> <version> <harness> <event>`, such as
 *  `/v1/p/agents/loop-hook agents.loopHook.v1 claude PreToolUse`. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const [route, version, harness, event] = argv
  try {
    if (!route?.startsWith('/v1/p/')) throw new Error('the bridge posts only to a plugin route')
    const input: unknown = JSON.parse(await readInput())
    const result = await apiSend('POST', route, { version, harness, event, input })
    const output = result.ok ? (result.data as { output?: unknown } | null)?.output : ''
    if (typeof output === 'string' && output) process.stdout.write(output)
  } catch {
    // No decision.
  }
  process.exitCode = 0
}
