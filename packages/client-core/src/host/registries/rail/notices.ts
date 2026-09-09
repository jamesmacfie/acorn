import { Registry } from '../../../kit/lib/registry'

// How a bell row is drawn and how far it is allowed to travel. One contribution per notice kind,
// registered by the shell from a static list (features/notifications/kindContributions.ts).
//
// `toast` is the kind's answer to "may this reach the desktop", read by the system sink
// (features/notifications/deliver.ts). It is not the notification setting, which is the owner's answer
// to the same question; both have to say yes.
export type NoticeKindContribution = {
  id: string
  glyph: string
  severity: 'info' | 'warn' | 'danger'
  toast: boolean
}

export const noticeKindRegistry = new Registry<NoticeKindContribution>('notice-kind')

/** The `plugin` kind is the fallback rather than `undefined`, because every caller needs an answer and
 *  the honest one for a kind nobody registered is "some plugin raised this": a puzzle piece, `info`
 *  tone, and no desktop banner. Unresolved, the bell drew an unlabelled circle in warn tone, which
 *  says "something is wrong" about a row that might be a nudge.
 *
 *  A second lookup rather than recursion, so a host that has registered no kinds at all — a test, a
 *  bare embedding — gets `undefined` instead of a stack overflow. */
export const noticeKindContribution = (id: string): NoticeKindContribution | undefined =>
  noticeKindRegistry.get(id) ?? noticeKindRegistry.get('plugin')
