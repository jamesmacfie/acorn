// A stand-in ACP agent for the driver's session-resume branch. It advertises `sessionCapabilities.resume`
// and no `loadSession`, the way DeepSeek's ACP server does, and refuses one reserved id with the
// invalid-params code so the same fixture covers both halves of the reconnect. Run by the driver's
// `entry` spawn form, which starts it with the test runner's own node binary.
const UNRESUMABLE = 'unresumable-session-id'

function reply(message) {
  switch (message.method) {
    case 'initialize':
      return { result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } } }
    case 'session/resume':
      return message.params.sessionId === UNRESUMABLE
        ? { error: { code: -32602, message: `Session is not resumable: ${message.params.sessionId}` } }
        : { result: { configOptions: [] } }
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
