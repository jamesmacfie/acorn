// Moved to @acorn/dashboards-core, which the NODE also imports: the measure sampler
// (docs/future/cron/targets.md § seam 2) runs the same shaping, mapping and aggregate the panel
// renders with, and a client package cannot enter the node's graph (tools/arch/boundaries.test.ts).
//
// Left here as a re-export rather than rewriting forty call sites: the components in this directory
// still say `./compose`, and this file is the one edit that made that true.
export * from '@acorn/dashboards-core/compose.ts'
