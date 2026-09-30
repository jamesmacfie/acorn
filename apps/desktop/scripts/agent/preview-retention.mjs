import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { request } from 'node:http'
import { WebDriverClient } from './webdriver.mjs'
import { resolveManifest } from './state.mjs'

// Keep one executor while child views are present: the pinned WebDriver plugin looks up only
// single-webview windows when it begins a request. This trial uses the shipped platform seam.
async function nativeTrial(home, hiddenMs) {
  const preview = window.acorn.preview
  const plugin = window.acorn.webview
  const pluginKey = 'plugin:retention:local:pane'
  const states = new Map()
  const loadingOwners = new Set()
  const completions = new Map()
  const phases = []
  const pause = (milliseconds) => window.__TAURI_INTERNALS__.invoke('webview_trial_delay', { milliseconds })
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  const off = preview.onEvent((state) => {
    states.set(state.taskId, state)
    if (state.loading) loadingOwners.add(state.taskId)
    else if (loadingOwners.delete(state.taskId)) {
      completions.set(state.taskId, (completions.get(state.taskId) ?? 0) + 1)
    }
  })
  const phase = async (name) => phases.push({
    name, at: Date.now(), states: [...states.values()],
    processes: await window.__TAURI_INTERNALS__.invoke('webview_diagnostics'),
  })
  const waitForPage = async (id, path, previousCompletion = 0) => {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const state = states.get(id)
      if (state?.url && new URL(state.url).pathname === path && !state.loading &&
          (completions.get(id) ?? 0) > previousCompletion) return
      await pause(50)
    }
    throw new Error(`Preview ${id} did not finish ${path}`)
  }
  const target = (id, path = '') => `${home}${path}?owner=${id}&seedState=1`
  const present = (id) => {
    preview.setBounds(id, { x: 450, y: 200, width: 650, height: 500 })
    preview.show(id)
  }
  try {
    await phase('before opening')
    check(await preview.ensure('retention-0', target(0)), 'initial ensure failed')
    present('retention-0')
    await waitForPage('retention-0', '/')
    await phase('one active lightweight page')
    for (let index = 0; index < 50; index++) {
      preview.hide('retention-0')
      check(await preview.ensure('retention-0', new URL(target(0)).href), 'same-home return failed')
      present('retention-0')
    }
    await phase('after 50 normalized returns')
    const beforeRedirect = completions.get('retention-0') ?? 0
    preview.load('retention-0', target(0, '/redirect'))
    await waitForPage('retention-0', '/nested', beforeRedirect)
    await phase('after explicit redirect navigation')
    preview.hide('retention-0')
    check(await preview.ensure('retention-0', target(0)), 'redirect return failed')
    check(new URL(states.get('retention-0').url).pathname === '/nested', 'return reset the route')
    present('retention-0')
    await phase('after retained nested-route return')
    for (let index = 1; index <= 5; index++) {
      const path = index === 5 ? '/development' : '/nested'
      check(await preview.ensure(`retention-${index}`, target(index, path)), 'additional owner failed')
      await waitForPage(`retention-${index}`, path)
      present(`retention-${index}`)
    }
    await phase('one active dashboard and five hidden pages')
    preview.hide('retention-5')
    await phase('all six hidden')
    await pause(hiddenMs)
    await phase('after long hidden interval')
    check(await preview.ensure('retention-5', target(5, '/development')), 'dashboard return failed')
    present('retention-5')
    await phase('after dashboard return')
    const beforeChange = completions.get('retention-0') ?? 0
    check(await preview.ensure('retention-0', target(0, '/development')), 'changed home failed')
    await waitForPage('retention-0', '/development', beforeChange)
    await phase('after changed configured home')
    const beforeReload = completions.get('retention-0') ?? 0
    preview.command('retention-0', 'reload')
    await pause(1000)
    await waitForPage('retention-0', '/development', beforeReload)
    await phase('after explicit reload')
    check(await plugin.ensure(pluginKey, target('plugin'), ['localhost']), 'plugin ensure failed')
    check(await plugin.ensure(pluginKey, new URL(target('plugin')).href, ['localhost']), 'plugin reuse failed')
    check(!await plugin.ensure(pluginKey, target('plugin'), []), 'revoked policy was accepted')
    check(await plugin.ensure(pluginKey, target('plugin'), ['localhost']), 'plugin replacement failed')
    plugin.evict(pluginKey)
    // Six retained owners already exist. No silent eviction makes room for the 33rd record.
    for (let index = 6; index < 32; index++) {
      check(await preview.ensure(`retention-${index}`, target(index)), 'capacity reached before 32')
    }
    check(!await preview.ensure('retention-32', target(32)), 'capacity ceiling was bypassed')
    await phase('shared capacity refusal')
    return { phases, hiddenMs }
  } finally {
    plugin.evict(pluginKey)
    preview.evictAll()
    off()
    await pause(1000)
    await phase('after disposal')
  }
}

