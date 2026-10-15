// Runs inside each page `capture-shell.mjs` captures, the desktop window or the extension's panel,
// prepended to every script it sends (docs/site/snapshots.md § What the page script changes). It
// drives the page by accessible name and turns what the page shows into static HTML the site can
// draw. It's a script body, not a module: the driver wraps it in a function, and a scene's steps
// follow it.

// The helpers below are called by the scene steps that follow this file, which the linter can't see.
// oxlint-disable no-unused-vars

// Set up once per window, before the first scene opens anything. The agent window is never on screen,
// so the browser runs no animation frames. xterm, the diff, and every measured list draw on one, so a
// timer stands in. Animations are switched off so a capture never catches one halfway.
if (!window.__shellSnapshot) {
  window.__shellSnapshot = true
  window.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 16)
  window.cancelAnimationFrame = (handle) => clearTimeout(handle)
  // xterm draws into a WebGL canvas, which a copy can't carry. Without a WebGL context it falls back to
  // its DOM renderer, which draws text.
  const getContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (kind, ...options) {
    return kind.startsWith('webgl') ? null : getContext.call(this, kind, ...options)
  }
  // The app pauses its timed work, such as asking which panes a task offers, while it's hidden.
  Object.defineProperty(document, 'hidden', { get: () => false })
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible' })
  document.dispatchEvent(new Event('visibilitychange'))
  const still = document.createElement('style')
  still.id = 'shell-snapshot-still'
  still.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }'
  document.head.append(still)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const visible = (element) => element.getClientRects().length > 0

/** The visible control whose accessible name is `name`: its label, or its text. */
const named = (name, scope = document) =>
  [...scope.querySelectorAll('button, a, [role="tab"], [role="option"], [role="menuitem"], [role="treeitem"], summary')]
    .filter(visible)
    .find((element) => (element.getAttribute('aria-label') ?? element.textContent).trim() === name)

/** Wait until `find` answers, for up to ten seconds. */
async function until(find, what) {
  for (let waited = 0; waited < 10_000; waited += 100) {
    const found = find()
    if (found) return found
    await sleep(100)
  }
  throw new Error(`The window never showed ${what}.`)
}

async function click(name, scope) {
  ;(await until(() => named(name, scope), `a control named "${name}"`)).click()
  await settle()
}

/** Press a key, with any modifiers, where the focus is, the way the keymap hears a person. */
async function press(key, modifiers = {}) {
  const target = document.activeElement ?? document.body
  for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...modifiers }))
  await settle()
}

/** Follow an `acorn://` link, as the app does when the operating system hands it one. The app answers
 *  once it has dispatched the link, or never when the link is already where the window is. */
async function open(href) {
  await Promise.race([
    new Promise((done) => window.dispatchEvent(new CustomEvent('acorn:agent-link', { detail: { href, done } }))),
    sleep(5_000),
  ])
  await settle()
}

/** Wait until nothing is added, removed, or retyped for half a second, or three seconds pass. A
 *  blinking cursor or a spinner only changes attributes, so it doesn't hold this up. */
async function settle() {
  let changed = Date.now()
  const watch = new MutationObserver(() => (changed = Date.now()))
  watch.observe(document.body, { subtree: true, childList: true, characterData: true })
  const started = Date.now()
  while (Date.now() - changed < 500 && Date.now() - started < 3_000) await sleep(100)
  watch.disconnect()
}

/** Call the Node's API the way the app does, through the window's own connection. */
async function nodeFetch(method, path, json) {
  let local
  for (let waited = 0; !local && waited < 10_000; waited += 100) {
    local = (await window.acorn.fleetList()).nodes.find((node) => node.local)
    if (!local) await sleep(100)
  }
  if (!local) throw new Error('The window never listed its local Node.')
  const nodeId = local.nodeId
  const response = await window.acorn.nodeFetch(nodeId, {
    requestId: crypto.randomUUID(),
    path,
    method,
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: { kind: 'bytes', bytes: new TextEncoder().encode(JSON.stringify(json)) },
  })
  const text = new TextDecoder().decode(response.body)
  if (response.status >= 400) throw new Error(`${method} ${path} answered ${response.status}: ${text}`)
  return JSON.parse(text)
}

