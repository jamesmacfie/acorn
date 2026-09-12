// Guards for URLs the app hands to the OS. Scheme allowlisting policy is in docs/security.md §
// Process, path, and configuration controls.
//
// An anchor's href is untrusted input: renderer content includes GitHub, Linear, and Rollbar text
// this app does not author. The OS resolves the scheme itself, where `file:` opens bundles and
// scripts and a custom scheme reaches another installed app, so allow only the three schemes a link
// in prose is ever trying to reach.
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

export const isAllowedExternalUrl = (url: string): boolean => {
  try {
    return EXTERNAL_SCHEMES.has(new URL(url).protocol)
  } catch {
    return false // unparseable, so not something we hand to the OS
  }
}
