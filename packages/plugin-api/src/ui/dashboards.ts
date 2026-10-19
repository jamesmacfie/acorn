// Dashboard surfaces for compiled client plugins. Kept off the eager kit and host barrels so the
// dashboard views and run client load only with a consumer that draws one.
// The transcript card for core's `panel_show` agent tool, which the agents plugin places in its
// `tool-card` point (docs/dashboards.md § Panels from a conversation).
export { default as PanelToolCard } from '@acorn/client-core/features/dashboards/PanelToolCard.tsx'
// A transcript card's capped, visibility-aware body, and an unpublished plan drawn as a panel: what an
// agent-built app's card is made of (docs/agent-built-apps.md).
export { default as CardFrame } from '@acorn/client-core/features/dashboards/CardFrame.tsx'
export { default as PlanPanel } from '@acorn/client-core/features/dashboards/PlanPanel.tsx'