// xterm's palette, as the terminal client's slots (apps/tui/src/appearance.ts), so a terminal in a
// snapshot takes its colors from the visitor's theme like a terminal snapshot does.
const TERMINAL_SLOTS = { 1: 'danger', 2: 'ok', 3: 'warn', 4: 'accent', 5: 'accent', 6: 'accent', 8: 'muted' }

/** A terminal as text: xterm draws its rows as spans, which a copy could carry, but it styles them
 *  from a sheet it writes at runtime, so the spans are rewritten with the snapshot's own classes. */
function terminalText(xterm) {
  const pre = document.createElement('pre')
  pre.className = 'cells'
  const rows = xterm.querySelector('.xterm-rows')
  const style = getComputedStyle(rows ?? xterm)
  pre.style.fontSize = style.fontSize
  pre.style.lineHeight = style.lineHeight
  for (const [index, row] of [...(rows?.children ?? [])].entries()) {
    if (index > 0) pre.append('\n')
    for (const part of row.childNodes) {
      const text = part.textContent.replace(/ /g, ' ')
      if (part.nodeType !== Node.ELEMENT_NODE) {
        pre.append(text)
        continue
      }
      const span = document.createElement('span')
      span.textContent = text
      const palette = [...part.classList].map((name) => /^xterm-fg-(\d+)$/.exec(name)?.[1]).find(Boolean)
      // 9 to 14 are the bright forms of 1 to 6.
      const slot = TERMINAL_SLOTS[palette] ?? TERMINAL_SLOTS[palette - 8]
      if (slot) span.classList.add(`fg-${slot}`)
      if (part.classList.contains('xterm-bold')) span.classList.add('bold')
      pre.append(span)
    }
  }
  return pre
}

/** A native webview has no DOM to copy, so its slot says what the window showed there. */
function webviewPlaceholder(host) {
  const label = host.closest('.plugin-webview, .workspace-preview')?.querySelector('[title]')?.getAttribute('title')
  const box = document.createElement('div')
  box.className = 'snapshot-webview'
  box.textContent = label ? `Web page: ${label}` : 'Web page'
  return box
}

const LINK = /^(?:app|app-plugin|acorn|blob|tauri):/i
const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/i

/**
 * The rules the window writes at runtime, such as CodeMirror's, which no stylesheet file holds, kept
 * when they style something in `copy` and scoped to `.acorn-ui`. A declaration in a fixed color is
 * left out, because the snapshot takes its colors from the visitor's theme and that color was picked
 * for the theme the window had.
 */
function runtimeRules(copy) {
  const sheets = [
    ...document.adoptedStyleSheets,
    ...[...document.styleSheets].filter((sheet) => sheet.ownerNode?.tagName === 'STYLE' && sheet.ownerNode.id !== 'shell-snapshot-still'),
  ]
  const rules = []
  for (const rule of sheets.flatMap((sheet) => [...sheet.cssRules])) {
    if (!(rule instanceof CSSStyleRule)) continue
    const subject = rule.selectorText.replace(/::?[\w-]+/g, '').trim() || '*'
    try {
      if (!copy.querySelector(subject)) continue
    } catch {
      // A selector the browser can't take apart this way is kept: dropping a rule is the riskier mistake.
    }
    const declarations = [...rule.style]
      .filter((name) => !LITERAL_COLOR.test(rule.style.getPropertyValue(name)))
      .map((name) => `${name}: ${rule.style.getPropertyValue(name)}`)
    if (!declarations.length) continue
    const selectors = rule.selectorText.split(',').map((selector) => `.acorn-ui ${selector.trim()}`)
    rules.push(`${selectors.join(', ')} { ${declarations.join('; ')} }`)
  }
  return rules.join('\n')
}

