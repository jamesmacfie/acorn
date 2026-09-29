// A stand-in ACP agent that says back the first block of every prompt it is sent, so a test can see
// what the driver put in front of the reader's words. It offers `session/resume`, so the same fixture
// covers a fresh session and one picked back up.
function reply(message) {
  switch (message.method) {
    case 'initialize':
      return { result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } } }
    case 'session/resume':
      return { result: { configOptions: [] } }
    case 'session/new':
      return { result: { sessionId: 'fresh-session-id' } }
    case 'session/prompt': {
      const first = message.params.prompt[0]
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: message.params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `echo:${first?.text ?? ''}` } },
        },
      })}\n`)
      return { result: { stopReason: 'end_turn' } }
    }
    default:
      return { error: { code: -32601, message: `Method not found: ${message.method}` } }
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
    if (message.id === undefined) continue
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, ...reply(message) })}\n`)
  }
})
