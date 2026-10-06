// A stand-in ACP agent for the driver's turn-failure test. It opens a session and fails every prompt
// the way the ACP SDK reports a thrown error: code -32603, message `Internal error`, and the agent's
// own message in `data.details`. omp 18.7.0 answers a prompt with no model selected exactly so.
function reply(message) {
  switch (message.method) {
    case 'initialize':
      return { result: { protocolVersion: 1, agentCapabilities: {} } }
    case 'session/new':
      return { result: { sessionId: 'failing-session-id' } }
    case 'session/prompt':
      return { error: { code: -32603, message: 'Internal error', data: { details: 'No model selected.' } } }
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
