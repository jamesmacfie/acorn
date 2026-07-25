// Guards for URLs the app hands to something outside the renderer. Pure string predicates — no
// electron import — so they're unit-testable under plain Node (urlGuards.test.ts).

// May this URL be handed to the OS (shell.openExternal)? Renderer content includes third-party text
// we don't author — GitHub PR/comment bodies, Linear issue bodies and attachment URLs, Rollbar
// links — so an anchor's href is untrusted input. openExternal resolves the scheme through
// LaunchServices, where `file:` opens bundles/scripts and custom schemes reach other installed apps;
// only the three schemes a link in prose is ever legitimately trying to reach are allowed.
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

export const isAllowedExternalUrl = (url: string): boolean => {
  try {
    return EXTERNAL_SCHEMES.has(new URL(url).protocol)
  } catch {
    return false // unparseable → not something we hand to the OS
  }
}
