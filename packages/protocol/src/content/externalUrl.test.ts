import { describe, expect, it } from 'vitest'
import { isPluginOpenableUrl, safeContentHref, safeVerificationUrl } from './externalUrl'

// One policy, two callers: the manifest parser for the `openUrl` descriptor verb, and the frame bridge
// for `ui.openUrl`. The suite lives here because the rule is shared, and because both callers would
// otherwise be tested against their own copy of it.

describe('isPluginOpenableUrl', () => {
  it('accepts https, whatever the host', () => {
    expect(isPluginOpenableUrl('https://linear.app/acme/issue/ENG-42')).toBe(true)
    expect(isPluginOpenableUrl('https://github.com/runn/acorn/pull/1?files=1#diff')).toBe(true)
    // No host allowlist here: which sites a plugin may name is a product decision its manifest and
    // its own content make; this file is only about the scheme.
    expect(isPluginOpenableUrl('https://localhost:3000/')).toBe(true)
  })

  it('refuses http, deliberately narrower than the shell’s own external allowlist', () => {
    // server/urlGuards.ts permits http and mailto because a person clicking a link in a GitHub body
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
    // same single clause. That is the case for an allowlist of one scheme over a denylist.
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

describe('safeVerificationUrl', () => {
  it('only turns an absolute, credential-free HTTPS provider reply into a renderer link', () => {
    expect(safeVerificationUrl('https://github.com/login/device')?.href).toBe('https://github.com/login/device')
    for (const url of ['javascript:alert(1)', 'data:text/html,evil', 'http://example.test/', '//example.test/', 'https://user:secret@example.test/', 'https:\n//example.test/']) {
      expect(safeVerificationUrl(url)).toBeNull()
    }
  })
})

describe('safeContentHref', () => {
  it('keeps explicit app routes and ordinary web/mail links but refuses executable schemes', () => {
    expect(safeContentHref('/settings/plugins')).toBe('/settings/plugins')
    expect(safeContentHref('#details')).toBe('#details')
    expect(safeContentHref('https://example.test/')).toBe('https://example.test/')
    expect(safeContentHref('mailto:owner@example.test')).toBe('mailto:owner@example.test')
    for (const value of ['javascript:alert(1)', 'data:text/html,evil', 'file:///tmp/x', '//attacker.test/', '/\\attacker.test/', 'https://user:secret@example.test/', 'https:\n//example.test/']) {
      expect(safeContentHref(value)).toBeNull()
    }
  })
})
