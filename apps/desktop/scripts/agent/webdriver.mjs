import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'
const REF_ATTRIBUTE = 'data-acorn-agent-ref'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function snapshotDocument() {
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
  const elements = [...document.querySelectorAll(selector)]
    .filter(visible)
    .slice(0, 300)
    .map((element, index) => {
      const ref = `e${index + 1}`
      element.setAttribute(refAttribute, ref)
      return {
        ref,
        role: role(element),
        name: name(element).replace(/\s+/g, ' ').slice(0, 240),
        disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true',
      }
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
 * (client-core kit/lib/readingPlace.ts). So this also reports which turn the viewport starts in,
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

  snapshot() {
    return this.execute(`return (${snapshotDocument.toString()})()`)
  }

  scroll(delta) {
    return this.execute(`return (${scrollRegion.toString()})(arguments[0])`, [delta])
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
