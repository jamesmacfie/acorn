// One policy for "a plugin asked the host to open this URL", used by both places that answer.
//
// A manifest's `openUrl` descriptor verb is checked here when the node parses it
// (node-core/main/pluginManifest.ts), and the frame bridge's `ui.openUrl` verb is checked here when a
// sandboxed frame sends one (client-core/plugins/frames/broker.ts). They were about to be two
// `startsWith('https://')` calls in two packages that cannot import each other, which is how one of
// them eventually gains an exception the other does not have.
//
// `https` and nothing else, deliberately narrower than the shell's own external-URL allowlist
// (node-core/main/urlGuards.ts, which also permits `http` and `mailto` because a GitHub body or a
// Linear ticket legitimately contains both). The asymmetry is the point: that list decides what a
// PERSON's click may reach, and this one decides what PLUGIN CODE may hand the machine unprompted.
// Anything else is either a downgrade or a scheme handler — an arbitrary-application launch — and
// neither is a choice a plugin gets to make for the owner. `app-plugin://`, the frame's own origin, is
// refused by the same clause, so a frame cannot ask the host to open another plugin's bundle either.
//
// Parsed rather than prefix-matched, because a bridge message is untrusted input and `new URL` is the
// same parse the navigation layer will do later. A caller reaching this with something that is not a
// URL at all gets `false` instead of an exception.
export function isPluginOpenableUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}
