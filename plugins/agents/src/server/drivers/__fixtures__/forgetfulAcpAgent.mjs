// A stand-in ACP agent for the driver's session-load fallback test. It speaks just enough of the
// protocol to exercise one branch: it declares the loadSession capability, refuses session/load with
// the protocol's resource-not-found code, and hands out a fresh id from session/new. Run by the
// driver's `entry` spawn form, which starts it with the test runner's own node binary.
function reply(message) {
  switch (message.method) {
    case 'initialize':
      return { result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } }
    case 'session/load':
      return { error: { code: -32002, message: `Resource not found: ${message.params.sessionId}` } }
    case 'session/new':
      return { result: { sessionId: 'fresh-session-id' } }
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
