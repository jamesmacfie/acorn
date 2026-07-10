// Drivable-browser smoke (docs/testing.md): run under Electron —
//   pnpm exec electron scripts/smoke-browser.cjs
// Loads a data: page with a button + input, then drives it through the REAL CDP path
// (webContents.debugger): snapshot → fill → click → console assert. Exit code = pass/fail.
// Uses no native modules, so it needs no ABI rebuild. The BrowserDriver logic itself lives in
// plugins/preview/main/browserService.ts; this script inlines the same CDP sequence against a raw webContents
// to prove the protocol path end-to-end without importing TS.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert')

const PAGE = `data:text/html,${encodeURIComponent(`
<!doctype html><html><body>
  <label>Email <input id="email" aria-label="Email"></label>
  <button id="go" onclick="console.log('clicked:' + document.getElementById('email').value)">Sign in</button>
</body></html>`)}`

async function main() {
  const win = new BrowserWindow({ show: false, width: 800, height: 600 })
  const wc = win.webContents
  await wc.loadURL(PAGE)

  const consoleLines = []
  wc.debugger.attach('1.3')
  wc.debugger.on('message', (_e, method, params) => {
    if (method === 'Runtime.consoleAPICalled') {
      consoleLines.push(params.args.map((a) => (a.value != null ? String(a.value) : a.description || '')).join(' '))
    }
  })
  const send = (method, params) => wc.debugger.sendCommand(method, params)
  await send('Runtime.enable')

  // snapshot → refs (same transform semantics as buildAxTree: actionable nodes get refs)
  await send('Accessibility.enable')
  const { nodes } = await send('Accessibility.getFullAXTree')
  const textbox = nodes.find((n) => n.role?.value === 'textbox' && n.name?.value === 'Email')
  const button = nodes.find((n) => n.role?.value === 'button' && n.name?.value === 'Sign in')
  assert(textbox && textbox.backendDOMNodeId, 'snapshot exposes the Email textbox with a backend node id')
  assert(button && button.backendDOMNodeId, 'snapshot exposes the Sign in button')

  // fill
  await send('DOM.getDocument')
  await send('DOM.focus', { backendNodeId: textbox.backendDOMNodeId })
  await send('Input.insertText', { text: 'a@b.com' })

  // click via box-model centre
  const { model } = await send('DOM.getBoxModel', { backendNodeId: button.backendDOMNodeId })
  const q = model.content
  const x = (q[0] + q[4]) / 2
  const y = (q[1] + q[5]) / 2
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })

  // console shows the side effect
  const deadline = Date.now() + 5000
  while (!consoleLines.some((l) => l.includes('clicked:a@b.com')) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50))
  }
  assert(consoleLines.some((l) => l.includes('clicked:a@b.com')), `console shows the click side effect (got: ${JSON.stringify(consoleLines)})`)

  console.log('smoke-browser: PASS — snapshot → fill → click → console verified over CDP')
}

app.whenReady().then(() =>
  main()
    .then(() => app.exit(0))
    .catch((err) => {
      console.error('smoke-browser: FAIL —', err.message)
      app.exit(1)
    }),
)
