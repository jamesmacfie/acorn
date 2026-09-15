// Where a followed scroller says it put the reader, and who asked for it.
//
// An installed handler rather than a direct call, for the reason `contributionErrors.ts` gives:
// `kit/` may import `kit/` and the highlighter, and a plugin's UI bundle re-exports all of it, so a
// kit file that imported the telemetry emitter would pull the emitter into every plugin that draws a
// button. Nothing is installed by default and a host that never starts telemetry pays one null check.
//
// Worth reporting at all because the scroller is the only thing that can tell the three causes apart.
// A reader scrolling, the timeline restoring a place, and the browser clamping the offset under a list
// that changed size all arrive as the same scroll position. From outside, "the transcript jumped to the
// top" is unattributable; from in here it is a cause and four numbers.

export type ScrollPlaceReport = {
  /** The turn the reader is held on, or `live` for the end of the list. A turn's key is the id of the
   *  record that drew it, so a report can be looked up against the stream it came from. */
  anchor: string
  /**
   * `opened`: the timeline mounted or swapped lists, and went to the offset in `to`. A remount lands
   * here and nowhere else, because a fresh element fires no scroll event.
   *
   * `unasked`: a scroll nobody made. Not the reader, since no gesture was armed; not the timeline,
   * since it echoes its own writes; and not the browser clamping under a shrinking list, since that
   * lands against the bottom. Whatever moved the reader here, this is the only record of it.
   */
  cause: 'opened' | 'unasked'
  from: number
  to: number
  /** The list's height and the viewport's, so a report can say whether `to` is a real place or the
   *  only offset a collapsed list had left. */
  height: number
  viewport: number
  following: boolean
}

let handler: ((report: ScrollPlaceReport) => void) | null = null

/** Called by the client's telemetry start-up. One handler; a second replaces the first. */
export const setScrollPlaceHandler = (next: ((report: ScrollPlaceReport) => void) | null): void => {
  handler = next
}

/** Say where the reader was put. Never throws: a scroll handler that failed while reporting would
 *  take the scrolling with it. */
export const reportScrollPlace = (report: ScrollPlaceReport): void => {
  try {
    handler?.(report)
  } catch {
    // Deliberately silent, for the reason above.
  }
}
