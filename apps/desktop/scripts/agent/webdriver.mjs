import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'
const REF_ATTRIBUTE = 'data-acorn-agent-ref'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The page's visible controls, each tagged with a ref an action can resolve. With a `target` (a role
 * and a name, or a name prefix) it returns only the first control that matches, looked for among all
 * of them rather than the first 300, because a long transcript puts the controls a flow needs far
 * down the page.
 */
function snapshotDocument(target) {
  const refAttribute = 'data-acorn-agent-ref'
  const visible = (element) => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0
  }
  const name = (element) => {
    const labelledBy = element.getAttribute('aria-labelledby')
    if (labelledBy) {
      const value = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
      if (value) return value
    }
    if (element.getAttribute('aria-label')) return element.getAttribute('aria-label').trim()
    if ('labels' in element && element.labels?.length) {
      const value = [...element.labels].map((label) => label.textContent ?? '').join(' ').trim()
      if (value) return value
    }
    return (element.getAttribute('alt') || element.getAttribute('title') || element.textContent || element.getAttribute('placeholder') || '').trim()
  }
  const role = (element) => {
    if (element.getAttribute('role')) return element.getAttribute('role')
    const tag = element.tagName.toLowerCase()
    if (/^h[1-6]$/.test(tag)) return 'heading'
    if (tag === 'a') return 'link'
    if (tag === 'button') return 'button'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'select') return 'combobox'
    if (tag === 'input') return ['button', 'submit', 'reset', 'checkbox', 'radio'].includes(element.type) ? element.type : 'textbox'
    return tag
  }
  const selector = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a[href]', 'button', 'input', 'textarea', 'select', 'summary',
    '[role]', '[tabindex]:not([tabindex="-1"])',
  ].join(',')
  document.querySelectorAll(`[${refAttribute}]`).forEach((element) => element.removeAttribute(refAttribute))
  const describe = (element) => ({
    element,
    role: role(element),
    name: name(element).replace(/\s+/g, ' ').slice(0, 240),
    disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true',
  })
  const wanted = (entry) => (!target.role || entry.role === target.role)
    && (target.name !== undefined ? entry.name === target.name : entry.name.startsWith(target.nameStartsWith ?? ''))
  const candidates = [...document.querySelectorAll(selector)].filter(visible)
  const described = target
    ? [candidates.filter((element) => !target.role || role(element) === target.role).map(describe).find(wanted)].filter(Boolean)
    : candidates.slice(0, 300).map(describe)
  const elements = described.map(({ element, ...entry }, index) => {
    const ref = `e${index + 1}`
    element.setAttribute(refAttribute, ref)
    return { ref, ...entry }
  })
  return {
    url: location.href,
    title: document.title,
    text: (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 12_000),
    elements,
  }
}

/**
 * Move the page's scroller and say where that leaves the reader.
 *
 * Injected whole, like `snapshotDocument` above, because it has to run in the window.
 *
 * The position alone is not the answer. A pixel offset means nothing once the content above it has
 * changed height, which is the entire reason the transcript's reading place is a turn
 * (client-core kit/lib/timeline/readingPlace.ts). So this also reports which turn the viewport starts in,
 * read off the `data-turn` the kit publishes, and that is the thing to compare across a navigation.
 *
 * A `wheel` event before the write, because a scroller that owns its position tells the reader's
 * gesture from a browser clamp, and a bare `scrollTop =` is neither. The event is untrusted; nothing
 * in the kit tests `isTrusted`, deliberately.
 *
 * Ceiling: finds the scroller by walking every element and asking for its computed style, then takes
 * the largest. Fine for one diagnostic call, and it means the driver needs no class name from the
 * kit. Pass a ref if a page ever has two worth telling apart.
 */
