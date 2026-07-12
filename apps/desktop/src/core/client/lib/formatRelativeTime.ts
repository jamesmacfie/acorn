export function formatRelativeTime(ms: number | null | undefined, now = Date.now()): string {
  if (ms == null || Number.isNaN(ms)) return ''
  const elapsed = Math.max(0, now - ms)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day

  if (elapsed < minute) return 'now'
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`
  if (elapsed < month) return `${Math.floor(elapsed / day)}d ago`
  return `${Math.floor(elapsed / month)}mo ago`
}
