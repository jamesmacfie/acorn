import type { Project } from '../queries'

// The project LIST, from module-level code — the same shape and the same reason as
// tasks/taskLookup.ts, which states the argument in full: `projectsOptions` is a TanStack query and
// `useQueryClient` is a hook, so a click handler registered at plugin init cannot reach either.
//
// Read by content-link path resolvers, which answer "does this external URL name something acorn
// already tracks" and need the whole list rather than one id: a github.com URL identifies a repo by
// owner/name, and only the project rows know which of them acorn has. Deliberately not reactive, for
// the reason taskLookup gives — every caller is a click handler asking about right now.
let read: () => readonly Project[] = () => []

/** Called once by the composition root, before anything can click. */
export const setProjectsLookup = (reader: () => readonly Project[]): void => void (read = reader)

/** Every known project, or empty when the list has not loaded — "unknown", never "none". */
export const allProjects = (): readonly Project[] => read()
