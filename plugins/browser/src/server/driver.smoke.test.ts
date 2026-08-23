import { describe, expect, it } from 'vitest'
import { BrowserPool } from './driver'

// The snapshot-act-verify loop, against a real browser (docs/future/tauri/webviews-and-frames.md
// § Exit criteria). This is the check the Electron-era `scripts/smoke-browser.cjs` used to be, moved
// here with its subject and turned from a script into a test, because the driver is plain TypeScript
// now rather than something only an Electron main process could load.
//
// Opt-in, because it launches a real browser: `pnpm --filter @acorn/plugin-browser test:smoke`. The
// default suite covers the pure layer (./axTree.test.ts) and the store (./captures.test.ts); this is
// the only check that exercises the Playwright glue between them, and it is not something to make
// every `pnpm test` pay for. It also tolerates a machine with no Chrome, asserting the tools said so
// rather than failing the build, which is the other half of the exit criterion.

const PAGE = `data:text/html,${encodeURIComponent(`
<!doctype html><html><body>
  <label>Email <input id="email" aria-label="Email"></label>
  <button id="go" onclick="console.log('clicked:' + document.getElementById('email').value)">Sign in</button>
</body></html>`)}`

// data: is not http(s), so the driver's own guard refuses it — correctly. The page is served over
// loopback instead, which is also closer to what the tools actually meet.
const serve = async (): Promise<{ url: string; close: () => Promise<void> }> => {
  const { createServer } = await import('node:http')
  const html = decodeURIComponent(PAGE.slice('data:text/html,'.length))
  const server = createServer((_request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end(html))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((done) => server.close(() => done())) }
}

const captures: { id: string; bytes: number }[] = []
const store = {
  put: async ({ bytes }: { bytes: Buffer }) => {
    const id = `capture-${captures.length}`
    captures.push({ id, bytes: bytes.byteLength })
    return { id }
  },
}

describe.skipIf(!process.env.ACORN_BROWSER_SMOKE)('the agent browser, end to end', () => {
  it('snapshots, fills, clicks, and reads the console back', { timeout: 60_000 }, async () => {
    const pool = new BrowserPool(store)
    const page = await serve()
    try {
      const opened = await pool.navigate('task-1', page.url)
      if (!opened.ok) {
        // No browser on this machine. The tool reported why, which is the other half of the exit
        // criterion, so assert that much and stop.
        expect(opened.reason).toMatch(/Chrome|Chromium|browser/i)
        return
      }

      const snapshot = await pool.snapshot('task-1')
      expect(snapshot).not.toHaveProperty('error')
      const { text } = snapshot as { text: string }
      // Refs are what an agent acts through, so the snapshot has to carry them.
      const emailRef = /- textbox "Email".*?\[(e\d+)\]/.exec(text)?.[1]
      const buttonRef = /- button "Sign in".*?\[(e\d+)\]/.exec(text)?.[1]
      expect({ emailRef, buttonRef }).toEqual({ emailRef: expect.any(String), buttonRef: expect.any(String) })

      expect(await pool.fill('task-1', emailRef!, 'someone@example.test')).toEqual({ ok: true })
      expect(await pool.click('task-1', buttonRef!)).toEqual({ ok: true })

      // The page logs what it read out of the input, so this asserts the fill landed as a real value
      // the page's own script could see, not just as a DOM attribute.
      await expect.poll(async () => (await pool.console('task-1')).lines.join('\n'), { timeout: 5_000 }).toContain(
        'clicked:someone@example.test',
      )

      const shot = await pool.screenshot('task-1')
      expect(shot).toMatchObject({ captureId: 'capture-0', url: '/v2/p/browser/captures/capture-0' })
      expect(captures[0].bytes).toBeGreaterThan(0)
    } finally {
      await pool.dispose()
      await page.close()
    }
  })
})
