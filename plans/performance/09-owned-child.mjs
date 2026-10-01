// Disposable audit child. It never invokes a provider, reads configuration, or makes a network call.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [mode, pidFile] = process.argv.slice(2)
if (mode === 'codex-fail' && process.argv.includes('--version')) { process.stdout.write('synthetic-1\n'); process.exit(0) }
if (mode === 'codex-fail' && process.argv.includes('login')) { process.stdout.write('Logged in\n'); process.exit(0) }
process.on('SIGTERM', () => {})
process.on('SIGHUP', () => {})
const grandchild = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.on('SIGHUP',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' })
writeFileSync(pidFile, JSON.stringify({ child: process.pid, grandchild: grandchild.pid }))
if (mode === 'pty') process.stdout.write('Current session\r\n82% left\r\n')
let buffer = ''
process.stdin.on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.id == null) continue
    if ((mode === 'acp-fail' || mode === 'codex-fail') && message.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'synthetic handshake rejected' } }) + '\n')
      continue
    }
    const result = mode === 'acp'
      ? message.method === 'initialize'
        ? { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: {} } } }
        : message.method === 'session/new'
          ? { sessionId: 'synthetic-acp', configOptions: [] }
          : {}
      : { child: process.pid, grandchild: grandchild.pid }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n')
  }
})
setInterval(() => {}, 1000)
