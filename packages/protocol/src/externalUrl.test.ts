import { describe, expect, it } from 'vitest'
import { isPluginOpenableUrl } from './externalUrl'

// One policy, two callers: the manifest parser for the `openUrl` descriptor verb, and the frame bridge
// for `ui.openUrl`. The suite lives here because the rule is shared, and because both callers would
// otherwise be tested against their own copy of it.

describe('isPluginOpenableUrl', () => {
  it('accepts https, whatever the host', () => {
    expect(isPluginOpenableUrl('https://linear.app/acme/issue/ENG-42')).toBe(true)
    expect(isPluginOpenableUrl('https://github.com/runn/acorn/pull/1?files=1#diff')).toBe(true)
    // No host allowlist here on purpose: which sites a plugin may name is a product decision its
    // manifest and its own content make, and this is only about the scheme.
    expect(isPluginOpenableUrl('https://localhost:3000/')).toBe(true)
  })

  it('refuses http, deliberately narrower than the shell’s own external allowlist', () => {
    // main/urlGuards.ts permits http and mailto because a person clicking a link in a GitHub body
    // legitimately reaches both. Plugin code handing the machine a URL unprompted is a different
    // question, and a silent downgrade is not a choice a plugin gets to make for the owner.
    expect(isPluginOpenableUrl('http://internal.example/')).toBe(false)
    expect(isPluginOpenableUrl('mailto:someone@example.com')).toBe(false)
  })

  it('refuses scheme handlers, script and inline documents', () => {
    expect(isPluginOpenableUrl('file:///Applications/Calculator.app')).toBe(false)
    expect(isPluginOpenableUrl('javascript:alert(1)')).toBe(false)
    expect(isPluginOpenableUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isPluginOpenableUrl('vscode://file/etc/passwd')).toBe(false)
  })

  it('refuses the app’s own privileged origins', () => {
    // A frame asking the host to open another plugin's bundle, or the shell itself, is caught by the
    // same single clause — which is the argument for an allowlist of one scheme over a denylist.
    expect(isPluginOpenableUrl('app-plugin://abc123/index.html')).toBe(false)
    expect(isPluginOpenableUrl('app://acorn/')).toBe(false)
  })

  it('answers false for anything that is not a URL, rather than throwing', () => {
    // It is called on bridge input, where an exception would be a broken frame instead of a refusal.
    expect(isPluginOpenableUrl('')).toBe(false)
    expect(isPluginOpenableUrl('not a url')).toBe(false)
    expect(isPluginOpenableUrl('//evil.example.com/')).toBe(false) // protocol-relative: no scheme
  })

  it('agrees with the parse every downstream consumer will do', () => {
    // Surrounding whitespace is stripped by the WHATWG parser, so this is `https://example.com` to this
    // predicate AND to `new URL` in main's external-URL guard AND to `window.open`. Pinned rather than
    // trimmed here: a normalisation of its own would be a second interpretation of the same string,
    // which is exactly the class of disagreement this shared module exists to prevent.
    expect(isPluginOpenableUrl('  https://example.com  ')).toBe(true)
    expect(isPluginOpenableUrl('HTTPS://example.com')).toBe(true)
  })
})
