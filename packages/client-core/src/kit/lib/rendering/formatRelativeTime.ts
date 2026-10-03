// Moved to @acorn/dashboards-core (as relativeTime.ts) because dashboards/format.ts renders a
// datetime cell with it and that module is now node-side too. Re-exported here because this path is
// on the plugin API surface (@acorn/plugin-api/client) and a public specifier does not move.
//
// From its own module rather than the `render` barrel: the barrel also carries the chart and trend
// code, and this re-export is on the startup graph, so through the barrel it pulled all of that into
// the first load (docs/frontend/startup-budget.md § Startup budget).
export { formatRelativeTime } from '@acorn/dashboards-core/relativeTime.ts'
