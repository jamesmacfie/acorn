import type { Pull } from '../../shared/api'

// Client-side text filter over the loaded tab. Pulls past the loaded pages come from GitHub's search
// (`pullSearchOptions`), not from here.
export const filterPulls = (pulls: Pull[], query: string) => {
  const q = query.trim().toLowerCase()
  if (!q) return pulls
  return pulls.filter((p) => `#${p.number} ${p.title} ${p.author ?? ''} ${p.headRef ?? ''}`.toLowerCase().includes(q))
}
