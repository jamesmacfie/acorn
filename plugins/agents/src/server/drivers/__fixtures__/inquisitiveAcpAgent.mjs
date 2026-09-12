// A stand-in ACP agent that asks a question and then gives up on the answer, which is the one shape
// the protocol gives no way to hear about: no cancellation signal reaches an elicitation handler, so
// the turn simply ends with the question still parked. Run by the driver's `entry` spawn form, which
// starts it with the test runner's own node binary.
//
// The turn ends on a timer rather than in the same tick as the question, because a real agent is
// blocked on the answer in between, and answering a question that has not been asked yet proves
// nothing.
let nextId = 1

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
}

function reply(message) {
  switch (message.method) {
    case 'initialize':
      return { result: { protocolVersion: 1, agentCapabilities: {} } }
    case 'session/new':
      return { result: { sessionId: 'asking-session' } }
    case 'session/prompt':
      send({
        id: nextId++,
        method: 'elicitation/create',
        params: {
          mode: 'form',
          sessionId: 'asking-session',
          message: 'Which one?',
          requestedSchema: { type: 'object', properties: { pick: { type: 'string', enum: ['first', 'second'] } } },
        },
      })
      setTimeout(() => send({ id: message.id, result: { stopReason: 'end_turn' } }), 50)
      return null
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
    // An answer to the question above, which nothing here is waiting for, and notifications.
    if (!message.method || message.id === undefined) continue
    const answer = reply(message)
    if (answer) send({ id: message.id, ...answer })
  }
})
