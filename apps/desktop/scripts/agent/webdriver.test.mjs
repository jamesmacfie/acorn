import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderSnapshot, WebDriverClient } from './webdriver.mjs'

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'
const servers = []
const directories = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const calls = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    calls.push({ method: request.method, url: request.url, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null })
    const value = request.url === '/status'
      ? { ready: true }
      : request.url === '/session' && request.method === 'POST'
        ? { sessionId: 'session-1', capabilities: {} }
        : request.url?.endsWith('/execute/sync')
          ? { url: 'app://acorn/', title: 'acorn', text: 'Welcome.', elements: [{ ref: 'e1', role: 'button', name: 'Start', disabled: false }] }
          : request.url?.endsWith('/element')
            ? { [ELEMENT_KEY]: 'element-1' }
          : request.url?.endsWith('/screenshot')
            ? Buffer.from('png').toString('base64')
            : null
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ value }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  servers.push(server)
  return { endpoint: `http://127.0.0.1:${server.address().port}`, calls }
}

describe('WebDriverClient', () => {
  it('creates one session and sends element actions to it', async () => {
    const { endpoint, calls } = await fixture()
    const client = new WebDriverClient(endpoint)
    await client.waitUntilReady()
    expect(await client.createSession()).toBe('session-1')
    const snapshot = await client.snapshot()
    expect(renderSnapshot(snapshot)).toContain('button "Start" [ref=e1]')

    await client.click(await client.resolveElement('e1'))
    await client.fill('element-1', 'hello')
    expect(calls.map((call) => `${call.method} ${call.url}`)).toContain('POST /session/session-1/element/element-1/click')
    expect(calls.at(-1).body).toEqual({ text: 'hello', value: ['h', 'e', 'l', 'l', 'o'] })
  })

  it('writes screenshots returned by the driver', async () => {
    const { endpoint } = await fixture()
    const directory = await mkdtemp(join(tmpdir(), 'acorn-agent-webdriver-'))
    directories.push(directory)
    const client = new WebDriverClient(endpoint, 'session-1')
    const path = join(directory, 'shots', 'one.png')
    await client.screenshot(path)
    expect(await readFile(path, 'utf8')).toBe('png')
  })
})
