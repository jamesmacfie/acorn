import { Registry } from './registry'

export type NoticeKindContribution = {
  id: string
  glyph: string
  severity: 'info' | 'warn' | 'danger'
  toast: boolean
}

export const noticeKindRegistry = new Registry<NoticeKindContribution>('notice-kind')
export const noticeKindContribution = (id: string): NoticeKindContribution | undefined => noticeKindRegistry.get(id)
