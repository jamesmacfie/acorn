// What publication refuses. The panel is projected over its described sources with no records, which
// is enough: the projected schema depends on the descriptions and the mapping, never on the rows.

/** One thing wrong with a panel. `path` is a JSON Pointer into `DashboardPanelContent`. */
export type DashboardProblem = { path: string; message: string }

export const describeDashboardProblem = (problem: DashboardProblem): string => `${problem.path}: ${problem.message}`
