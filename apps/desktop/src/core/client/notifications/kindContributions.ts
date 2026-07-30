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
  { id: 'agent-completed', glyph: 'circle-dot', severity: 'info', toast: true },
  { id: 'agent-needs-input', glyph: 'circle-alert', severity: 'warn', toast: true },
  { id: 'agent-error', glyph: 'triangle-alert', severity: 'danger', toast: true },
]