/**
 * The window as static HTML: every visible element of the page, with what the browser holds as
 * state written into the markup. Scripts, frames, handlers, and hidden elements are left out, a
 * terminal becomes text, a webview a labeled box, and a scrolled region keeps its place by moving its
 * children. Every id but `root` gets `scene` in front, so two snapshots on one page can't collide.
 */
function capture(scene) {
  const copy = document.body.cloneNode(true)
  const sources = [...document.body.querySelectorAll('*')]
  const copies = [...copy.querySelectorAll('*')]
  const dropped = []
  const replaced = []
  sources.forEach((source, index) => {
    const out = copies[index]
    const style = getComputedStyle(source)
    if (
      ['SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'CANVAS', 'LINK', 'STYLE'].includes(source.tagName) ||
      style.display === 'none'
    ) {
      dropped.push(out)
      return
    }
    if (source.classList.contains('xterm')) replaced.push([out, terminalText(source)])
    else if (source.classList.contains('workspace-preview-host')) replaced.push([out, webviewPlaceholder(source)])
    // A copy, because removing an attribute changes the live list.
    for (const { name, value } of Array.from(out.attributes)) {
      // A tooltip never shows in a picture, and its text can carry the machine's time zone.
      const tooltip = name === 'title' || name.startsWith('data-tip')
      // An image from another site, such as a GitHub avatar, would load from that site on every visit.
      const remote = name === 'src' && /^https?:/i.test(value)
      // A commit or a digest in an attribute is an identifier no picture shows.
      const digest = /[0-9a-f]{32}/i.test(value)
      if (tooltip || remote || digest || name.startsWith('on') || name.startsWith('data-acorn-agent') || ((name === 'href' || name === 'src') && LINK.test(value)))
        out.removeAttribute(name)
    }
    if (source instanceof HTMLInputElement) {
      if (source.type === 'checkbox' || source.type === 'radio') out.toggleAttribute('checked', source.checked)
      else out.setAttribute('value', source.value)
    } else if (source instanceof HTMLTextAreaElement) out.textContent = source.value
    else if (source instanceof HTMLOptionElement) out.toggleAttribute('selected', source.selected)
    if (source.scrollTop > 0 || source.scrollLeft > 0) {
      out.style.overflow = 'hidden'
      for (const [childIndex, child] of [...source.children].entries()) {
        if (getComputedStyle(child).position === 'sticky') continue
        const target = out.children[childIndex]
        const moved = `translate(${-source.scrollLeft}px, ${-source.scrollTop}px)`
        target.style.transform = [moved, target.style.transform].filter(Boolean).join(' ')
      }
    }
  })
  for (const node of dropped) node.remove()
  for (const [node, replacement] of replaced) node.replaceWith(replacement)

  // `root` keeps its name, because the app's stylesheet sizes the window by it.
  const ids = new Set([...copy.querySelectorAll('[id]')].map((element) => element.id).filter((id) => id !== 'root'))
  const renamed = (value) => value.split(/\s+/).map((id) => (ids.has(id) ? `${scene}-${id}` : id)).join(' ')
  for (const element of copy.querySelectorAll('*')) {
    for (const name of ['id', 'for', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'aria-activedescendant', 'aria-owns', 'list']) {
      if (element.hasAttribute(name)) element.setAttribute(name, renamed(element.getAttribute(name)))
    }
  }
  // The shell keeps some sizes, such as the terminal drawer's height, as custom properties on <html>.
  // The page's own theme and style stay the site's, so only those properties come along.
  const document_ = document.createElement('div')
  document_.className = 'snapshot-document'
  for (const name of document.documentElement.style) {
    if (name.startsWith('--')) document_.style.setProperty(name, document.documentElement.style.getPropertyValue(name))
  }
  document_.style.height = '100%'
  const rules = runtimeRules(copy)
  if (rules) document_.append(Object.assign(document.createElement('style'), { textContent: rules }))
  document_.append(...copy.childNodes)
  return document_.outerHTML
}
