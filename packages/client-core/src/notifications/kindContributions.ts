import type { NoticeKindContribution } from '../registries/notices'

export const noticeKindContributions: NoticeKindContribution[] = [
  { id: 'finished', glyph: 'circle-dot', severity: 'info', toast: true },
  { id: 'needs-input', glyph: 'circle-alert', severity: 'warn', toast: true },
  { id: 'exited', glyph: 'circle', severity: 'info', toast: true },
  { id: 'error', glyph: 'x', severity: 'danger', toast: true },
  { id: 'gate', glyph: 'ban', severity: 'warn', toast: true },
  { id: 'run-done', glyph: 'play', severity: 'info', toast: true },
  { id: 'background-error', glyph: 'triangle-alert', severity: 'danger', toast: false },
  { id: 'repo-config-trust', glyph: 'triangle-alert', severity: 'warn', toast: true },
  // An agent asked for a plugin to be installed, updated or removed (docs/plugins.md § Approval-mediated
  // install). `toast: true` because it is a question waiting on the owner, and unlike the plugin-authored
  // `plugin` kind below, its title is written by acorn and names no agent text.
  { id: 'plugin-request', glyph: 'puzzle', severity: 'warn', toast: true },
  { id: 'agent-completed', glyph: 'circle-dot', severity: 'info', toast: true },
  { id: 'agent-needs-input', glyph: 'circle-alert', severity: 'warn', toast: true },
  { id: 'agent-error', glyph: 'triangle-alert', severity: 'danger', toast: true },
  // The one-time disk-encryption warning (docs/data-layer.md § Backup). `toast: false`, deliberately: an
  // OS notification fires whether or not the window has focus, and this is a standing condition rather
  // than something that just happened. It belongs in the bell, where the owner finds it when they look.
  { id: 'disk-unencrypted', glyph: 'triangle-alert', severity: 'warn', toast: false },
  // Anything a sandboxed plugin frame raises through the bridge's `toast` verb
  // (docs/plugins.md). `toast: false` on purpose: an OS notification fires
  // whether or not the window has focus, and third-party code should not be able to put text on the
  // user's desktop. The bell is the right loudness for "the plugin has something to say".
  { id: 'plugin', glyph: 'puzzle', severity: 'info', toast: false },
]
