// One policy for "a plugin asked the host to open this URL", used by both places that answer: a
// manifest's `openUrl` descriptor verb when the node parses it, and the frame bridge's `ui.openUrl`
// verb when a sandboxed frame sends one. Otherwise it'd be two `startsWith('https://')` calls in two
// packages that can't import each other, and one would eventually gain an exception the other didn't.
//
// `https` and nothing else, narrower than the shell's own external-URL allowlist
// (node-core/server/urlGuards.ts, which also permits `http` and `mailto` because a GitHub body or a Linear
// ticket legitimately contains both). That list decides what a person's click may reach; this one
// decides what plugin code may hand the machine unprompted. Anything else is a downgrade or a scheme
// handler, meaning an arbitrary application launch. `app-plugin://`, the frame's own origin, is refused
// by the same clause, so a frame can't ask the host to open another plugin's bundle.
//
// Parsed rather than prefix-matched, because a bridge message is untrusted input and `new URL` is the
// same parse the navigation layer does later. A caller passing something that isn't a URL gets `false`.
export function isPluginOpenableUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/** A Node-provided device-flow address is displayed and opened by the privileged renderer. */
export function safeVerificationUrl(raw: string): URL | null {
  if (raw.length > 2_048 || /[\u0000-\u0020\u007f]/.test(raw)) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

/** URLs that renderer-owned kit anchors may put in an href, including local app routes. */
export function safeContentHref(raw: string | undefined): string | null {
  if (!raw || raw.length > 2_048 || /[\u0000-\u0020\u007f]/.test(raw) || raw.includes('\\')) return null
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  if (raw.startsWith('#')) return raw
  try {
    const url = new URL(raw)
    if (url.protocol === 'mailto:') return url.href
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password
      ? url.href : null
  } catch {
    return null
  }
}