const [session, home, interval = '360000'] = process.argv.slice(2)
if (!session || !home || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(home)) {
  throw new Error('Usage: preview-retention.mjs SESSION http://localhost:PORT [hidden-milliseconds]')
}
const hiddenMs = Number(interval)
if (!Number.isFinite(hiddenMs) || hiddenMs < 0 || hiddenMs > 600000) {
  throw new Error('Hidden duration must be between 0 and 600000 milliseconds.')
}
const manifest = await resolveManifest(session)
const client = new WebDriverClient(manifest.webdriverEndpoint)
client.sessionId = manifest.webdriverSessionId
await client.request('POST', client.sessionPath('/timeouts'), { script: hiddenMs + 120000 })
// Node fetch has a five-minute header timeout. The long-hidden trial waits longer by design.
const report = await new Promise((resolve, reject) => {
  const body = JSON.stringify({ script: `return (${nativeTrial.toString()})(arguments[0], arguments[1])`, args: [home, hiddenMs] })
  const req = request(new URL(client.sessionPath('/execute/sync'), manifest.webdriverEndpoint), {
    method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  }, (response) => {
    let data = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => { data += chunk })
    response.on('end', () => {
      try {
        const result = JSON.parse(data).value
        if (response.statusCode >= 400) reject(new Error(result?.message ?? 'Native trial failed'))
        else resolve(result)
      } catch (error) { reject(error) }
    })
    response.on('error', reject)
  })
  req.setTimeout(hiddenMs + 120000, () => req.destroy(new Error('Native trial timed out')))
  req.on('error', reject)
  req.end(body)
})
const trace = await (await fetch(`${home}/__report`)).json()
const directory = join(manifest.directory, 'reports')
await mkdir(directory, { recursive: true })
const path = join(directory, 'preview-retention.json')
await writeFile(path, JSON.stringify({ ...report, trace }, null, 2))
const time = (name) => report.phases.find((phase) => phase.name === name).at
const loadsBetween = (from, to, owner) => trace.documents.filter((load) =>
  load.at >= time(from) && load.at < time(to) && new URLSearchParams(load.query).get('owner') === owner).length
if (loadsBetween('before opening', 'after 50 normalized returns', '0') !== 1) {
  throw new Error(`Same-home returns caused additional document loads. Inspect ${path}.`)
}
if (loadsBetween('after explicit redirect navigation', 'after retained nested-route return', '0') !== 0) {
  throw new Error(`Returning reset the redirected document. Inspect ${path}.`)
}
if (loadsBetween('all six hidden', 'after dashboard return', '5') !== 0) {
  throw new Error(`The hidden interval or return caused a document load. Inspect ${path}.`)
}

console.log(JSON.stringify({ path, phases: report.phases.map(({ name, processes }) => ({ name, processCount: processes.length })) }))
