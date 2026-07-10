import type { Pull } from '../../../../core/client/queries'

// Client-side text filter over the loaded tab. This intentionally stays local to
// the current PR list; older PR search/pagination belongs in the server workflow.
export const filterPulls = (pulls: Pull[], query: string) => {
  const q = query.trim().toLowerCase()
  if (!q) return pulls
  return pulls.filter((p) => `#${p.number} ${p.title} ${p.author ?? ''}`.toLowerCase().includes(q))
}
