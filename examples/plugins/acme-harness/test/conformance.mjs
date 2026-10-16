// Checks each harness in ../acorn-plugin.json the way acorn will run it, before you install the plugin:
// it starts the `spawn` command, speaks the Agent Client Protocol to it, and sends one prompt, then runs
// the `oneShot` command once. Run it from the plugin folder, with your agent's command line on PATH:
//
//   node test/conformance.mjs
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'

const PROMPT = 'Reply with one word.'
const manifest = JSON.parse(readFileSync(new URL('../acorn-plugin.json', import.meta.url), 'utf8'))

for (const harness of manifest.contributions.harnesses) {
  await checkSession(harness)
  checkOneShot(harness)
}

// #region session
/** The calls acorn makes when the person starts a session: initialize, a new session, one prompt. */
async function checkSession(harness) {
  const child = spawn(harness.spawn.command, harness.spawn.args, { stdio: ['pipe', 'pipe', 'inherit'] })
  const waiting = new Map()
  const said = []
  let next = 0
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method === 'session/update' && message.params.update.sessionUpdate === 'agent_message_chunk') {
      said.push(message.params.update.content.text ?? '')
    } else if (message.method && message.id !== undefined) {
      // A request from the agent, such as a permission prompt. acorn would ask the person.
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Not in this check' } })}\n`)
    } else if (waiting.has(message.id)) {
      waiting.get(message.id)(message)
    }
  })
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++next
      const timer = setTimeout(() => reject(new Error(`${method} got no answer in 60 seconds`)), 60_000)
      waiting.set(id, (message) => {
        clearTimeout(timer)
        if (message.error) reject(new Error(`${method}: ${message.error.message}`))
        else resolve(message.result)
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  try {
    // acorn declines the file system and terminal capabilities, so the agent must work without them.
    const ready = await call('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    })
    const { sessionId } = await call('session/new', { cwd: tmpdir(), mcpServers: [] })
    const { stopReason } = await call('session/prompt', { sessionId, prompt: [{ type: 'text', text: PROMPT }] })
    console.log(`ok ${harness.label}: protocol ${ready.protocolVersion}, said "${said.join('').trim()}", stopped: ${stopReason}`)
  } finally {
    child.kill()
  }
}
// #endregion

// #region one-shot
/** What a Generate control runs: your args, then the prompt, in an empty folder. Stdout is the answer. */
function checkOneShot(harness) {
  if (!harness.oneShot) return
  const command = harness.oneShot.command ?? harness.terminal.command
  const answer = execFileSync(command, [...harness.oneShot.args, PROMPT], { cwd: tmpdir(), encoding: 'utf8', timeout: 60_000 })
  console.log(`ok ${harness.label} one-shot: "${answer.trim()}"`)
}
// #endregion
