import type { NoticeKindContribution } from '../../registries/notices'

export const noticeKindContributions: NoticeKindContribution[] = [
  { id: 'finished', glyph: '●', severity: 'info', toast: true },
  { id: 'needs-input', glyph: '‼', severity: 'warn', toast: true },
  { id: 'exited', glyph: '○', severity: 'info', toast: true },
  { id: 'error', glyph: '✕', severity: 'danger', toast: true },
  { id: 'gate', glyph: '⛔', severity: 'warn', toast: true },
  { id: 'run-done', glyph: '▸', severity: 'info', toast: true },
  { id: 'background-error', glyph: '⚠', severity: 'danger', toast: false },
]
