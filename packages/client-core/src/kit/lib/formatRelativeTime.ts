// Moved to @acorn/dashboards-core (as relativeTime.ts) because dashboards/format.ts renders a
// datetime cell with it and that module is now node-side too. Re-exported here because this path is
// on the plugin API surface (@acorn/plugin-api/client) and a public specifier does not move.
export { formatRelativeTime } from '@acorn/dashboards-core/relativeTime.ts'
