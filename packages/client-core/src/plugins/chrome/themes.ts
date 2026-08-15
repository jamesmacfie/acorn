// A plugin-contributed colour theme, turned into a stylesheet block by the HOST.
//
// The manifest half is `contributions.themes` (@acorn/protocol/pluginContract.ts): a map of the 22
// palette tokens plus a `dark` flag. No plugin-authored CSS reaches the shell — this module is the
// only thing that writes a plugin's theme into the document, and it writes token declarations it
// composed itself out of a fixed list of names and values that passed the colour check.
//
// WHY THE CHECKS RUN AGAIN HERE. The node already refused a bad map at parse time, but a roster row
// is bytes a node sent — possibly an older node, possibly one whose schema predates a rule — and this
// is the one place in the client where a string from a manifest is concatenated into CSS. So the id
// alphabet, the token names and every value are re-checked immediately before the write, and anything
// that fails throws rather than being escaped. Refusing is stronger than escaping: an escaper is a
// thing that can be wrong, while a value that must match `^#[0-9a-f]{6}$` has nothing to escape.
import { isThemeColorValue, THEME_PALETTE_TOKENS } from '@acorn/protocol/themeTokens.ts'
import type { PluginThemeDescriptor } from '@acorn/protocol/pluginContract.ts'
import { themeRegistry } from '../../registries/themes'
import type { Disposable } from '../../registries/registry'

/** `plugin:<pluginId>:<themeId>` — the shape bb uses, and the reason a plugin theme can never collide
 * with a built-in: no built-in id contains a colon. */
export const pluginThemeId = (pluginId: string, themeId: string): string => `plugin:${pluginId}:${themeId}`

/** The prefix that makes an id host-generated rather than stylesheet-defined. */
export const PLUGIN_THEME_PREFIX = 'plugin:'

// The composed id, re-derived from its parts rather than trusted. This is what goes inside the
// attribute selector's quotes, so the alphabet has to exclude the quote, the brace and the newline —
// it excludes everything but lower-case alphanumerics, dashes and the two separating colons.
const SAFE_ID = /^plugin:[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9-]{0,63}$/

/** The generated `:root[data-theme=…]` block for one validated theme.
 *
 * Throws with a reason if anything about the descriptor is unusable. Every caller is inside the
 * chrome pass's per-contribution try/catch, which turns the throw into a warning and costs the plugin
 * this one theme rather than its whole manifest. */
export function pluginThemeBlock(id: string, descriptor: PluginThemeDescriptor): string {
  if (!SAFE_ID.test(id)) throw new Error(`theme id '${id}' is not a safe selector value`)
  const tokens = descriptor.tokens ?? {}
  const unknown = Object.keys(tokens).filter((name) => !(THEME_PALETTE_TOKENS as readonly string[]).includes(name))
  // Both directions, and the unknown-key half is the one that matters most: `--danger` is a derived
  // token and `--radius` belongs to the other axis, so accepting either would let a theme reach past
  // colour into the derivation or into layout.
  if (unknown.length) throw new Error(`theme '${id}' sets tokens it may not set: ${unknown.join(', ')}`)
  const declarations = THEME_PALETTE_TOKENS.map((name) => {
    const value = tokens[name]
    if (typeof value !== 'string' || !isThemeColorValue(value)) {
      throw new Error(`theme '${id}' has no usable colour for ${name}`)
    }
    return `  ${name}: ${value};`
  })
  // Self-description, written by the host from one boolean. These are not colours, so a manifest
  // cannot state them; `--syntax-fg` picks the light or dark side of Shiki's dual output, which is
  // what makes a plugin theme colour diffs and check logs correctly with no further declaration.
  declarations.push(descriptor.dark
    ? '  --is-dark: 1;  --color-scheme: dark;  --syntax-fg: var(--r);'
    : '  --is-dark: 0;  --color-scheme: light;  --syntax-fg: var(--l);')
  return `:root[data-theme="${id}"] {\n${declarations.join('\n')}\n}`
}

// The installed blocks, keyed by theme id. The MAP is the state and the <style> element is its
// projection, which is what lets a node-environment suite assert on the generated CSS: the repo's
// vitest has no DOM, and a feature whose only observable output was `document.head` would be
// untestable here.
const blocks = new Map<string, string>()
let element: HTMLStyleElement | null = null

/** Everything this module has written into the document, in registration order. */
export const pluginThemeStyleSheet = (): string => [...blocks.values()].join('\n\n')

function flush(): void {
  if (typeof document === 'undefined') return
  if (!element) {
    element = document.createElement('style')
    element.dataset.acorn = 'plugin-themes'
    // Appended to head, so it lands after the bundled sheet. Source order is a belt to the braces of
    // specificity here: `:root[data-theme="plugin:…"]` is (0,2,0), the same as every built-in named
    // block and as the pre-JS `:root:not([data-theme="light"])` dark block, and no built-in selector
    // can carry a `plugin:`-prefixed value anyway.
    document.head.append(element)
  }
  element.textContent = pluginThemeStyleSheet()
}

/**
 * Validate, generate, install and register one plugin theme. The returned disposable removes the
 * generated CSS as well as the picker entry — the chrome pass disposes-then-registers on every sync,
 * and a block left behind would outlive the plugin that declared it.
 */
export function registerPluginTheme(pluginId: string, descriptor: PluginThemeDescriptor): Disposable {
  const id = pluginThemeId(pluginId, descriptor.id)
  const css = pluginThemeBlock(id, descriptor)
  // The label carries the plugin id because the picker is one flat list holding the built-in twelve
  // and every plugin's themes: two packages offering a "Nightfall" would otherwise be indistinguishable
  // at the only place a user chooses between them.
  const entry = themeRegistry.register({ id, label: `${descriptor.label} (${pluginId})` })
  blocks.set(id, css)
  flush()
  return {
    dispose: () => {
      blocks.delete(id)
      flush()
      entry.dispose()
    },
  }
}
