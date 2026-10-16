// The browser's return trip from an MCP server's sign-in page, caught on the person's own machine for
// the length of one sign-in (docs/mcp/sign-in.md). Both shells run it: the desktop
// in its helper, the terminal client in its own process. The address it hands out goes to the node,
// which gives it to the server as the place to send the browser back to.
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const LISTEN_MS = 10 * 60_000

// Static on purpose: the page never echoes the query string, which holds the one-time code.
const PAGE = `<!doctype html><meta charset="utf-8"><title>Acorn</title><body style="font:16px system-ui;margin:3rem">
<p>You're signed in. You can close this tab and go back to Acorn.</p>`

export type OauthCallbackListener = {
  redirectUri: string
  /** The query string the browser arrived with. Rejects on timeout or close. */
  result: Promise<URLSearchParams>
  close(): void
}

/** Opens a one-request listener on 127.0.0.1, on a random port and an unguessable path. Anything else
 *  gets a 404. It closes after the first good request or after ten minutes. */
export async function listenForOauthCallback(timeoutMs = LISTEN_MS): Promise<OauthCallbackListener> {
  const path = `/acorn-oauth/${randomBytes(16).toString('base64url')}`
  let resolve!: (params: URLSearchParams) => void
  let reject!: (error: Error) => void
  const result = new Promise<URLSearchParams>((onResult, onError) => {
    resolve = onResult
    reject = onError
  })
  // Nobody may be waiting when it closes, such as a sign-in cancelled before the browser came back.
  result.catch(() => undefined)

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method !== 'GET' || url.pathname !== path) {
      response.writeHead(404).end()
      return
    }
    response
      .writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      })
      .end(PAGE)
    resolve(url.searchParams)
    close()
  })
  const timer = setTimeout(() => {
    reject(new Error('Nobody came back from the sign-in page within ten minutes.'))
    close()
  }, timeoutMs).unref()
  const close = (): void => {
    clearTimeout(timer)
    reject(new Error('The sign-in listener closed.'))
    server.close()
    server.closeIdleConnections()
  }

  await new Promise<void>((ready, failed) => {
    server.once('error', failed)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', failed)
      ready()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    close()
    throw new Error('The sign-in listener could not bind a loopback port.')
  }
  return { redirectUri: `http://127.0.0.1:${address.port}${path}`, result, close }
}
