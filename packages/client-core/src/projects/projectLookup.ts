import type { Project } from '../queries'

// The project list, from module-level code. Same shape and reason as tasks/taskLookup.ts, which states
// the argument in full: `projectsOptions` is a TanStack query and `useQueryClient` is a hook, so a click
// handler registered at plugin init can't reach either.
//
// Read by content-link path resolvers, which answer "does this external URL name something acorn already
// tracks" and need the whole list rather than one id: a github.com URL identifies a repo by owner and
// name, and only the project rows know which of them acorn has. Not reactive, for the reason taskLookup
// gives.
let read: () => readonly Project[] = () => []

/** Called once by the composition root, before anything can click. */
export const setProjectsLookup = (reader: () => readonly Project[]): void => void (read = reader)

/** Every known project, or empty when the list hasn't loaded: "unknown", never "none". */
export const allProjects = (): readonly Project[] => read()
