// Dashboard surfaces for compiled client plugins. Kept off the eager kit and host barrels so the
// dashboard views and run client load only with a consumer that draws one.
// The transcript card for core's `panel_show` agent tool, which the agents plugin places in its
// `tool-card` point (docs/dashboards.md § Panels from a conversation).
export { default as PanelToolCard } from '@acorn/client-core/features/dashboards/PanelToolCard.tsx'
