/** The Node stores an instant. The reader's device decides how that instant is displayed. */
export function eventTime(
  at: number,
  locale?: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): { short: string; full: string } {
  const date = new Date(at)
  const short = new Intl.DateTimeFormat(locale, {
    hour: 'numeric', minute: '2-digit', timeZone,
  }).format(date)
  const full = new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
    timeZoneName: 'shortOffset', timeZone,
  }).format(date)
  return { short, full: `${full} · ${timeZone}` }
}
