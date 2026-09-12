import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Hover is never load-bearing (docs/ui-design.md § What the kit and layouts must never do, item 11,
// and § What the kit refuses).
//
// Anything reachable on hover has to be reachable by focus. The idiom in these stylesheets is a
// reveal: the control sits at `opacity: 0` or `visibility: hidden` and a `:hover` rule brings it back.
// Five hand-rolled versions of that were hover-only before the kit had one, so the × on a chip and
// the actions on a row were unreachable without a mouse.
//
// Read as text rather than rendered, because jsdom computes no styles and this is a property of the
// stylesheet rather than of any one render: the next stylesheet that adds a reveal has to answer the
// same question, and nothing in a component test would ask it. The pointer-coarse and
// prefers-reduced-motion blocks are the same shape and are checked with everything else.

const STYLES = new URL('../../infra/styles', import.meta.url).pathname
const UI = new URL('../components/', import.meta.url).pathname

const sheets = (dir: string): string[] =>
  readdirSync(dir).filter((name) => name.endsWith('.css')).map((name) => join(dir, name))

/** A declaration that brings something back into view. The three ways this codebase does it. */
const REVEALS = /(^|[;{\s])(opacity\s*:\s*1\b|visibility\s*:\s*visible\b|display\s*:\s*(?!none)[a-z-]+)/

/** Every rule in a stylesheet, as `[selectorList, declarations]`. Split on the braces rather than
 *  parsed: an at-rule's own header ends up as an earlier segment and is discarded, which is what the
 *  last-two-segments read below does. */
function rules(css: string): [string, string][] {
  return css.split('}').flatMap((block) => {
    const parts = block.split('{')
    if (parts.length < 2) return []
    return [[parts[parts.length - 2]!, parts[parts.length - 1]!] as [string, string]]
  })
}

describe('hover is never the only way in', () => {
  const files = [...sheets(STYLES), ...sheets(UI)]

  it('has stylesheets to check', () => {
    // Anti-vacuity: a moved directory would otherwise turn this whole file green and empty.
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(files.map((file) => [file.slice(file.lastIndexOf('/') + 1), file]))(
    '%s reveals nothing on hover that focus cannot also reveal',
    (_name, file) => {
      const offenders = rules(readFileSync(file, 'utf8'))
        .filter(([selector, body]) => selector.includes(':hover') && REVEALS.test(body))
        .filter(([selector]) => !/:focus-within|:focus-visible|:focus\b/.test(selector))
        .map(([selector]) => selector.trim())
      // The fix is never to delete the hover rule: it is to add the `:focus-within` twin beside it, so
      // the affordance appears for a pointer and for a keyboard alike.
      expect(offenders).toEqual([])
    },
  )
})
