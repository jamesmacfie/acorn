import { and, sql } from 'drizzle-orm'
import { repos } from '../node/schema'

// Owner/name match for the mirror, folded on both sides. The mirror stores GitHub's canonical spelling
// (`Runn-Fast/runn`), while core's project facet stores the folded one (`runn-fast/runn`), so a route
// that takes owner/name from a project and compares with `=` finds nothing and reports the repo as
// unmirrored. The read path hid that by falling through to a live fetch; the write paths returned 404.
// Callers add their own userId predicate, because the mirror is user-scoped and one collection query
// filters by repo without one.
export const repoMatches = (owner: string, name: string) =>
  and(sql`lower(${repos.owner}) = ${owner.toLowerCase()}`, sql`lower(${repos.name}) = ${name.toLowerCase()}`)
