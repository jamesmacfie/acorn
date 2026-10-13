// A stand-in for claude-agent-acp's prompt queueing. A prompt reading `hold` waits. A prompt that
// arrives while one waits is taken into that turn the way the adapter hands off: the waiting prompt
// settles first, then the agent answers the new one and settles it.
let waiting = null
const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
const say = (sessionId, text) =>
  write({
    method: 'session/update',
    params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } },
  })

function handle(message) {
  switch (message.method) {
    case 'initialize':
      return write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } })
    case 'session/new':
      return write({ id: message.id, result: { sessionId: 'queueing-session' } })
    case 'session/cancel':
      return undefined
    case 'session/prompt': {
      const text = message.params.prompt[0]?.text ?? ''
      const sessionId = message.params.sessionId
      if (!waiting) {
        say(sessionId, `working:${text}`)
        if (text === 'hold') waiting = message.id
        else write({ id: message.id, result: { stopReason: 'end_turn' } })
        return undefined
      }
      write({ id: waiting, result: { stopReason: 'end_turn' } })
      waiting = null
      say(sessionId, `took:${text}`)
      return write({ id: message.id, result: { stopReason: 'end_turn' } })
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } })
  }
}

let buffered = ''
process.stdin.on('data', (chunk) => {
  buffered += chunk
  const lines = buffered.split('\n')
  buffered = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.id === undefined && message.method !== 'session/cancel') continue
    handle(message)
  }
})
