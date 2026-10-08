import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { WebDriverClient } from '../../apps/desktop/scripts/agent/webdriver.mjs'

const [session, action, argument] = process.argv.slice(2)
if (!/^[a-z0-9-]+$/.test(session ?? '')) throw new Error('Pass an isolated agent session name')
const manifest = JSON.parse(await readFile(join('.acorn', 'agent-dev', session, 'session.json'), 'utf8'))
if (manifest.status !== 'ready') throw new Error('Run against a ready disposable fixture session')
await stat(join('.acorn', 'agent-dev', session, 'fixture', 'repo', '.git'))
const client = new WebDriverClient(manifest.webdriverEndpoint, manifest.webdriverSessionId)

if (action === 'enter-rename') {
  const submitted = await client.execute(`
    const input = document.querySelector('[aria-label="Rename entry"]');
    if (!input) return false;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  `)
  if (!submitted) throw new Error('No active Rename entry field')
  console.log('Submitted inline rename')
} else if (action === 'metrics' || action === 'scroll-search') {
  const result = await client.execute(`
    const pane = document.querySelector('.ui-tab-panel:not([hidden])') ?? document.querySelector('.ui-listdetail-list');
    if (arguments[0] !== null && pane) { pane.scrollTop = Number(arguments[0]); pane.dispatchEvent(new Event('scroll')); }
    const nodes = [...document.querySelectorAll('[role="treeitem"]')];
    const hits = [...document.querySelectorAll('[role="option"]')];
    const resources = performance.getEntriesByType('resource');
    return { scrollTop: pane?.scrollTop ?? null, scrollHeight: pane?.scrollHeight ?? null,
      viewportHeight: pane?.clientHeight ?? null, loadedTreeRows: nodes.length, loadedHitRows: hits.length,
      requestCount: resources.length, editorRequests: resources.filter((r) => r.name.includes('/v1/p/editor/')).length,
      width: innerWidth, height: innerHeight, scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      renameValue: document.querySelector('[aria-label="Rename entry"]')?.value ?? null,
      focusedLabel: document.activeElement?.getAttribute('aria-label') ?? null,
      scrollables: [...document.querySelectorAll('*')].filter((node) => node.scrollHeight > node.clientHeight + 50 && node.clientHeight > 50)
        .slice(0, 8).map((node) => ({ className: String(node.className).slice(0, 80), top: node.scrollTop,
          height: node.scrollHeight, view: node.clientHeight })) };
  `, [action === 'scroll-search' ? Number(argument) : null])
  console.log(JSON.stringify(result))
} else if (action === 'resize') {
  const [width, height] = (argument ?? '').split('x').map(Number)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 500 || height < 400) throw new Error('Use WIDTHxHEIGHT, at least 500x400')
  await client.setWindowSize(width, height)
  console.log(JSON.stringify({ width, height }))
} else if (action === 'expand-tree') {
  if (!['src', 'src/group-009', 'assets'].includes(argument)) throw new Error('Use a seeded fixture directory')
  const files = await client.find({ role: 'tab', name: 'Files' })
  if (!files) throw new Error('Open the fixture task Editor first')
  await client.click(files)
  const opened = await client.execute(`
    const row = [...document.querySelectorAll('[role="treeitem"]')].find((item) =>
      item.title === arguments[0] || item.title.startsWith(arguments[0] + ' —'));
    const expand = row?.querySelector('[aria-label="Expand"]');
    if (!expand) return false; expand.click(); return true;
  `, [argument])
  if (!opened) throw new Error('The fixture directory is not a visible collapsed row')
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const result = await client.execute(`return { loadedTreeRows: document.querySelectorAll('[role="treeitem"]').length,
    ignoredRows: [...document.querySelectorAll('[role="treeitem"]')].filter((row) => row.getAttribute('aria-label')?.includes('Ignored')).length };`)
  console.log(JSON.stringify(result))
} else if (action === 'scroll-retention') {
  const searchTab = await client.find({ role: 'tab', name: 'Search' })
  if (!searchTab) throw new Error('Open the fixture task Editor first')
  await client.click(searchTab)
  const input = await client.find({ role: 'textbox', name: 'Search in files' })
  if (!input) throw new Error('Search input unavailable')
  const query = argument ?? 'needle group 9'
  const current = await client.execute(`return document.querySelector('[aria-label="Search in files"]')?.value`, [])
  if (current !== query) {
    await client.fill(input, query)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  let count = 0
  for (let attempt = 0; attempt < 50; attempt++) {
    count = await client.execute(`return document.querySelectorAll('.ui-tab-panel:not([hidden]) [role="option"]').length`)
    if (count > 100) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (count <= 100) throw new Error(`Search produced only ${count} rows`)
  const before = await client.execute(`
    const pane = document.querySelector('.ui-tab-panel:not([hidden])');
    pane.scrollTop = 1800; pane.dispatchEvent(new Event('scroll')); return pane.scrollTop;
  `)
  if (before !== 1800) throw new Error(`Result viewport could not reach the requested reading place: ${before}`)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const filesTab = await client.find({ role: 'tab', name: 'Files' })
  if (!filesTab) throw new Error('Files tab unavailable')
  await client.click(filesTab)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const searchAgain = await client.find({ role: 'tab', name: 'Search' })
  if (!searchAgain) throw new Error('Search tab unavailable after hiding')
  await client.click(searchAgain)
  let after
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    after = await client.execute(`return document.querySelector('.ui-tab-panel:not([hidden])')?.scrollTop ?? null`)
    if (after === before) break
  }
  if (after !== before) throw new Error(`Hidden panel lost its reading place: ${JSON.stringify({ before, after })}`)
  console.log(JSON.stringify({ before, after, loadedHitRows: count }))
} else if (action === 'remount-retention') {
  const before = await client.execute(`return { offset: document.querySelector('.ui-tab-panel:not([hidden])')?.scrollTop ?? null,
    query: document.querySelector('[aria-label="Search in files"]')?.value ?? null }`)
  const taskButton = async (label) => client.execute(`
    const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === arguments[0]
      || item.textContent.trim() === arguments[0]);
    if (!button) return false; button.click(); return true;
  `, [label])
  if (!await taskButton('Agent')) throw new Error('Agent task pane unavailable')
  if (!await taskButton('Editor')) throw new Error('Editor task pane unavailable')
  const search = await client.find({ role: 'tab', name: 'Search' })
  if (!search) throw new Error('Editor sidebar unavailable after remount')
  await client.click(search)
  let after
  let attempts = 0
  for (; attempts < 50; attempts++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    after = await client.execute(`return { offset: document.querySelector('.ui-tab-panel:not([hidden])')?.scrollTop ?? null,
      query: document.querySelector('[aria-label="Search in files"]')?.value ?? null,
      rows: document.querySelectorAll('.ui-tab-panel:not([hidden]) [role="option"]').length }`)
    if (after.offset === before.offset && after.query === before.query && after.rows > 0) break
  }
  if (attempts === 50) throw new Error(`Reading place did not return: ${JSON.stringify({ before, after })}`)
  console.log(JSON.stringify({ before, after, waitedMs: (attempts + 1) * 100 }))
} else if (action === 'open-latency') {
  if (!/^src\/group-\d{3}\/item-\d{3}\.tsx$/.test(argument ?? '')) throw new Error('Pass a generated fixture TSX path')
  const result = await client.request('POST', client.sessionPath('/execute/async'), {
    script: `
      const path = arguments[0], done = arguments[arguments.length - 1];
      const row = [...document.querySelectorAll('[role="option"]')]
        .find((item) => item.getAttribute('title')?.startsWith('Open ' + path + ' at '));
      if (!row) { done({ error: 'Search result unavailable' }); return; }
      const start = performance.now(); let finished = false;
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => finish({ error: 'File did not open within 10 seconds' }), 10000);
      function finish(result) { if (finished) return; finished = true; clearTimeout(timeout); observer.disconnect(); done(result); }
      function check() {
        const location = [...document.querySelectorAll('[role="note"]')].some((item) => item.textContent.trim() === path);
        const item = Number(path.split('/').at(-1).slice(5, 8));
        if (location && document.querySelector('.cm-content')?.textContent.includes('export const item' + item + ' ='))
          finish({ path, latencyMs: Math.round(performance.now() - start) });
      }
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      row.click(); check();
    `,
    args: [argument],
  })
  console.log(JSON.stringify(result))
} else if (action === 'edit-fixture') {
  if (!argument) throw new Error('Pass the replacement fixture text')
  const editor = await client.find({ role: 'textbox', nameStartsWith: 'export const item' })
  if (!editor) throw new Error('Open a generated fixture TSX in Editor')
  await client.fill(editor, argument)
  console.log('Edited disposable fixture document')
} else if (action === 'watch-requests') {
  const result = await client.execute(`
    if (!window.__phase06Send) {
      window.__phase06Send = WebSocket.prototype.send;
      WebSocket.prototype.send = function(data) {
        if (typeof data === 'string') {
          try {
            const message = JSON.parse(data), request = message.params?.request;
            if (message.method === 'node-fetch' && request?.path?.includes('/v1/p/editor/')) {
              const path = request.path.split('?')[0];
              const metadata = path.endsWith('/ignored') && request.body?.kind === 'bytes'
                ? JSON.parse(atob(request.body.bytes)) : undefined;
              window.__phase06Requests.push({ path, method: request.method ?? 'GET',
                ...(metadata ? { directory: metadata.path, names: metadata.names.length } : {}) });
            }
          } catch {}
        }
        return window.__phase06Send.apply(this, arguments);
      };
    }
    window.__phase06Requests = [];
    return window.__phase06Requests.length;
  `)
  console.log(JSON.stringify({ editorRequests: result }))
} else if (action === 'request-count') {
  const result = await client.execute(`return window.__phase06Requests ?? [];`)
  console.log(JSON.stringify({ editorRequests: result.length, routes: result }))
} else if (action === 'stop-requests') {
  await client.execute(`if (window.__phase06Send) { WebSocket.prototype.send = window.__phase06Send; delete window.__phase06Send; }
    delete window.__phase06Requests;`)
  console.log('Retired request observer')
} else throw new Error('Use enter-rename | metrics | expand-tree DIRECTORY | scroll-search OFFSET | scroll-retention [QUERY] | remount-retention | open-latency PATH | edit-fixture TEXT | resize WIDTHxHEIGHT | watch-requests | request-count | stop-requests')