function scrollRegion(delta) {
  const scrollers = [...document.querySelectorAll('*')].filter((element) => {
    if (element.scrollHeight - element.clientHeight < 8) return false
    const overflow = getComputedStyle(element).overflowY
    return overflow === 'auto' || overflow === 'scroll'
  })
  const box = scrollers.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0]
  if (!box) return null
  if (delta) {
    box.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: delta }))
    box.scrollTop += delta
  }
  const top = box.getBoundingClientRect().top
  const turn = [...box.querySelectorAll('[data-turn]')].find((row) => row.getBoundingClientRect().bottom > top)
  return {
    // Which box this picked, because the heuristic can pick the wrong one and a reading that does not
    // say what it measured is a reading you can believe by mistake.
    element: `${box.tagName.toLowerCase()}${box.className ? `.${String(box.className).trim().split(/\s+/).join('.')}` : ''}`.slice(0, 120),
    scrollTop: Math.round(box.scrollTop),
    maxScroll: Math.round(Math.max(0, box.scrollHeight - box.clientHeight)),
    viewport: Math.round(box.clientHeight),
    turn: turn ? turn.getAttribute('data-turn') : null,
    offset: turn ? Math.round(top - turn.getBoundingClientRect().top) : null,
  }
}

/**
 * Put one scroller at a fraction of its range and say where it landed. Injected whole, like the two
 * above. `selector` names the surface's scroller (the flow runner holds that table, not the flow
 * file), and the largest visible match wins. A wheel event first, for the reason `scrollRegion` gives.
 */
function scrollToFraction(selector, fraction) {
  const box = [...document.querySelectorAll(selector)]
    .filter((element) => element.clientHeight > 0)
    .sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0]
  if (!box) return null
  const range = Math.max(0, box.scrollHeight - box.clientHeight)
  const to = Math.round(range * Math.min(1, Math.max(0, fraction)))
  box.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: to - box.scrollTop }))
  box.scrollTop = to
  return { scrollTop: Math.round(box.scrollTop), maxScroll: Math.round(range), viewport: Math.round(box.clientHeight) }
}

/** Ask the renderer for a fresh rendered-surface health snapshot and read it back off the
 *  performance timeline (docs/telemetry/surface-health.md § Rendered-surface health). Numbers only. */
function readSurfaceHealth() {
  dispatchEvent(new Event('acorn:surface-health'))
  const mark = performance.getEntriesByName('acorn:surface.health').at(-1)
  return mark ? mark.detail : null
}

/** The `acorn:` measures on the performance timeline: names and numbers, never their details. */
function readPerformanceEntries(prefix) {
  return performance.getEntriesByType('measure')
    .filter((entry) => entry.name.startsWith(prefix))
    .map((entry) => ({ name: entry.name, startTime: Math.round(entry.startTime), duration: Math.round(entry.duration) }))
}

/** The page's engine and viewport, for the report's environment block. */
function readEnvironment() {
  return { userAgent: navigator.userAgent, visibility: document.visibilityState, width: innerWidth, height: innerHeight, devicePixelRatio }
}

export class WebDriverClient {
  constructor(endpoint, sessionId = null) {
    this.endpoint = endpoint.replace(/\/$/, '')
    this.sessionId = sessionId
  }

