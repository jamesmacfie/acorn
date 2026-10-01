// Disposable protocol fixture. Reports only owned PIDs and synthetic messages.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const [mode, pidFile] = process.argv.slice(2)
if (process.argv.includes('--version') || process.argv.includes('login')) {
  process.stdout.write('synthetic logged in\n')
  process.exit(0)
}
process.on('SIGTERM', () => { if (mode === 'parent-exit') process.exit(0) })
process.on('SIGHUP', () => {})
const grandchild = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.on('SIGHUP',()=>{});process.send('ready');setInterval(()=>{},1000)"], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
let ready
const started = new Promise(resolve => { ready = resolve })
grandchild.once('message', () => {
  grandchild.disconnect()
  writeFileSync(pidFile, JSON.stringify({ child: process.pid, grandchild: grandchild.pid }))
  ready()
  if (mode.startsWith('pty')) process.stdout.write('Current session\r\n82% left\r\n')
})
let buffer = ''
process.stdin.on('data', async chunk => {
  await started
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.id == null) continue
    if (mode.endsWith('hold') && message.method === 'initialize') continue
    if (mode.endsWith('fail') && message.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'synthetic handshake rejected' } }) + '\n')
      continue
    }
    if (mode.endsWith('close') && ['session/close', 'thread/unsubscribe'].includes(message.method)) continue
    if (mode === 'acp-disconnect' && message.method === 'session/prompt') { process.stdout.end(); continue }
    if (message.method === 'overflow') { process.stdout.write('x'.repeat(4096)); continue }
    if (message.method === 'disconnect') { process.stdout.end(); continue }
    const result = message.method === 'initialize'
      ? { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: {} } } }
      : message.method === 'session/new' ? { sessionId: 'synthetic-acp', configOptions: [] }
      : message.method === 'thread/start' ? { thread: { id: 'synthetic-codex' } }
      : { child: process.pid, grandchild: grandchild.pid }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n')
  }
})
setInterval(() => {}, 1000)
