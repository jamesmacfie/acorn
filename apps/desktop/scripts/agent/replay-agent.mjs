import { replayFixture } from './replay-fixtures.mjs'

const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let buffered = ''

async function handle(message) {
  if (message.id === undefined) return
  if (message.method === 'initialize') {
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } })
  } else if (message.method === 'session/new') {
    write({ id: message.id, result: { sessionId: 'replay-session' } })
  } else if (message.method === 'session/prompt') {
    const prompt = message.params.prompt.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
    const match = /(?:^|\n)replay (prose|code|tools)(?: (\d+))?(?=\n|$)/.exec(prompt.trim())
    if (!match) {
      write({ id: message.id, error: { code: -32602, message: 'Prompt must be replay prose|code|tools [seed].' } })
      return
    }
    const fixture = replayFixture(match[1], Number(match[2] ?? 1))
    for (const update of fixture.updates) {
      write({ method: 'session/update', params: { sessionId: message.params.sessionId, update } })
      await delay(fixture.delayMs)
    }
    write({ id: message.id, result: { stopReason: 'end_turn' } })
  } else {
    write({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } })
  }
}

process.stdin.on('data', (chunk) => {
  buffered += chunk
  const lines = buffered.split('\n')
  buffered = lines.pop() ?? ''
  for (const line of lines) {
    if (line.trim()) void handle(JSON.parse(line)).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
      process.exitCode = 1
    })
  }
})
