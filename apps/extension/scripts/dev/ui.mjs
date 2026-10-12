import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { processIsAlive, readJson, runningManifest } from './state.mjs'

// `pnpm dev:extension:ui -- [--session NAME] VERB [ARGS]`
//
// Drives the sidebar page of a running `pnpm dev:extension` session through the browser's automation
// endpoint: CDP for Chrome, WebDriver BiDi for Firefox. The sidebar page is opened in a tab, where
// it has the same extension APIs as the panel. Opening the panel itself needs a toolbar click, which
// only a person can make.
//
//   open                 open the sidebar page in a tab, or reuse the open one
//   text                 print the sidebar's visible text
//   click TEXT           click the button whose text is TEXT
//   fill NAME VALUE      type VALUE into the input named NAME
//   check NAME           toggle the checkbox named NAME
//   eval EXPRESSION      evaluate EXPRESSION in the sidebar and print the result
//   pairing-code         ask the session's own Node for a fresh pairing code
//   stop                 stop the session

const argv = process.argv.slice(2).filter((arg) => arg !== '--')
let sessionName = null
if (argv[0] === '--session') {
  sessionName = argv[1]
  argv.splice(0, 2)
}
const [verb, ...rest] = argv

// Page-side helpers. Element actions dispatch the events Solid listens for.
const actions = {
  text: () => 'document.body.innerText',
  click: (text) =>
    `(() => { const target = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); if (!target) throw new Error('No button reads ' + ${JSON.stringify(text)}); target.click(); return 'clicked' })()`,
  fill: (name, value) =>
    `(() => { const input = document.querySelector('input[name=' + ${JSON.stringify(JSON.stringify(name))} + ']'); if (!input) throw new Error('No input is named ' + ${JSON.stringify(name)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); return 'filled' })()`,
  check: (name) =>
    `(() => { const input = document.querySelector('input[name=' + ${JSON.stringify(JSON.stringify(name))} + ']'); if (!input) throw new Error('No checkbox is named ' + ${JSON.stringify(name)}); input.click(); return input.checked })()`,
  eval: (expression) => expression,
}

async function chromeSidebar(manifest, open) {
  const endpoint = manifest.automation.endpoint
  const targets = await (await fetch(`${endpoint}/json/list`)).json()
  let target = targets.find((candidate) => candidate.type === 'page' && candidate.url.startsWith(manifest.extension.sidebarUrl))
  if (!target && open)
    target = await (await fetch(`${endpoint}/json/new?${encodeURI(manifest.extension.sidebarUrl)}`, { method: 'PUT' })).json()
  if (!target) throw new Error('The sidebar page is not open. Run open first.')
  return {
    async evaluate(expression) {
      const socket = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        socket.onopen = resolve
        socket.onerror = () => reject(new Error('Could not reach the sidebar page.'))
      })
      try {
        const reply = await new Promise((resolve) => {
          socket.onmessage = (event) => resolve(JSON.parse(event.data))
          socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
        })
        if (reply.result?.exceptionDetails)
          throw new Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text)
        return reply.result?.result?.value
      } finally {
        socket.close()
      }
    },
  }
}

// One BiDi session per command, always ended: Firefox allows a single session, and one left open
// refuses every later connection until the browser restarts.
async function firefoxSidebar(manifest, open) {
  const socket = new WebSocket(manifest.automation.endpoint)
  let next = 0
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  }
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error('Could not reach Firefox.'))
  })
  const send = async (method, params) => {
    const id = ++next
    const reply = await new Promise((resolve) => {
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })
    if (reply.type === 'error') throw new Error(`${method}: ${reply.message}`)
    return reply.result
  }
  await send('session.new', { capabilities: {} })
  const close = async () => {
    await send('session.end', {}).catch(() => {})
    socket.close()
  }
  try {
    const { contexts } = await send('browsingContext.getTree', { maxDepth: 0 })
    let context = contexts.find((candidate) => candidate.url.startsWith(manifest.extension.sidebarUrl))?.context
    if (!context && open) {
      context = (await send('browsingContext.create', { type: 'tab' })).context
      await send('browsingContext.navigate', { context, url: manifest.extension.sidebarUrl, wait: 'complete' })
    }
    if (!context) throw new Error('The sidebar page is not open. Run open first.')
    return {
      async evaluate(expression) {
        const result = await send('script.evaluate', {
          target: { context },
          expression,
          awaitPromise: true,
          resultOwnership: 'none',
        })
        if (result.type === 'exception') throw new Error(result.exceptionDetails.text)
        return unwrapBidi(result.result)
      },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}

const unwrapBidi = (value) =>
  value.type === 'array'
    ? value.value.map(unwrapBidi)
    : value.type === 'object'
      ? Object.fromEntries(value.value.map(([key, entry]) => [key, unwrapBidi(entry)]))
      : value.value

async function pairingCode(manifest) {
  if (!manifest.node?.pid) throw new Error('This session uses an outside Node. Get a code from that Node.')
  const logFile = join(manifest.logs, 'node.log')
  const before = readFileSync(logFile, 'utf8').length
  process.kill(manifest.node.pid, 'SIGUSR1')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const code = /Pairing code\s+(\S+)/.exec(readFileSync(logFile, 'utf8').slice(before))?.[1]
    if (code) return code
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('The Node printed no pairing code. See logs/node.log.')
}

async function stopSession(manifest) {
  process.kill(manifest.launcherPid, 'SIGTERM')
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && processIsAlive(manifest.launcherPid))
    await new Promise((resolve) => setTimeout(resolve, 250))
  const after = await readJson(join(manifest.directory, 'session.json'))
  return `session ${manifest.name} is ${after.status}`
}

async function main() {
  if (!verb) throw new Error('Pass a verb: open, text, click, fill, check, eval, pairing-code, or stop.')
  const manifest = await runningManifest(sessionName)
  if (verb === 'stop') return stopSession(manifest)
  if (verb === 'pairing-code') return pairingCode(manifest)
  if (verb !== 'open' && !actions[verb]) throw new Error(`Unknown verb ${verb}.`)
  const sidebar = await (manifest.browser === 'chrome' ? chromeSidebar : firefoxSidebar)(manifest, verb === 'open')
  try {
    if (verb === 'open') {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return sidebar.evaluate(actions.text())
    }
    return await sidebar.evaluate(actions[verb](...rest))
  } finally {
    await sidebar.close?.()
  }
}

main().then(
  (result) => {
    if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
  },
  (error) => {
    console.error(error.message)
    process.exitCode = 1
  },
)