  async request(method, path, body) {
    const options = { method }
    if (body !== undefined) {
      options.headers = { 'content-type': 'application/json' }
      options.body = JSON.stringify(body)
    }
    const response = await fetch(`${this.endpoint}${path}`, options)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.value?.error) {
      const detail = payload?.value?.message || payload?.value?.error || `${response.status} ${response.statusText}`
      throw new Error(`WebDriver ${method} ${path} failed: ${detail}`)
    }
    return payload.value
  }

  async waitUntilReady(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs
    let lastError = null
    while (Date.now() < deadline) {
      try {
        const status = await this.request('GET', '/status')
        if (status?.ready !== false) return
      } catch (error) {
        lastError = error
      }
      await sleep(200)
    }
    throw new Error(`WebDriver did not become ready within ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`)
  }

  async createSession(timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs
    let lastError = null
    while (Date.now() < deadline) {
      try {
        const value = await this.request('POST', '/session', {
          capabilities: { alwaysMatch: { browserName: 'tauri' } },
        })
        this.sessionId = value?.sessionId
        if (this.sessionId) return this.sessionId
        throw new Error('The WebDriver response did not include a session id.')
      } catch (error) {
        lastError = error
        await sleep(250)
      }
    }
    throw lastError ?? new Error('Could not create a WebDriver session.')
  }

  sessionPath(path = '') {
    if (!this.sessionId) throw new Error('No WebDriver session is active.')
    return `/session/${encodeURIComponent(this.sessionId)}${path}`
  }

  execute(script, args = []) {
    return this.request('POST', this.sessionPath('/execute/sync'), { script, args })
  }

  snapshot(target) {
    return this.execute(`return (${snapshotDocument.toString()})(arguments[0])`, [target ?? null])
  }

  scroll(delta) {
    return this.execute(`return (${scrollRegion.toString()})(arguments[0])`, [delta])
  }

  scrollToFraction(selector, fraction) {
    return this.execute(`return (${scrollToFraction.toString()})(arguments[0], arguments[1])`, [selector, fraction])
  }

  surfaceHealth() {
    return this.execute(`return (${readSurfaceHealth.toString()})()`)
  }

  performanceEntries(prefix = 'acorn:') {
    return this.execute(`return (${readPerformanceEntries.toString()})(arguments[0])`, [prefix])
  }

  environment() {
    return this.execute(`return (${readEnvironment.toString()})()`)
  }

  /** Resolve after `count` animation frames in the page. Frames, not a sleep: the runner waits on
   *  the renderer having had the chance to lay out and paint, which a fixed delay only guesses at. */
  frames(count = 2) {
    return this.request('POST', this.sessionPath('/execute/async'), {
      script: 'const done = arguments[arguments.length - 1]; let left = arguments[0]; const step = () => (--left <= 0 ? done(true) : requestAnimationFrame(step)); requestAnimationFrame(step)',
      args: [count],
    })
  }

  setWindowSize(width, height) {
    return this.request('POST', this.sessionPath('/window/rect'), { width, height })
  }

  /** The first visible control with this role and name, resolved for an action, or null. */
  async find(target) {
    const [match] = (await this.snapshot(target)).elements
    return match ? this.resolveElement(match.ref) : null
  }

  async resolveElement(ref) {
    const value = await this.request('POST', this.sessionPath('/element'), {
      using: 'css selector',
      value: `[${REF_ATTRIBUTE}="${ref}"]`,
    })
    const elementId = value?.[ELEMENT_KEY]
    if (!elementId) throw new Error(`WebDriver could not resolve ${ref}. Run snapshot again.`)
    return elementId
  }

  click(elementId) {
    return this.request('POST', this.sessionPath(`/element/${encodeURIComponent(elementId)}/click`), {})
  }

  async fill(elementId, text) {
    const path = this.sessionPath(`/element/${encodeURIComponent(elementId)}`)
    await this.request('POST', `${path}/clear`, {})
    await this.request('POST', `${path}/value`, { text, value: [...text] })
  }

  async screenshot(path) {
    const encoded = await this.request('GET', this.sessionPath('/screenshot'))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.from(encoded, 'base64'))
    return path
  }

  async deleteSession() {
    if (!this.sessionId) return
    const sessionId = this.sessionId
    this.sessionId = null
    await this.request('DELETE', `/session/${encodeURIComponent(sessionId)}`).catch(() => {})
  }
}

export function renderSnapshot(snapshot) {
  const elements = snapshot.elements
    .map((element) => `- ${element.role}${element.name ? ` "${element.name}"` : ''}${element.disabled ? ' disabled' : ''} [ref=${element.ref}]`)
    .join('\n')
  return [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title || '(untitled)'}`,
    '',
    'Text:',
    snapshot.text || '(empty)',
    '',
    'Elements:',
    elements || '(none)',
  ].join('\n')
}

export function renderPlace(place) {
  const where = place.turn ? `turn ${place.turn} (${place.offset}px above the top)` : 'no turn under the top'
  return [
    `${place.element}`,
    `scroll ${place.scrollTop} of ${place.maxScroll}, viewport ${place.viewport}`,
    where,
  ].join('\n')
}
