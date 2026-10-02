/** "5m ago" for the past and "in 5m" for the future. Anything within a minute either way is "now". */
export function formatRelativeTime(ms: number | null | undefined, now = Date.now()): string {
  if (ms == null || Number.isNaN(ms)) return ''
  const distance = Math.abs(now - ms)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day

  if (distance < minute) return 'now'
  const span = distance < hour ? `${Math.floor(distance / minute)}m`
    : distance < day ? `${Math.floor(distance / hour)}h`
      : distance < month ? `${Math.floor(distance / day)}d`
        : `${Math.floor(distance / month)}mo`
  return ms > now ? `in ${span}` : `${span} ago`
}
